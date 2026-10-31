import { TIMEZONE, formatLocal } from "../schedule.js";

export type Bucket = "due" | "today" | "tomorrow" | "week" | "later" | "invalid";

export const BUCKETS: Array<{ key: Bucket; label: string }> = [
  { key: "due", label: "Starting now" },
  { key: "today", label: "Today" },
  { key: "tomorrow", label: "Tomorrow" },
  { key: "week", label: "Next 7 days" },
  { key: "later", label: "Later" },
  { key: "invalid", label: "Needs a valid date" },
];

const localDate = (ms: number) => formatLocal(ms).slice(0, 10);

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Calendar buckets in TIMEZONE, so "tomorrow" stays right across DST changes. */
export function bucketOf(startAt: number | null, now: number): Bucket {
  if (startAt === null) return "invalid";
  if (startAt <= now) return "due";
  const day = localDate(startAt);
  const today = localDate(now);
  if (day === today) return "today";
  if (day === addDays(today, 1)) return "tomorrow";
  if (day <= addDays(today, 7)) return "week";
  return "later";
}

const dayFormat = new Intl.DateTimeFormat("en-GB", { timeZone: TIMEZONE, weekday: "short", day: "numeric", month: "short" });
const fullFormat = new Intl.DateTimeFormat("en-GB", {
  timeZone: TIMEZONE,
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export const timeOf = (ms: number) => formatLocal(ms).slice(11);
export const dayOf = (ms: number) => dayFormat.format(ms);
export const fullOf = (ms: number) => fullFormat.format(ms);

export function relative(ms: number, now: number): string {
  const minutes = Math.round((ms - now) / 60_000);
  if (minutes <= 0) return "starting now";
  if (minutes < 60) return `in ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `in ${hours} h`;
  return `in ${Math.round(hours / 24)} days`;
}

/** Value for `<input type="datetime-local">`, in TIMEZONE. */
export const toInputValue = (ms: number) => formatLocal(ms).replace(" ", "T");

/** Tomorrow at 09:00 in TIMEZONE. */
export const defaultStartInput = (now: number) => `${addDays(localDate(now), 1)}T09:00`;
