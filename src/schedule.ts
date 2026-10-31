/**
 * The schedule lives in the issue description, so it survives plugin reinstalls and can be
 * edited from the normal issue page or by an agent through the regular issues API:
 *
 *   start-at: 2026-11-01 09:00     (wall-clock time in TIMEZONE; an ISO time with Z/offset also works)
 *   ask-first: yes                 (optional: ask a board user before waking the agent)
 *
 * A `backlog` issue with a `start-at:` line is a scheduled task. When it starts, the key is
 * renamed to `started-at:` so the line is kept as history and never fires twice.
 */

export const TIMEZONE = "Europe/Madrid";

export type ScheduleKey = "start-at" | "started-at" | "start-declined" | "start-at-invalid";

export interface Schedule {
  /** UTC epoch ms, or null when the value could not be read. */
  startAt: number | null;
  /** The value as written after `start-at:`. */
  raw: string;
  askFirst: boolean;
}

// Optional markdown emphasis around the key, as in `**start-at:**` or `**start-at**:`.
const EMPHASIS = "[*_]{0,2}";

function keyPattern(key: string): RegExp {
  return new RegExp(`^([ \\t]*(?:[-*+][ \\t]+)?${EMPHASIS})(${key})(${EMPHASIS}:${EMPHASIS})[ \\t]*(.*?)[ \\t]*$`, "i");
}

const FENCE = /^[ \t]*(```|~~~)/;

/** Index of the first line with `key:` outside a fenced code block, or -1. */
function findLine(lines: string[], key: string): number {
  const pattern = keyPattern(key);
  let fenced = false;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE.test(lines[i])) {
      fenced = !fenced;
      continue;
    }
    if (!fenced && pattern.test(lines[i])) return i;
  }
  return -1;
}

function splitLines(description: string | null | undefined): string[] {
  return (description ?? "").split(/\r?\n/);
}

function lineValue(line: string, key: string): string {
  return (keyPattern(key).exec(line)?.[4] ?? "").trim();
}

const YES = /^(yes|true|1|y|si|sí)$/i;

export function parseSchedule(description: string | null | undefined): Schedule | null {
  const lines = splitLines(description);
  const index = findLine(lines, "start-at");
  if (index < 0) return null;
  const raw = lineValue(lines[index], "start-at");
  const askIndex = findLine(lines, "ask-first");
  return {
    startAt: parseStartAt(raw),
    raw,
    askFirst: askIndex >= 0 && YES.test(lineValue(lines[askIndex], "ask-first")),
  };
}

/** Value of a `started-at:` line, if the task was already started by the scheduler. */
export function startedAt(description: string | null | undefined): string | null {
  const lines = splitLines(description);
  const index = findLine(lines, "started-at");
  return index < 0 ? null : lineValue(lines[index], "started-at");
}

const LOCAL = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?(Z|[+-]\d{2}:?\d{2})?(?![\d:])/i;

/** `YYYY-MM-DD HH:MM` in TIMEZONE, or the same with a `Z`/`±HH:MM` suffix. Returns UTC ms. */
export function parseStartAt(value: string): number | null {
  const m = LOCAL.exec(value.trim());
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1, 7).map((part) => Number(part ?? 0));
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || s > 59) return null;
  // Reject dates like 2026-02-30 instead of letting them roll over.
  const check = new Date(Date.UTC(y, mo - 1, d));
  if (check.getUTCMonth() !== mo - 1 || check.getUTCDate() !== d) return null;
  const zone = m[7];
  if (zone) {
    const iso = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6] ?? "00"}${zone.length === 5 ? `${zone.slice(0, 3)}:${zone.slice(3)}` : zone}`;
    const ms = Date.parse(iso);
    return Number.isNaN(ms) ? null : ms;
  }
  return zonedToUtc(y, mo, d, h, mi, s);
}

function offsetMs(utcMs: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMs));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - Math.floor(utcMs / 1000) * 1000;
}

/**
 * Wall-clock time in `timeZone` to UTC ms. A time skipped by a DST jump moves forward by the
 * jump (02:30 on the spring-forward day becomes 03:30); a repeated time resolves to its second
 * occurrence.
 */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, s = 0, timeZone = TIMEZONE): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const first = offsetMs(guess, timeZone);
  const candidate = guess - first;
  const second = offsetMs(candidate, timeZone);
  return second === first ? candidate : guess - second;
}

/** UTC ms to `YYYY-MM-DD HH:MM` in `timeZone`. */
export function formatLocal(utcMs: number, timeZone = TIMEZONE): string {
  const local = new Date(utcMs + offsetMs(utcMs, timeZone));
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())} ${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

function renameKey(description: string, from: ScheduleKey, to: ScheduleKey): string {
  const lines = splitLines(description);
  const index = findLine(lines, from);
  if (index < 0) return description;
  lines[index] = lines[index].replace(keyPattern(from), (_all, pre, _key, post, value) => `${pre}${to}${post} ${value}`.trimEnd());
  return lines.join("\n");
}

export const markStarted = (description: string) => renameKey(description, "start-at", "started-at");
export const markDeclined = (description: string) => renameKey(description, "start-at", "start-declined");
export const markInvalid = (description: string) => renameKey(description, "start-at", "start-at-invalid");

/** Replace any `start-at:`/`ask-first:` lines with fresh ones at the end of the description. */
export function setSchedule(description: string | null | undefined, startLocal: string, askFirst: boolean): string {
  const lines = splitLines(clearSchedule(description ?? ""));
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  if (lines.length > 0) lines.push("");
  lines.push(`start-at: ${startLocal}`);
  if (askFirst) lines.push("ask-first: yes");
  return lines.join("\n");
}

/** Remove every `start-at:` and `ask-first:` line outside code blocks. */
export function clearSchedule(description: string): string {
  let lines = splitLines(description);
  for (const key of ["start-at", "ask-first"]) {
    for (let index = findLine(lines, key); index >= 0; index = findLine(lines, key)) {
      lines = [...lines.slice(0, index), ...lines.slice(index + 1)];
    }
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") lines.pop();
  return lines.join("\n");
}

/** `YYYY-MM-DDTHH:MM` from `<input type="datetime-local">` to the line format, or null. */
export function normalizeLocalInput(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})$/.exec(value.trim());
  if (!m || parseStartAt(`${m[1]} ${m[2]}`) === null) return null;
  return `${m[1]} ${m[2]}`;
}
