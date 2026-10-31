import { describe, expect, it } from "vitest";
import {
  clearSchedule,
  insertBeforeSchedule,
  formatLocal,
  markDeclined,
  markInvalid,
  markStarted,
  normalizeLocalInput,
  parseSchedule,
  parseStartAt,
  setSchedule,
  startedAt,
} from "../src/schedule.js";

const iso = (ms: number | null) => (ms === null ? null : new Date(ms).toISOString());

describe("parseStartAt", () => {
  it("reads Madrid wall-clock time in winter and summer", () => {
    expect(iso(parseStartAt("2026-11-01 09:00"))).toBe("2026-11-01T08:00:00.000Z");
    expect(iso(parseStartAt("2026-07-15T09:00"))).toBe("2026-07-15T07:00:00.000Z");
    expect(iso(parseStartAt("2026-07-15 09:00:30"))).toBe("2026-07-15T07:00:30.000Z");
  });

  it("honors an explicit zone", () => {
    expect(iso(parseStartAt("2026-11-01T09:00Z"))).toBe("2026-11-01T09:00:00.000Z");
    expect(iso(parseStartAt("2026-11-01 09:00+05:30"))).toBe("2026-11-01T03:30:00.000Z");
    expect(iso(parseStartAt("2026-11-01 09:00-0300"))).toBe("2026-11-01T12:00:00.000Z");
  });

  it("ignores trailing notes after the time", () => {
    expect(iso(parseStartAt("2026-11-01 09:00 (Madrid, after the weekly job)"))).toBe("2026-11-01T08:00:00.000Z");
  });

  it("moves a time skipped by spring-forward ahead by an hour", () => {
    // 2026-03-29: 02:00 CET jumps to 03:00 CEST.
    expect(iso(parseStartAt("2026-03-29 02:30"))).toBe("2026-03-29T01:30:00.000Z");
    expect(formatLocal(parseStartAt("2026-03-29 02:30")!)).toBe("2026-03-29 03:30");
  });

  it("resolves a repeated fall-back time to its second occurrence", () => {
    // 2026-10-25: 03:00 CEST falls back to 02:00 CET, so 02:30 happens twice.
    expect(iso(parseStartAt("2026-10-25 02:30"))).toBe("2026-10-25T01:30:00.000Z");
  });

  it("rejects malformed and impossible values", () => {
    for (const bad of ["", "tomorrow", "2026-11-01", "2026-13-01 09:00", "2026-02-30 09:00", "2026-11-01 24:00", "2026-11-01 09:61", "2026-11-01 09:000"]) {
      expect(parseStartAt(bad), bad).toBeNull();
    }
  });
});

describe("formatLocal", () => {
  it("prints Madrid wall-clock time", () => {
    expect(formatLocal(Date.parse("2026-11-01T08:00:00Z"))).toBe("2026-11-01 09:00");
    expect(formatLocal(Date.parse("2026-07-15T22:30:00Z"))).toBe("2026-07-16 00:30");
  });
});

describe("parseSchedule", () => {
  it("finds the line anywhere outside code fences", () => {
    const description = "Fix the backup job.\n\nstart-at: 2026-11-01 09:00\nask-first: yes";
    expect(parseSchedule(description)).toEqual({ startAt: Date.parse("2026-11-01T08:00:00Z"), raw: "2026-11-01 09:00", askFirst: true });
  });

  it("accepts markdown emphasis, list bullets, case and stray spaces", () => {
    for (const line of ["**start-at:** 2026-11-01 09:00", "**start-at**: 2026-11-01 09:00", "- start-at: 2026-11-01 09:00", "  Start-At:   2026-11-01 09:00   "]) {
      expect(parseSchedule(`Intro\n${line}`)?.startAt, line).toBe(Date.parse("2026-11-01T08:00:00Z"));
    }
  });

  it("ignores lines inside fenced code blocks", () => {
    expect(parseSchedule("```\nstart-at: 2026-11-01 09:00\n```")).toBeNull();
    expect(parseSchedule("```\nstart-at: 2026-11-01 09:00\n```\nstart-at: 2026-12-01 10:00")?.raw).toBe("2026-12-01 10:00");
  });

  it("ignores the history keys and other prefixes", () => {
    expect(parseSchedule("started-at: 2026-11-01 09:00")).toBeNull();
    expect(parseSchedule("start-at-invalid: soon")).toBeNull();
    expect(parseSchedule("restart-at: 2026-11-01 09:00")).toBeNull();
    expect(parseSchedule(null)).toBeNull();
  });

  it("keeps an unreadable value so it can be reported", () => {
    expect(parseSchedule("start-at: next monday")).toEqual({ startAt: null, raw: "next monday", askFirst: false });
  });

  it("treats only yes-like ask-first values as on", () => {
    expect(parseSchedule("start-at: 2026-11-01 09:00\nask-first: no")?.askFirst).toBe(false);
    expect(parseSchedule("start-at: 2026-11-01 09:00\nask-first: sí")?.askFirst).toBe(true);
  });
});

describe("description edits", () => {
  it("renames the key when the task starts, keeping the value and emphasis", () => {
    expect(markStarted("Do it.\n**start-at:** 2026-11-01 09:00")).toBe("Do it.\n**started-at:** 2026-11-01 09:00");
    expect(startedAt(markStarted("start-at: 2026-11-01 09:00"))).toBe("2026-11-01 09:00");
    expect(markDeclined("start-at: 2026-11-01 09:00")).toBe("start-declined: 2026-11-01 09:00");
    expect(markInvalid("start-at: soon")).toBe("start-at-invalid: soon");
  });

  it("sets the schedule at the end, replacing an old one", () => {
    expect(setSchedule("Fix the backup job.\n", "2026-11-01 09:00", false)).toBe("Fix the backup job.\n\nstart-at: 2026-11-01 09:00");
    expect(setSchedule("", "2026-11-01 09:00", true)).toBe("start-at: 2026-11-01 09:00\nask-first: yes");
    expect(setSchedule("A\nstart-at: 2026-10-01 09:00\nask-first: yes\nB", "2026-11-01 09:00", false)).toBe("A\nB\n\nstart-at: 2026-11-01 09:00");
  });

  it("clears the schedule but keeps history lines", () => {
    expect(clearSchedule("A\nstarted-at: 2026-10-01 09:00\nstart-at: 2026-11-01 09:00\nask-first: yes")).toBe("A\nstarted-at: 2026-10-01 09:00");
  });
});

describe("normalizeLocalInput", () => {
  it("accepts datetime-local values and rejects anything else", () => {
    expect(normalizeLocalInput("2026-11-01T09:00")).toBe("2026-11-01 09:00");
    expect(normalizeLocalInput("2026-11-01 09:00")).toBe("2026-11-01 09:00");
    expect(normalizeLocalInput("2026-02-30T09:00")).toBeNull();
    expect(normalizeLocalInput("2026-11-01T09:00Z")).toBeNull();
    expect(normalizeLocalInput(42)).toBeNull();
  });
});

describe("insertBeforeSchedule", () => {
  it("keeps the schedule lines last", () => {
    expect(insertBeforeSchedule("Body\n\nstart-at: 2026-11-02 09:00\nask-first: yes", "**Attachments**")).toBe(
      "Body\n\n**Attachments**\n\nstart-at: 2026-11-02 09:00\nask-first: yes",
    );
  });

  it("appends when there is no schedule", () => {
    expect(insertBeforeSchedule("Body\n", "**Attachments**")).toBe("Body\n\n**Attachments**");
    expect(insertBeforeSchedule(null, "**Attachments**")).toBe("**Attachments**");
  });
});
