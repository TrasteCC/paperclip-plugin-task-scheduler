import { definePlugin, runWorker, type PluginContext } from "@paperclipai/plugin-sdk";
import type { Agent, Issue, IssuePriority } from "@paperclipai/shared";
import manifest, { JOB_KEY, MODEL_ADAPTERS, TOOL_NAME } from "./manifest.js";
import {
  TIMEZONE,
  clearSchedule,
  formatLocal,
  markDeclined,
  markInvalid,
  markStarted,
  normalizeLocalInput,
  parseSchedule,
  insertBeforeSchedule,
  setSchedule,
  startedAt,
  type Schedule,
} from "./schedule.js";

const PRIORITIES = new Set(["critical", "high", "medium", "low"]);
const PAGE_SIZE = 200;
const CONFIRMATION_KEY = "confirmation";

export interface ScheduledItem {
  id: string;
  identifier: string | null;
  title: string;
  startAt: number | null;
  raw: string;
  askFirst: boolean;
  awaitingConfirmation: boolean;
  assigneeAgentId: string | null;
  assigneeAgentName: string | null;
  assigneeUserId: string | null;
  projectId: string | null;
  priority: string;
}

export interface ScheduledData {
  timezone: string;
  /** Whether the scheduler starts tasks in this company (plugin setting). */
  enabled: boolean;
  items: ScheduledItem[];
}

export interface IssueScheduleData {
  timezone: string;
  status: string;
  schedule: (Schedule & { startLocal: string | null }) | null;
  startedAt: string | null;
  awaitingConfirmation: boolean;
}

export interface AgentModel {
  agentId: string;
  name: string;
  adapterType: string;
  model: string | null;
}

interface Confirmation {
  interactionId: string;
  startAt: number;
}

type Actor = { actorAgentId?: string | null; actorUserId?: string | null; actorRunId?: string | null };

function requireString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim() === "") throw new Error(`${name} is required`);
  return value.trim();
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

const confirmationScope = (issueId: string) => ({ scopeKind: "issue" as const, scopeId: issueId, stateKey: CONFIRMATION_KEY });

async function listBacklog(ctx: PluginContext, companyId: string): Promise<Issue[]> {
  const all: Issue[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await ctx.issues.list({ companyId, status: "backlog", limit: PAGE_SIZE, offset });
    all.push(...page);
    if (page.length < PAGE_SIZE) return all;
  }
}

async function agentsById(ctx: PluginContext, companyId: string): Promise<Map<string, Agent>> {
  const agents = await ctx.agents.list({ companyId });
  return new Map(agents.map((agent) => [agent.id, agent]));
}

async function getIssue(ctx: PluginContext, issueId: string, companyId: string): Promise<Issue> {
  const issue = await ctx.issues.get(issueId, companyId);
  if (!issue) throw new Error("Issue not found");
  return issue;
}

/** Move a scheduled task to `todo`, record it, and wake its agent. */
async function startTask(ctx: PluginContext, issue: Issue, schedule: Schedule, how: string): Promise<void> {
  const when = schedule.startAt === null ? schedule.raw : formatLocal(schedule.startAt);
  await ctx.issues.update(issue.id, { status: "todo", description: markStarted(issue.description ?? "") }, issue.companyId);
  await ctx.state.delete(confirmationScope(issue.id));
  await ctx.issues.createComment(issue.id, `${how} (start-at ${when} ${TIMEZONE}).`, issue.companyId);
  if (!issue.assigneeAgentId) return;
  try {
    await ctx.issues.requestWakeup(issue.id, issue.companyId, {
      reason: "scheduled_start",
      contextSource: "task-scheduler",
      idempotencyKey: `task-scheduler:${issue.id}:${schedule.startAt ?? schedule.raw}`,
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    await ctx.issues.createComment(issue.id, `The scheduler could not wake the assignee: ${reason}`, issue.companyId);
  }
}

/** Ask a board user before starting; poll the answer on later ticks. */
async function confirmThenStart(ctx: PluginContext, issue: Issue, schedule: Schedule & { startAt: number }, agentName: string): Promise<void> {
  const scope = confirmationScope(issue.id);
  const pending = (await ctx.state.get(scope)) as Confirmation | null;
  if (!pending || pending.startAt !== schedule.startAt) {
    const interaction = await ctx.issues.requestConfirmation(
      issue.id,
      {
        title: "Scheduled start",
        idempotencyKey: `task-scheduler:confirm:${issue.id}:${schedule.startAt}`,
        resolverPolicy: "board_only",
        continuationPolicy: "none",
        payload: {
          version: 1,
          prompt: `Start this task now? It was scheduled for ${formatLocal(schedule.startAt)} (${TIMEZONE}) and ${agentName} will be woken.`,
          acceptLabel: "Start now",
          rejectLabel: "Don't start",
          allowDeclineReason: false,
        },
      },
      issue.companyId,
    );
    await ctx.state.set(scope, { interactionId: interaction.id, startAt: schedule.startAt } satisfies Confirmation);
    return;
  }
  const interaction = (await ctx.issues.listInteractions(issue.id, issue.companyId)).find((i) => i.id === pending.interactionId);
  if (interaction?.status === "pending") return;
  if (interaction?.status === "accepted") {
    await startTask(ctx, issue, schedule, "Started by the scheduler after confirmation");
    return;
  }
  await ctx.issues.update(issue.id, { description: markDeclined(issue.description ?? "") }, issue.companyId);
  await ctx.state.delete(scope);
  await ctx.issues.createComment(issue.id, "Scheduled start declined. The task stays in backlog; set a new start-at to schedule it again.", issue.companyId);
}

async function processIssue(ctx: PluginContext, issue: Issue, now: number, agents: () => Promise<Map<string, Agent>>): Promise<void> {
  const schedule = parseSchedule(issue.description);
  if (!schedule) return;
  if (schedule.startAt === null) {
    await ctx.issues.update(issue.id, { description: markInvalid(issue.description ?? "") }, issue.companyId);
    await ctx.issues.createComment(
      issue.id,
      `The scheduler could not read start-at "${schedule.raw}". Use \`start-at: YYYY-MM-DD HH:MM\` (${TIMEZONE} time).`,
      issue.companyId,
    );
    return;
  }
  if (schedule.startAt > now) return;
  if (schedule.askFirst && issue.assigneeAgentId) {
    const agentName = (await agents()).get(issue.assigneeAgentId)?.name ?? "the assigned agent";
    await confirmThenStart(ctx, issue, { ...schedule, startAt: schedule.startAt }, agentName);
    return;
  }
  await startTask(ctx, issue, schedule, "Started by the scheduler");
}

/** False when the company has no saved config: the host then refuses the job's calls for it. */
async function enabledFor(ctx: PluginContext, companyId: string): Promise<boolean> {
  try {
    return (await ctx.config.get(companyId)).enabled === true;
  } catch {
    return false;
  }
}

/** One scheduler pass over every enabled company. One failing issue does not block the others. */
export async function startDueTasks(ctx: PluginContext, now = Date.now()): Promise<void> {
  const failures: string[] = [];
  for (const company of await ctx.companies.list({ limit: PAGE_SIZE })) {
    if (!(await enabledFor(ctx, company.id))) continue;
    let cached: Promise<Map<string, Agent>> | null = null;
    const agents = () => (cached ??= agentsById(ctx, company.id));
    for (const issue of await listBacklog(ctx, company.id)) {
      try {
        await processIssue(ctx, issue, now, agents);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        ctx.logger.error("Scheduled start failed", { issueId: issue.id, error: message });
        failures.push(`${issue.identifier ?? issue.id}: ${message}`);
      }
    }
  }
  if (failures.length > 0) throw new Error(`Could not process ${failures.length} task(s): ${failures.join("; ")}`);
}

interface NewTask {
  title: string;
  description: string;
  startLocal: string;
  askFirst: boolean;
  assigneeAgentId: string | null;
  assigneeUserId: string | null;
  projectId: string | null;
  parentId: string | null;
  priority: IssuePriority | null;
  model: string | null;
}

async function createScheduledTask(ctx: PluginContext, companyId: string, task: NewTask, actor: Actor): Promise<Issue> {
  let assigneeAdapterOverrides: { adapterConfig: { model: string } } | undefined;
  if (task.model) {
    const agent = task.assigneeAgentId ? (await agentsById(ctx, companyId)).get(task.assigneeAgentId) : undefined;
    if (!agent || !MODEL_ADAPTERS.has(agent.adapterType)) {
      throw new Error("A model override needs an agent on claude_local, codex_local or opencode_local");
    }
    assigneeAdapterOverrides = { adapterConfig: { model: task.model } };
  }
  return ctx.issues.create({
    companyId,
    title: task.title,
    description: setSchedule(task.description, task.startLocal, task.askFirst && task.assigneeAgentId !== null),
    status: "backlog",
    ...(task.priority ? { priority: task.priority } : {}),
    ...(task.projectId ? { projectId: task.projectId } : {}),
    ...(task.parentId ? { parentId: task.parentId } : {}),
    ...(task.assigneeAgentId ? { assigneeAgentId: task.assigneeAgentId } : {}),
    ...(task.assigneeUserId ? { assigneeUserId: task.assigneeUserId } : {}),
    ...(assigneeAdapterOverrides ? { assigneeAdapterOverrides } : {}),
    actor,
  });
}

function parsePriority(value: unknown): IssuePriority | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string" || !PRIORITIES.has(value)) throw new Error("priority must be critical, high, medium or low");
  return value as IssuePriority;
}

function parseStartLocal(value: unknown): string {
  const startLocal = normalizeLocalInput(value);
  if (!startLocal) throw new Error(`startAt must be a valid 'YYYY-MM-DD HH:MM' time (${TIMEZONE})`);
  return startLocal;
}

const plugin = definePlugin({
  async setup(ctx) {
    ctx.jobs.register(JOB_KEY, async () => startDueTasks(ctx));

    ctx.data.register("scheduled", async (params): Promise<ScheduledData> => {
      const companyId = requireString(params.companyId, "companyId");
      const agents = await agentsById(ctx, companyId);
      const items: ScheduledItem[] = [];
      for (const issue of await listBacklog(ctx, companyId)) {
        const schedule = parseSchedule(issue.description);
        if (!schedule) continue;
        const pending = schedule.askFirst ? ((await ctx.state.get(confirmationScope(issue.id))) as Confirmation | null) : null;
        items.push({
          id: issue.id,
          identifier: issue.identifier,
          title: issue.title,
          startAt: schedule.startAt,
          raw: schedule.raw,
          askFirst: schedule.askFirst,
          awaitingConfirmation: pending !== null,
          assigneeAgentId: issue.assigneeAgentId,
          assigneeAgentName: issue.assigneeAgentId ? (agents.get(issue.assigneeAgentId)?.name ?? null) : null,
          assigneeUserId: issue.assigneeUserId,
          projectId: issue.projectId,
          priority: issue.priority,
        });
      }
      items.sort((a, b) => (a.startAt ?? Number.MAX_SAFE_INTEGER) - (b.startAt ?? Number.MAX_SAFE_INTEGER));
      return { timezone: TIMEZONE, enabled: await enabledFor(ctx, companyId), items };
    });

    ctx.data.register("issue-schedule", async (params): Promise<IssueScheduleData> => {
      const companyId = requireString(params.companyId, "companyId");
      const issue = await getIssue(ctx, requireString(params.issueId, "issueId"), companyId);
      const schedule = issue.status === "backlog" ? parseSchedule(issue.description) : null;
      return {
        timezone: TIMEZONE,
        status: issue.status,
        schedule: schedule ? { ...schedule, startLocal: schedule.startAt === null ? null : formatLocal(schedule.startAt) } : null,
        startedAt: startedAt(issue.description),
        awaitingConfirmation: schedule?.askFirst ? (await ctx.state.get(confirmationScope(issue.id))) !== null : false,
      };
    });

    ctx.data.register("agent-models", async (params): Promise<AgentModel[]> => {
      const companyId = requireString(params.companyId, "companyId");
      const agents = await ctx.agents.list({ companyId });
      return agents
        .filter((agent) => agent.status !== "terminated")
        .map((agent) => {
          const model = (agent.adapterConfig as Record<string, unknown> | null)?.model;
          return { agentId: agent.id, name: agent.name, adapterType: agent.adapterType, model: typeof model === "string" ? model : null };
        });
    });

    const boardOnly = (actorType: string) => {
      if (actorType !== "user") throw new Error("Only board users can change scheduled tasks from the UI");
    };

    ctx.actions.register("create-task", async (params, { actor }) => {
      boardOnly(actor.type);
      const companyId = requireString(actor.companyId ?? params.companyId, "companyId");
      const issue = await createScheduledTask(
        ctx,
        companyId,
        {
          title: requireString(params.title, "title"),
          description: typeof params.description === "string" ? params.description : "",
          startLocal: parseStartLocal(params.startAt),
          askFirst: params.askFirst === true,
          assigneeAgentId: optionalString(params.assigneeAgentId),
          assigneeUserId: optionalString(params.assigneeUserId),
          projectId: optionalString(params.projectId),
          parentId: null,
          priority: parsePriority(params.priority),
          model: optionalString(params.model),
        },
        { actorUserId: actor.userId },
      );
      return { id: issue.id, identifier: issue.identifier };
    });

    ctx.actions.register("set-schedule", async (params, { actor }) => {
      boardOnly(actor.type);
      const companyId = requireString(actor.companyId ?? params.companyId, "companyId");
      const issue = await getIssue(ctx, requireString(params.issueId, "issueId"), companyId);
      if (issue.status !== "backlog" && issue.status !== "todo") {
        throw new Error(`Only backlog or todo tasks can be scheduled; this one is ${issue.status}`);
      }
      const startLocal = parseStartLocal(params.startAt);
      await ctx.state.delete(confirmationScope(issue.id));
      await ctx.issues.update(
        issue.id,
        { status: "backlog", description: setSchedule(issue.description, startLocal, params.askFirst === true && issue.assigneeAgentId !== null) },
        companyId,
        { actorUserId: actor.userId },
      );
      return { ok: true };
    });

    // The UI uploads files with the host's attachment route (an upload never wakes the assignee,
    // unlike a comment) and then links them here, above the schedule lines.
    ctx.actions.register("add-attachment-links", async (params, { actor }) => {
      boardOnly(actor.type);
      const companyId = requireString(actor.companyId ?? params.companyId, "companyId");
      const issue = await getIssue(ctx, requireString(params.issueId, "issueId"), companyId);
      const files = Array.isArray(params.files) ? (params.files as Array<Record<string, unknown>>) : [];
      const lines = files.map((file) => {
        const path = typeof file.path === "string" ? file.path : "";
        if (!/^\/api\/[\w\-./]+$/.test(path)) throw new Error("Attachment path must be a Paperclip /api/ path");
        const name = String(file.name ?? "").replace(/[[\]\r\n]/g, " ").trim() || "file";
        return `- ${file.image === true ? "!" : ""}[${name}](${path})`;
      });
      if (lines.length === 0) return { ok: true };
      const description = insertBeforeSchedule(issue.description, ["**Attachments**", "", ...lines].join("\n"));
      await ctx.issues.update(issue.id, { description }, companyId, { actorUserId: actor.userId });
      return { ok: true };
    });

    ctx.actions.register("clear-schedule", async (params, { actor }) => {
      boardOnly(actor.type);
      const companyId = requireString(actor.companyId ?? params.companyId, "companyId");
      const issue = await getIssue(ctx, requireString(params.issueId, "issueId"), companyId);
      await ctx.state.delete(confirmationScope(issue.id));
      await ctx.issues.update(issue.id, { description: clearSchedule(issue.description ?? "") }, companyId, { actorUserId: actor.userId });
      return { ok: true };
    });

    ctx.actions.register("start-now", async (params, { actor }) => {
      boardOnly(actor.type);
      const companyId = requireString(actor.companyId ?? params.companyId, "companyId");
      const issue = await getIssue(ctx, requireString(params.issueId, "issueId"), companyId);
      const schedule = issue.status === "backlog" ? parseSchedule(issue.description) : null;
      if (!schedule) throw new Error("This task is not scheduled");
      await startTask(ctx, issue, schedule, "Started early from the Scheduled page");
      return { ok: true };
    });

    ctx.tools.register(
      TOOL_NAME,
      manifest.tools!.find((tool) => tool.name === TOOL_NAME)!,
      async (params, run) => {
        try {
          const p = (params ?? {}) as Record<string, unknown>;
          const wanted = requireString(p.assignee, "assignee").toLowerCase();
          const agents = (await ctx.agents.list({ companyId: run.companyId })).filter((a) => a.status !== "terminated");
          const agent = agents.find((a) => a.name.toLowerCase() === wanted);
          if (!agent) {
            return { error: `No agent named "${p.assignee}". Agents in this company: ${agents.map((a) => a.name).join(", ")}` };
          }
          const startLocal = parseStartLocal(p.startAt);
          const issue = await createScheduledTask(
            ctx,
            run.companyId,
            {
              title: requireString(p.title, "title"),
              description: typeof p.description === "string" ? p.description : "",
              startLocal,
              askFirst: p.askFirst === true,
              assigneeAgentId: agent.id,
              assigneeUserId: null,
              projectId: optionalString(run.projectId),
              parentId: optionalString(p.parentIssueId),
              priority: parsePriority(p.priority),
              model: optionalString(p.model),
            },
            { actorAgentId: run.agentId, actorRunId: run.runId },
          );
          return {
            content: `Scheduled ${issue.identifier ?? issue.id} for ${startLocal} (${TIMEZONE}), assigned to ${agent.name}. It stays in backlog until then.`,
            data: { issueId: issue.id, identifier: issue.identifier },
          };
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
      },
    );
  },

  async onHealth() {
    return { status: "ok", message: "Task scheduler worker is running" };
  },
});

export default plugin;
runWorker(plugin, import.meta.url);
