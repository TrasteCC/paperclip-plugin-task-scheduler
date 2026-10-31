import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import {
  AssigneePicker,
  MarkdownEditor,
  ProjectPicker,
  Spinner,
  useHostNavigation,
  usePluginAction,
  usePluginData,
  usePluginToast,
  type PluginHostContext,
  type PluginPageProps,
  type PluginSidebarProps,
  type PluginWidgetProps,
} from "@paperclipai/plugin-sdk/ui";
import { MODEL_ADAPTERS, PAGE_ROUTE } from "../manifest.js";
import { TIMEZONE } from "../schedule.js";
import type { AgentModel, IssueScheduleData, ScheduledData, ScheduledItem } from "../worker.js";
import { BUCKETS, bucketOf, dayOf, defaultStartInput, fullOf, relative, timeOf, toInputValue, type Bucket } from "./format.js";

// ---------------------------------------------------------------- styles (host theme variables only)

const muted: CSSProperties = { color: "var(--muted-foreground)", fontSize: "13px" };
const card: CSSProperties = {
  background: "var(--card)",
  color: "var(--card-foreground, var(--foreground))",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius, 8px)",
};
const stack = (gap: number): CSSProperties => ({ display: "grid", gap: `${gap}px` });
const row: CSSProperties = { display: "flex", alignItems: "center", gap: "8px", flexWrap: "wrap" };
const input: CSSProperties = {
  width: "100%",
  boxSizing: "border-box",
  padding: "7px 10px",
  fontSize: "14px",
  color: "var(--foreground)",
  background: "var(--background)",
  border: "1px solid var(--input, var(--border))",
  borderRadius: "calc(var(--radius, 8px) - 2px)",
};
const label: CSSProperties = { display: "grid", gap: "6px", fontSize: "13px", fontWeight: 500 };

function buttonStyle(kind: "primary" | "ghost" | "danger" = "ghost"): CSSProperties {
  const base: CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "6px",
    padding: "6px 12px",
    fontSize: "13px",
    fontWeight: 500,
    borderRadius: "calc(var(--radius, 8px) - 2px)",
    cursor: "pointer",
    border: "1px solid var(--border)",
    background: "transparent",
    color: "var(--foreground)",
    whiteSpace: "nowrap",
  };
  if (kind === "primary") return { ...base, background: "var(--primary)", color: "var(--primary-foreground)", borderColor: "var(--primary)" };
  if (kind === "danger") return { ...base, color: "var(--destructive)" };
  return base;
}

function Badge({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "accent" | "danger" }) {
  const colors: Record<string, CSSProperties> = {
    muted: { background: "var(--muted)", color: "var(--muted-foreground)" },
    accent: { background: "var(--primary)", color: "var(--primary-foreground)" },
    danger: { background: "transparent", color: "var(--destructive)", border: "1px solid var(--destructive)" },
  };
  return (
    <span style={{ fontSize: "11px", fontWeight: 600, padding: "2px 8px", borderRadius: "999px", whiteSpace: "nowrap", ...colors[tone] }}>
      {children}
    </span>
  );
}

function ClockIcon({ size = 16 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="3" y="4.5" width="18" height="16" rx="2.5" />
      <path d="M3 9h18M8 2.5v4M16 2.5v4" />
      <path d="M12 12.5v3l2 1.5" />
    </svg>
  );
}

function XIcon({ size = 15 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}

const iconButton: CSSProperties = { ...buttonStyle(), padding: "6px 8px" };

// ---------------------------------------------------------------- hooks

function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/** Re-fetch every minute so tasks disappear from the list once the scheduler starts them. */
function useScheduled(companyId: string | null) {
  const params = useMemo(() => ({ companyId }), [companyId]);
  const result = usePluginData<ScheduledData>("scheduled", params);
  const { refresh } = result;
  useEffect(() => {
    const timer = setInterval(refresh, 60_000);
    return () => clearInterval(timer);
  }, [refresh]);
  return result;
}

const errorText = (err: unknown) => (err instanceof Error ? err.message : typeof err === "object" && err && "message" in err ? String(err.message) : String(err));

/** Run an action, toast the outcome, then refresh. */
function useRunner(refresh: () => void) {
  const toast = usePluginToast();
  const [busy, setBusy] = useState(false);
  async function run(task: () => Promise<unknown>, success: string): Promise<boolean> {
    setBusy(true);
    try {
      await task();
      toast({ title: success, tone: "success" });
      refresh();
      return true;
    } catch (err) {
      toast({ title: "Could not update the task", body: errorText(err), tone: "error" });
      return false;
    } finally {
      setBusy(false);
    }
  }
  return { busy, run };
}

// ---------------------------------------------------------------- dialog

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
      // z-index 50 = the host's dialog layer, so host pickers (portaled later, also z-50) open above it.
      style={{ position: "fixed", inset: 0, zIndex: 50, display: "grid", placeItems: "center", padding: "16px", background: "rgb(0 0 0 / 0.45)" }}
    >
      <div style={{ ...card, width: "min(560px, 100%)", maxHeight: "calc(100vh - 32px)", overflow: "auto", padding: "20px", boxShadow: "0 20px 50px rgb(0 0 0 / 0.25)" }}>
        <h2 style={{ margin: "0 0 16px", fontSize: "17px", fontWeight: 600 }}>{title}</h2>
        {children}
      </div>
    </div>
  );
}

function StartFields({
  start,
  onStart,
  askFirst,
  onAskFirst,
  allowAskFirst,
}: {
  start: string;
  onStart: (value: string) => void;
  askFirst: boolean;
  onAskFirst: (value: boolean) => void;
  allowAskFirst: boolean;
}) {
  return (
    <>
      <label style={label}>
        <span>
          Start at <span style={{ ...muted, fontWeight: 400 }}>({TIMEZONE})</span>
        </span>
        <input type="datetime-local" value={start} onChange={(e) => onStart(e.target.value)} style={input} required />
      </label>
      <label style={{ ...row, fontSize: "13px", opacity: allowAskFirst ? 1 : 0.5 }}>
        <input type="checkbox" checked={askFirst && allowAskFirst} disabled={!allowAskFirst} onChange={(e) => onAskFirst(e.target.checked)} />
        Ask me before waking the agent
      </label>
    </>
  );
}

function NewTaskDialog({ companyId, onClose, onDone }: { companyId: string; onClose: () => void; onDone: () => void }) {
  const create = usePluginAction("create-task");
  const toast = usePluginToast();
  const params = useMemo(() => ({ companyId }), [companyId]);
  const { data: agents } = usePluginData<AgentModel[]>("agent-models", params);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [assignee, setAssignee] = useState("");
  const [projectId, setProjectId] = useState("");
  const [start, setStart] = useState(() => defaultStartInput(Date.now()));
  const [askFirst, setAskFirst] = useState(false);
  const [model, setModel] = useState("");
  const [priority, setPriority] = useState("medium");
  const [saving, setSaving] = useState(false);

  const agentId = assignee.startsWith("agent:") ? assignee.slice(6) : null;
  const agent = agents?.find((a) => a.agentId === agentId) ?? null;
  const modelAllowed = agent !== null && MODEL_ADAPTERS.has(agent.adapterType);
  const models = [...new Set((agents ?? []).filter((a) => MODEL_ADAPTERS.has(a.adapterType) && a.model).map((a) => a.model!))].sort();

  async function submit() {
    setSaving(true);
    try {
      const result = (await create({
        companyId,
        title,
        description,
        assigneeAgentId: agentId,
        assigneeUserId: assignee.startsWith("user:") ? assignee.slice(5) : null,
        projectId: projectId || null,
        startAt: start,
        askFirst: askFirst && agentId !== null,
        model: modelAllowed ? model : null,
        priority,
      })) as { identifier: string | null };
      toast({ title: `Scheduled ${result.identifier ?? "task"}`, body: `Starts ${start.replace("T", " ")} (${TIMEZONE})`, tone: "success" });
      onDone();
    } catch (err) {
      toast({ title: "Could not schedule the task", body: errorText(err), tone: "error" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal title="New scheduled task" onClose={onClose}>
      <form
        style={stack(14)}
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <label style={label}>
          Title
          <input value={title} onChange={(e) => setTitle(e.target.value)} style={input} placeholder="What needs doing" required autoFocus />
        </label>
        <div style={label}>
          Description
          <MarkdownEditor value={description} onChange={setDescription} placeholder="Details, context, links…" bordered />
        </div>
        <div style={{ display: "grid", gap: "14px", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <div style={label}>
            Assignee
            <AssigneePicker companyId={companyId} value={assignee} onChange={(value) => setAssignee(value)} placeholder="Choose agent or person" noneLabel="Unassigned" />
          </div>
          <div style={label}>
            Project
            <ProjectPicker companyId={companyId} value={projectId} onChange={setProjectId} placeholder="No project" noneLabel="No project" />
          </div>
        </div>
        <StartFields start={start} onStart={setStart} askFirst={askFirst} onAskFirst={setAskFirst} allowAskFirst={agentId !== null} />
        <div style={{ display: "grid", gap: "14px", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))" }}>
          <label style={{ ...label, opacity: modelAllowed ? 1 : 0.5 }}>
            Model
            <input
              list="task-scheduler-models"
              value={modelAllowed ? model : ""}
              onChange={(e) => setModel(e.target.value)}
              disabled={!modelAllowed}
              style={input}
              placeholder={agent?.model ? `Agent default: ${agent.model}` : modelAllowed ? "Agent default" : "Not available for this assignee"}
            />
            <datalist id="task-scheduler-models">
              {models.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </label>
          <label style={label}>
            Priority
            <select value={priority} onChange={(e) => setPriority(e.target.value)} style={input}>
              {["critical", "high", "medium", "low"].map((p) => (
                <option key={p} value={p}>
                  {p[0].toUpperCase() + p.slice(1)}
                </option>
              ))}
            </select>
          </label>
        </div>
        <p style={{ ...muted, margin: 0 }}>The task waits in backlog. Its assignee is only woken at the start time.</p>
        <div style={{ ...row, justifyContent: "flex-end" }}>
          <button type="button" style={buttonStyle()} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" style={buttonStyle("primary")} disabled={saving || !title.trim() || !start}>
            {saving ? "Scheduling…" : "Schedule task"}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function RescheduleDialog({
  companyId,
  issueId,
  current,
  askFirst: initialAskFirst,
  hasAgent,
  onClose,
  onDone,
}: {
  companyId: string;
  issueId: string;
  current: number | null;
  askFirst: boolean;
  hasAgent: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const setSchedule = usePluginAction("set-schedule");
  const { busy, run } = useRunner(onDone);
  const [start, setStart] = useState(() => (current ? toInputValue(current) : defaultStartInput(Date.now())));
  const [askFirst, setAskFirst] = useState(initialAskFirst);
  return (
    <Modal title="Reschedule" onClose={onClose}>
      <form
        style={stack(14)}
        onSubmit={async (event) => {
          event.preventDefault();
          if (await run(() => setSchedule({ companyId, issueId, startAt: start, askFirst }), `Rescheduled for ${start.replace("T", " ")}`)) onClose();
        }}
      >
        <StartFields start={start} onStart={setStart} askFirst={askFirst} onAskFirst={setAskFirst} allowAskFirst={hasAgent} />
        <div style={{ ...row, justifyContent: "flex-end" }}>
          <button type="button" style={buttonStyle()} onClick={onClose}>
            Cancel
          </button>
          <button type="submit" style={buttonStyle("primary")} disabled={busy || !start}>
            Save
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ---------------------------------------------------------------- page

function assigneeLabel(item: ScheduledItem, userId: string | null): string {
  if (item.assigneeAgentId) return item.assigneeAgentName ?? "Agent";
  if (item.assigneeUserId) return item.assigneeUserId === userId ? "You" : "Board user";
  return "Unassigned";
}

function TaskRow({ item, now, companyId, userId, onChanged }: { item: ScheduledItem; now: number; companyId: string; userId: string | null; onChanged: () => void }) {
  const nav = useHostNavigation();
  const startNow = usePluginAction("start-now");
  const clear = usePluginAction("clear-schedule");
  const { busy, run } = useRunner(onChanged);
  const [rescheduling, setRescheduling] = useState(false);
  const ref = item.identifier ?? item.id;
  return (
    // Wraps the actions under the title on narrow screens.
    <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 12px", alignItems: "center", padding: "12px 16px", borderTop: "1px solid var(--border)" }}>
      <div style={{ display: "flex", gap: "12px", alignItems: "center", flex: "1 1 300px", minWidth: 0 }}>
      <div style={{ display: "grid", flex: "0 0 76px" }}>
        {item.startAt === null ? (
          <span style={{ color: "var(--destructive)", fontSize: "13px" }}>—</span>
        ) : (
          <>
            <span style={{ fontSize: "15px", fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{timeOf(item.startAt)}</span>
            <span style={{ ...muted, fontSize: "12px" }}>{dayOf(item.startAt)}</span>
          </>
        )}
      </div>
      <div style={{ ...stack(4), minWidth: 0 }}>
        <a {...nav.linkProps(`/issues/${ref}`)} style={{ color: "var(--foreground)", textDecoration: "none", fontWeight: 500, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>
          <span style={{ ...muted, marginRight: "8px" }}>{ref}</span>
          {item.title}
        </a>
        <div style={row}>
          <span style={muted}>{assigneeLabel(item, userId)}</span>
          {item.startAt !== null && <span style={muted}>· {relative(item.startAt, now)}</span>}
          {item.askFirst && !item.awaitingConfirmation && <Badge>Ask first</Badge>}
          {item.awaitingConfirmation && <Badge tone="accent">Waiting for your OK</Badge>}
          {item.startAt === null && <Badge tone="danger">Can't read "{item.raw}"</Badge>}
        </div>
      </div>
      </div>
      <div style={{ ...row, gap: "6px" }}>
        <button type="button" style={buttonStyle()} disabled={busy} onClick={() => void run(() => startNow({ companyId, issueId: item.id }), `Started ${ref}`)}>
          Start now
        </button>
        <button type="button" style={iconButton} disabled={busy} title="Reschedule" aria-label="Reschedule" onClick={() => setRescheduling(true)}>
          <ClockIcon size={15} />
        </button>
        <button
          type="button"
          style={{ ...iconButton, color: "var(--destructive)" }}
          disabled={busy}
          title="Unschedule (the task stays in backlog)"
          aria-label="Unschedule"
          onClick={() => void run(() => clear({ companyId, issueId: item.id }), `Unscheduled ${ref}`)}
        >
          <XIcon />
        </button>
      </div>
      {rescheduling && (
        <RescheduleDialog
          companyId={companyId}
          issueId={item.id}
          current={item.startAt}
          askFirst={item.askFirst}
          hasAgent={item.assigneeAgentId !== null}
          onClose={() => setRescheduling(false)}
          onDone={onChanged}
        />
      )}
    </div>
  );
}

export function ScheduledPage({ context }: PluginPageProps) {
  const { data, loading, error, refresh } = useScheduled(context.companyId);
  const now = useNow();
  const [creating, setCreating] = useState(false);
  const companyId = context.companyId;

  const groups = useMemo(() => {
    const map = new Map<Bucket, ScheduledItem[]>();
    for (const item of data?.items ?? []) {
      const bucket = bucketOf(item.startAt, now);
      map.set(bucket, [...(map.get(bucket) ?? []), item]);
    }
    return BUCKETS.filter((b) => map.has(b.key)).map((b) => ({ ...b, items: map.get(b.key)! }));
  }, [data, now]);

  if (!companyId) return <p style={muted}>Select a company to see its scheduled tasks.</p>;

  return (
    <div style={{ ...stack(20), maxWidth: "960px", margin: "0 auto", padding: "24px 16px" }}>
      <header style={{ ...row, justifyContent: "space-between" }}>
        <div style={stack(4)}>
          <h1 style={{ ...row, margin: 0, fontSize: "22px", fontWeight: 600 }}>
            <ClockIcon size={20} /> Scheduled
          </h1>
          <span style={muted}>One-off tasks that start at a set time ({TIMEZONE}). Agents are only woken when their time comes.</span>
        </div>
        <button type="button" style={buttonStyle("primary")} onClick={() => setCreating(true)}>
          + New scheduled task
        </button>
      </header>

      {loading && !data && <Spinner />}
      {error && <p style={{ color: "var(--destructive)" }}>Could not load scheduled tasks: {error.message}</p>}
      {data && !data.enabled && (
        <div style={{ ...card, padding: "12px 16px", borderColor: "var(--destructive)" }}>
          <strong>The scheduler is off for this company.</strong>{" "}
          <span style={muted}>Tasks below will not start until an instance admin turns on "Start scheduled tasks in this company" in the Scheduled Tasks plugin settings.</span>
        </div>
      )}

      {data && groups.length === 0 && (
        <div style={{ ...card, ...stack(10), padding: "40px 24px", textAlign: "center", justifyItems: "center" }}>
          <ClockIcon size={28} />
          <strong>Nothing scheduled</strong>
          <span style={muted}>Schedule a task here, from an issue's Schedule tab, or add a line like `start-at: 2026-11-02 09:00` to a backlog issue.</span>
          <button type="button" style={buttonStyle("primary")} onClick={() => setCreating(true)}>
            Schedule a task
          </button>
        </div>
      )}

      {groups.map((group) => (
        <section key={group.key} style={{ ...card, overflow: "hidden" }}>
          <div style={{ ...row, justifyContent: "space-between", padding: "10px 16px", background: "var(--muted)" }}>
            <strong style={{ fontSize: "13px", color: group.key === "invalid" ? "var(--destructive)" : undefined }}>{group.label}</strong>
            <span style={muted}>{group.items.length}</span>
          </div>
          {group.items.map((item) => (
            <TaskRow key={item.id} item={item} now={now} companyId={companyId} userId={context.userId} onChanged={refresh} />
          ))}
        </section>
      ))}

      {creating && (
        <NewTaskDialog
          companyId={companyId}
          onClose={() => setCreating(false)}
          onDone={() => {
            setCreating(false);
            refresh();
          }}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------- issue page button

function SchedulePanel({ companyId, issueId, data, refresh, onClose }: { companyId: string; issueId: string; data: IssueScheduleData; refresh: () => void; onClose: () => void }) {
  const setSchedule = usePluginAction("set-schedule");
  const clear = usePluginAction("clear-schedule");
  const startNow = usePluginAction("start-now");
  const { busy, run } = useRunner(refresh);
  const now = useNow();
  const schedule = data.schedule;
  const [start, setStart] = useState(() => (schedule?.startAt ? toInputValue(schedule.startAt) : defaultStartInput(Date.now())));
  const [askFirst, setAskFirst] = useState(schedule?.askFirst ?? false);
  const act = async (task: () => Promise<unknown>, success: string) => {
    if (await run(task, success)) onClose();
  };

  return (
    <div style={stack(16)}>
      {schedule && (
        <div style={{ ...card, ...stack(8), padding: "12px 14px", background: "var(--muted)" }}>
          {schedule.startAt === null ? (
            <strong style={{ color: "var(--destructive)" }}>Can't read start-at "{schedule.raw}"</strong>
          ) : (
            <strong>
              Starts {fullOf(schedule.startAt)} · {relative(schedule.startAt, now)}
            </strong>
          )}
          {schedule.askFirst && <span style={muted}>{data.awaitingConfirmation ? "Waiting for your OK on the task." : "You will be asked before the agent is woken."}</span>}
          <div style={row}>
            <button type="button" style={buttonStyle()} disabled={busy} onClick={() => void act(() => startNow({ companyId, issueId }), "Started")}>
              Start now
            </button>
            <button type="button" style={buttonStyle("danger")} disabled={busy} onClick={() => void act(() => clear({ companyId, issueId }), "Unscheduled")}>
              Unschedule
            </button>
          </div>
        </div>
      )}
      <form
        style={stack(12)}
        onSubmit={(event) => {
          event.preventDefault();
          void act(() => setSchedule({ companyId, issueId, startAt: start, askFirst }), `Scheduled for ${start.replace("T", " ")}`);
        }}
      >
        <StartFields start={start} onStart={setStart} askFirst={askFirst} onAskFirst={setAskFirst} allowAskFirst />
        {data.status === "todo" && !schedule && <span style={muted}>Scheduling moves this task back to backlog until the start time.</span>}
        <span style={muted}>
          The schedule is the <code>start-at:</code> line in the description, so you can also edit it there.
        </span>
        <div style={{ ...row, justifyContent: "flex-end" }}>
          <button type="button" style={buttonStyle()} onClick={onClose}>
            Close
          </button>
          <button type="submit" style={buttonStyle("primary")} disabled={busy || !start}>
            {schedule ? "Reschedule" : "Schedule"}
          </button>
        </div>
      </form>
    </div>
  );
}

/** Under the task header: the start time when scheduled, "Schedule…" on backlog/todo tasks, nothing otherwise. */
export function IssueScheduleButton({ context }: { context: PluginHostContext }) {
  const companyId = context.companyId;
  const issueId = context.entityId;
  const params = useMemo(() => ({ companyId, issueId }), [companyId, issueId]);
  const { data, refresh } = usePluginData<IssueScheduleData>("issue-schedule", params);
  const [open, setOpen] = useState(false);
  if (!companyId || !issueId || !data) return null;
  const schedule = data.schedule;
  if (!schedule && data.status !== "backlog" && data.status !== "todo") return null;

  const text = !schedule ? "Schedule…" : schedule.startAt === null ? "Start date unreadable" : `Starts ${dayOf(schedule.startAt)}, ${timeOf(schedule.startAt)}`;
  const tone: CSSProperties = schedule?.startAt === null ? { color: "var(--destructive)", borderColor: "var(--destructive)" } : schedule ? { background: "var(--muted)" } : { color: "var(--muted-foreground)" };
  return (
    <>
      <button type="button" style={{ ...buttonStyle(), ...tone, padding: "4px 10px", fontSize: "12px" }} onClick={() => setOpen(true)} title="Scheduled start">
        <ClockIcon size={14} />
        {text}
        {schedule?.askFirst && <Badge>{data.awaitingConfirmation ? "Waiting for your OK" : "Ask first"}</Badge>}
      </button>
      {open && (
        <Modal title={schedule ? "Scheduled start" : "Schedule this task"} onClose={() => setOpen(false)}>
          <SchedulePanel companyId={companyId} issueId={issueId} data={data} refresh={refresh} onClose={() => setOpen(false)} />
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------- dashboard widget & sidebar

export function ScheduledWidget({ context }: PluginWidgetProps) {
  const nav = useHostNavigation();
  const { data } = useScheduled(context.companyId);
  const now = useNow();
  const next = (data?.items ?? []).filter((i) => i.startAt !== null).slice(0, 5);
  return (
    <div style={stack(10)}>
      <div style={{ ...row, justifyContent: "space-between" }}>
        <strong style={row}>
          <ClockIcon /> Scheduled
        </strong>
        <a {...nav.linkProps(`/${PAGE_ROUTE}`)} style={{ ...muted, textDecoration: "none" }}>
          {data ? `${data.items.length} total →` : "Open →"}
        </a>
      </div>
      {next.length === 0 ? (
        <span style={muted}>Nothing scheduled.</span>
      ) : (
        next.map((item) => (
          <a key={item.id} {...nav.linkProps(`/issues/${item.identifier ?? item.id}`)} style={{ display: "grid", gridTemplateColumns: "auto 1fr", gap: "10px", color: "var(--foreground)", textDecoration: "none", fontSize: "13px" }}>
            <span style={{ ...muted, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" }}>
              {bucketOf(item.startAt, now) === "today" ? timeOf(item.startAt!) : `${dayOf(item.startAt!)} ${timeOf(item.startAt!)}`}
            </span>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {item.title} <span style={muted}>· {item.assigneeAgentName ?? (item.assigneeUserId ? "person" : "unassigned")}</span>
            </span>
          </a>
        ))
      )}
    </div>
  );
}

export function ScheduledSidebarLink(_props: PluginSidebarProps) {
  const nav = useHostNavigation();
  const href = nav.resolveHref(`/${PAGE_ROUTE}`);
  const active = typeof window !== "undefined" && window.location.pathname === href;
  // Same classes as the host's own sidebar items (pattern from the SDK's kitchen-sink example).
  return (
    <a
      {...nav.linkProps(`/${PAGE_ROUTE}`)}
      aria-current={active ? "page" : undefined}
      className={[
        "flex items-center gap-2.5 px-3 py-2 text-[13px] font-medium transition-colors",
        active ? "bg-accent text-foreground" : "text-foreground/80 hover:bg-accent/50 hover:text-foreground",
      ].join(" ")}
    >
      <span className="relative shrink-0">
        <ClockIcon />
      </span>
      <span className="flex-1 truncate">Scheduled</span>
    </a>
  );
}
