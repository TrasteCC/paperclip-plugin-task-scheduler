import { describe, expect, it } from "vitest";
import { createTestHarness } from "@paperclipai/plugin-sdk/testing";
import type { Agent, Company, Issue } from "@paperclipai/shared";
import manifest, { JOB_KEY, TOOL_NAME } from "../src/manifest.js";
import plugin, { startDueTasks, type IssueScheduleData, type ScheduledData } from "../src/worker.js";

const COMPANY = "company-1";
const PAST = "2026-10-01 09:00";
const FUTURE = "2099-01-01 09:00";

function issue(id: string, fields: Partial<Issue>): Issue {
  return {
    id,
    companyId: COMPANY,
    identifier: id.toUpperCase(),
    title: `Task ${id}`,
    description: null,
    status: "backlog",
    priority: "medium",
    projectId: null,
    assigneeAgentId: null,
    assigneeUserId: null,
    ...fields,
  } as Issue;
}

function agent(id: string, name: string, adapterType: string, model?: string): Agent {
  return { id, companyId: COMPANY, name, status: "idle", adapterType, adapterConfig: model ? { model } : {} } as unknown as Agent;
}

async function setup(issues: Issue[] = [], config: Record<string, unknown> = { enabled: true }) {
  const harness = createTestHarness({ manifest, capabilities: [...manifest.capabilities, "issue.comments.read"], config });
  harness.seed({
    companies: [{ id: COMPANY, name: "Homelab" } as Company],
    agents: [agent("a-manitas", "Manitas", "opencode_local", "omniroute/manitas"), agent("a-herminio", "Herminio", "hermes_gateway")],
    issues,
  });
  await plugin.definition.setup(harness.ctx);
  return harness;
}

const get = (h: Awaited<ReturnType<typeof setup>>, id: string) => h.ctx.issues.get(id, COMPANY) as Promise<Issue>;
const comments = async (h: Awaited<ReturnType<typeof setup>>, id: string) =>
  (await h.ctx.issues.listComments(id, COMPANY)).map((c) => c.body);
const asBoard = { actor: { type: "user" as const, userId: "user-1", companyId: COMPANY }, companyId: COMPANY };

describe("manifest", () => {
  it("runs the scheduler every minute and declares the slots and tool", () => {
    expect(manifest.jobs).toEqual([expect.objectContaining({ jobKey: JOB_KEY, schedule: "* * * * *" })]);
    expect(manifest.tools?.map((t) => t.name)).toEqual([TOOL_NAME]);
    expect(manifest.ui?.slots?.map((s) => s.type)).toEqual(["page", "sidebar", "toolbarButton", "dashboardWidget"]);
  });
});

describe("scheduler job", () => {
  it("starts a due agent task: todo first, then a single start comment (the wake did not fail)", async () => {
    const h = await setup([issue("t1", { assigneeAgentId: "a-manitas", description: `Fix it.\n\nstart-at: ${PAST}` })]);
    await h.runJob(JOB_KEY);
    const t1 = await get(h, "t1");
    expect(t1.status).toBe("todo");
    expect(t1.description).toBe(`Fix it.\n\nstarted-at: ${PAST}`);
    expect(await comments(h, "t1")).toEqual([`Started by the scheduler (start-at ${PAST} Europe/Madrid).`]);
  });

  it("starts a due task assigned to a person without trying to wake anyone", async () => {
    const h = await setup([issue("t1", { assigneeUserId: "user-1", description: `start-at: ${PAST}` })]);
    await h.runJob(JOB_KEY);
    expect((await get(h, "t1")).status).toBe("todo");
    expect(await comments(h, "t1")).toHaveLength(1);
  });

  it("leaves future tasks, unscheduled backlog and non-backlog issues alone", async () => {
    const h = await setup([
      issue("future", { assigneeAgentId: "a-manitas", description: `start-at: ${FUTURE}` }),
      issue("plain", { description: "No schedule here." }),
      issue("busy", { status: "in_progress", assigneeAgentId: "a-manitas", description: `start-at: ${PAST}` }),
    ]);
    await h.runJob(JOB_KEY);
    expect((await get(h, "future")).status).toBe("backlog");
    expect((await get(h, "plain")).status).toBe("backlog");
    expect((await get(h, "busy")).description).toBe(`start-at: ${PAST}`);
    expect(await comments(h, "future")).toEqual([]);
  });

  it("skips companies where the scheduler is not enabled", async () => {
    const h = await setup([issue("t1", { assigneeAgentId: "a-manitas", description: `start-at: ${PAST}` })], {});
    await h.runJob(JOB_KEY);
    expect((await get(h, "t1")).status).toBe("backlog");
    expect((await h.getData<ScheduledData>("scheduled", { companyId: COMPANY })).enabled).toBe(false);
  });

  it("does not start a task twice", async () => {
    const h = await setup([issue("t1", { assigneeAgentId: "a-manitas", description: `start-at: ${PAST}` })]);
    await h.runJob(JOB_KEY);
    await h.ctx.issues.update("t1", { status: "backlog" }, COMPANY);
    await h.runJob(JOB_KEY);
    expect(await comments(h, "t1")).toHaveLength(1);
  });

  it("reports an unreadable start-at once and disarms it", async () => {
    const h = await setup([issue("t1", { assigneeAgentId: "a-manitas", description: "start-at: next monday" })]);
    await h.runJob(JOB_KEY);
    await h.runJob(JOB_KEY);
    const t1 = await get(h, "t1");
    expect(t1.status).toBe("backlog");
    expect(t1.description).toBe("start-at-invalid: next monday");
    expect(await comments(h, "t1")).toHaveLength(1);
  });

  it("keeps going when one task fails, then fails the run", async () => {
    const h = await setup([
      issue("bad", { assigneeAgentId: "a-manitas", description: `start-at: ${PAST}` }),
      issue("good", { assigneeAgentId: "a-manitas", description: `start-at: ${PAST}` }),
    ]);
    const update = h.ctx.issues.update.bind(h.ctx.issues);
    h.ctx.issues.update = async (id, patch, companyId) => {
      if (id === "bad") throw new Error("boom");
      return update(id, patch, companyId);
    };
    await expect(startDueTasks(h.ctx)).rejects.toThrow(/BAD: boom/);
    expect((await get(h, "good")).status).toBe("todo");
  });

  describe("ask-first", () => {
    async function dueAskFirst() {
      const h = await setup([issue("t1", { assigneeAgentId: "a-manitas", description: `start-at: ${PAST}\nask-first: yes` })]);
      await h.runJob(JOB_KEY);
      const [interaction] = await h.ctx.issues.listInteractions("t1", COMPANY);
      return { h, interaction };
    }

    it("asks a board user instead of waking the agent, and waits", async () => {
      const { h, interaction } = await dueAskFirst();
      expect(interaction).toMatchObject({ kind: "request_confirmation", status: "pending", continuationPolicy: "none" });
      expect(interaction.payload).toMatchObject({ prompt: expect.stringContaining("Manitas will be woken") });
      await h.runJob(JOB_KEY);
      expect(await h.ctx.issues.listInteractions("t1", COMPANY)).toHaveLength(1);
      expect((await get(h, "t1")).status).toBe("backlog");
      expect((await h.getData<ScheduledData>("scheduled", { companyId: COMPANY })).items[0].awaitingConfirmation).toBe(true);
    });

    it("starts after the board user accepts", async () => {
      const { h, interaction } = await dueAskFirst();
      (interaction as { status: string }).status = "accepted";
      await h.runJob(JOB_KEY);
      const t1 = await get(h, "t1");
      expect(t1.status).toBe("todo");
      expect(t1.description).toBe(`started-at: ${PAST}\nask-first: yes`);
      expect(await comments(h, "t1")).toEqual([`Started by the scheduler after confirmation (start-at ${PAST} Europe/Madrid).`]);
    });

    it("keeps the task in backlog when declined", async () => {
      const { h, interaction } = await dueAskFirst();
      (interaction as { status: string }).status = "rejected";
      await h.runJob(JOB_KEY);
      const t1 = await get(h, "t1");
      expect(t1.status).toBe("backlog");
      expect(t1.description).toBe(`start-declined: ${PAST}\nask-first: yes`);
      expect(await comments(h, "t1")).toHaveLength(1);
    });
  });
});

describe("board actions", () => {
  it("creates a backlog task with the schedule, assignee and model override", async () => {
    const h = await setup();
    const created = await h.performAction<{ id: string }>(
      "create-task",
      { title: "Rotate key", description: "Do it.", assigneeAgentId: "a-manitas", startAt: "2026-11-11T09:00", askFirst: true, model: "omniroute/big" },
      asBoard,
    );
    const task = await get(h, created.id);
    expect(task).toMatchObject({
      status: "backlog",
      assigneeAgentId: "a-manitas",
      description: "Do it.\n\nstart-at: 2026-11-11 09:00\nask-first: yes",
      assigneeAdapterOverrides: { adapterConfig: { model: "omniroute/big" } },
    });
  });

  it("drops ask-first for a task assigned to a person", async () => {
    const h = await setup();
    const created = await h.performAction<{ id: string }>(
      "create-task",
      { title: "Review", assigneeUserId: "user-1", startAt: "2026-11-11T09:00", askFirst: true },
      asBoard,
    );
    expect((await get(h, created.id)).description).toBe("start-at: 2026-11-11 09:00");
  });

  it("rejects bad input, model overrides the adapter cannot honor, and agent callers", async () => {
    const h = await setup();
    await expect(h.performAction("create-task", { title: "X", startAt: "soon" }, asBoard)).rejects.toThrow(/startAt/);
    await expect(h.performAction("create-task", { startAt: "2026-11-11T09:00" }, asBoard)).rejects.toThrow(/title/);
    await expect(
      h.performAction("create-task", { title: "X", startAt: "2026-11-11T09:00", assigneeAgentId: "a-herminio", model: "m" }, asBoard),
    ).rejects.toThrow(/model override/);
    await expect(
      h.performAction("create-task", { title: "X", startAt: "2026-11-11T09:00" }, { actor: { type: "agent", agentId: "a-manitas" }, companyId: COMPANY }),
    ).rejects.toThrow(/board users/);
  });

  it("schedules an existing todo task, and refuses one already in progress", async () => {
    const h = await setup([issue("t1", { status: "todo", description: "Body" }), issue("t2", { status: "in_progress" })]);
    await h.performAction("set-schedule", { issueId: "t1", startAt: "2026-12-01T10:00" }, asBoard);
    expect(await get(h, "t1")).toMatchObject({ status: "backlog", description: "Body\n\nstart-at: 2026-12-01 10:00" });
    const data = await h.getData<IssueScheduleData>("issue-schedule", { companyId: COMPANY, issueId: "t1" });
    expect(data.schedule).toMatchObject({ startLocal: "2026-12-01 10:00", askFirst: false });
    await expect(h.performAction("set-schedule", { issueId: "t2", startAt: "2026-12-01T10:00" }, asBoard)).rejects.toThrow(/in_progress/);
  });

  it("clears a schedule and starts a task early", async () => {
    const h = await setup([
      issue("t1", { description: `Body\nstart-at: ${FUTURE}` }),
      issue("t2", { assigneeAgentId: "a-manitas", description: `start-at: ${FUTURE}` }),
    ]);
    await h.performAction("clear-schedule", { issueId: "t1" }, asBoard);
    expect((await get(h, "t1")).description).toBe("Body");
    await h.performAction("start-now", { issueId: "t2" }, asBoard);
    expect((await get(h, "t2")).status).toBe("todo");
    expect(await comments(h, "t2")).toEqual([`Started early from the Scheduled page (start-at ${FUTURE} Europe/Madrid).`]);
  });
});

describe("attachment links", () => {
  it("links uploaded files above the schedule, images inline", async () => {
    const h = await setup([issue("t1", { assigneeAgentId: "a-manitas", description: `Do it.\n\nstart-at: ${FUTURE}` })]);
    await h.performAction(
      "add-attachment-links",
      { issueId: "t1", files: [{ name: "shot.png", path: "/api/attachments/a1/content", image: true }, { name: "notes [v2].txt", path: "/api/attachments/a2/content", image: false }] },
      asBoard,
    );
    const t1 = await get(h, "t1");
    expect(t1.description).toBe(
      `Do it.\n\n**Attachments**\n\n- ![shot.png](/api/attachments/a1/content)\n- [notes  v2 .txt](/api/attachments/a2/content)\n\nstart-at: ${FUTURE}`,
    );
    expect(t1.status).toBe("backlog");
  });

  it("refuses links that are not Paperclip API paths", async () => {
    const h = await setup([issue("t1", { description: "x" })]);
    for (const path of ["https://evil.example/x.png", "/api/x) ![y](https://evil", "javascript:alert(1)"]) {
      await expect(h.performAction("add-attachment-links", { issueId: "t1", files: [{ name: "x", path, image: true }] }, asBoard)).rejects.toThrow(/\/api\//);
    }
  });
});

describe("scheduled list", () => {
  it("lists scheduled backlog tasks soonest first, unreadable ones last", async () => {
    const h = await setup([
      issue("late", { assigneeAgentId: "a-manitas", description: "start-at: 2026-12-01 09:00" }),
      issue("bad", { description: "start-at: whenever" }),
      issue("soon", { assigneeUserId: "user-1", description: "start-at: 2026-11-01 09:00" }),
      issue("plain", {}),
    ]);
    const { items } = await h.getData<ScheduledData>("scheduled", { companyId: COMPANY });
    expect(items.map((i) => i.id)).toEqual(["soon", "late", "bad"]);
    expect(items[1].assigneeAgentName).toBe("Manitas");
    expect(items[2].startAt).toBeNull();
  });
});

describe("agent tool", () => {
  const run = { agentId: "a-hoh", runId: "run-1", companyId: COMPANY, projectId: "" };

  it("lets an agent schedule work for another agent by name", async () => {
    const h = await setup();
    const result = await h.executeTool<{ content?: string; data?: { issueId: string } }>(
      TOOL_NAME,
      { title: "Fix the disk alert", assignee: "manitas", startAt: "2026-11-02 09:00" },
      run,
    );
    expect(result.content).toMatch(/assigned to Manitas/);
    const task = await get(h, result.data!.issueId);
    expect(task).toMatchObject({ status: "backlog", assigneeAgentId: "a-manitas", description: "start-at: 2026-11-02 09:00" });
  });

  it("returns a usable error for an unknown agent or a bad time", async () => {
    const h = await setup();
    const unknown = await h.executeTool<{ error?: string }>(TOOL_NAME, { title: "X", assignee: "Nobody", startAt: "2026-11-02 09:00" }, run);
    expect(unknown.error).toMatch(/Manitas, Herminio/);
    const badTime = await h.executeTool<{ error?: string }>(TOOL_NAME, { title: "X", assignee: "Manitas", startAt: "in 2 days" }, run);
    expect(badTime.error).toMatch(/YYYY-MM-DD HH:MM/);
  });
});
