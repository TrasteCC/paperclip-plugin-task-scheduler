import { describe, expect, it } from "vitest";
import { bucketOf, dayOf, defaultStartInput, relative, timeOf, toInputValue } from "../src/ui/format.js";

const at = (iso: string) => Date.parse(iso);

describe("bucketOf", () => {
  const now = at("2026-10-30T20:00:00Z"); // Fri 30 Oct, 21:00 Madrid

  it("groups by Madrid calendar day", () => {
    expect(bucketOf(null, now)).toBe("invalid");
    expect(bucketOf(now - 1, now)).toBe("due");
    expect(bucketOf(at("2026-10-30T22:30:00Z"), now)).toBe("today"); // 23:30 Madrid
    expect(bucketOf(at("2026-10-30T23:30:00Z"), now)).toBe("tomorrow"); // 00:30 Madrid on the 31st
    expect(bucketOf(at("2026-11-06T10:00:00Z"), now)).toBe("week");
    expect(bucketOf(at("2026-11-07T10:00:00Z"), now)).toBe("later");
  });

  it("keeps tomorrow right on the night clocks fall back", () => {
    const night = at("2026-10-24T21:30:00Z"); // Sat 24 Oct, 23:30 CEST
    expect(bucketOf(at("2026-10-25T22:30:00Z"), night)).toBe("tomorrow"); // Sun 25 Oct, 23:30 CET (25 h later)
  });
});

describe("labels", () => {
  it("prints Madrid time and day", () => {
    expect(timeOf(at("2026-11-01T08:00:00Z"))).toBe("09:00");
    expect(dayOf(at("2026-11-01T08:00:00Z"))).toBe("Sun 1 Nov");
    expect(toInputValue(at("2026-11-01T08:00:00Z"))).toBe("2026-11-01T09:00");
    expect(defaultStartInput(at("2026-10-30T23:30:00Z"))).toBe("2026-11-01T09:00");
  });

  it("describes how far away a start is", () => {
    const now = at("2026-10-30T20:00:00Z");
    expect(relative(now, now)).toBe("starting now");
    expect(relative(now + 5 * 60_000, now)).toBe("in 5 min");
    expect(relative(now + 3 * 3_600_000, now)).toBe("in 3 h");
    expect(relative(now + 2 * 86_400_000, now)).toBe("in 2 days");
  });
});
