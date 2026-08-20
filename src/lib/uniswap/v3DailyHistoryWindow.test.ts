import { describe, expect, it } from "vitest";

import { DAILY_HISTORY_DAYS, resolveDailyHistoryWindow } from "./v3DailyHistoryWindow";

const MS_PER_DAY = 86_400_000;

describe("resolveDailyHistoryWindow", () => {
  const window = resolveDailyHistoryWindow(new Date("2026-08-20T09:15:00.000Z"));

  it("covers 31 completed days", () => {
    expect(DAILY_HISTORY_DAYS).toBe(31);
    expect(window.expectedTimestamps).toHaveLength(31);
  });

  it("ends at the start of the current UTC day, exclusively", () => {
    expect(window.rangeEndExclusive).toBe("2026-08-20T00:00:00.000Z");
  });

  it("starts exactly 31 days before that", () => {
    expect(window.rangeStart).toBe("2026-07-20T00:00:00.000Z");
  });

  it("excludes the current, still-incomplete UTC day", () => {
    expect(window.expectedTimestamps).not.toContain("2026-08-20T00:00:00.000Z");
    expect(window.expectedTimestamps.at(-1)).toBe("2026-08-19T00:00:00.000Z");
  });

  it("lists every day-start in the window, ascending and unique", () => {
    expect(window.expectedTimestamps[0]).toBe("2026-07-20T00:00:00.000Z");
    expect(new Set(window.expectedTimestamps).size).toBe(31);
    expect([...window.expectedTimestamps].sort()).toEqual([...window.expectedTimestamps]);
  });

  it("spaces the expected timestamps exactly one day apart", () => {
    const gaps = window.expectedTimestamps
      .slice(1)
      .map((timestamp, index) => Date.parse(timestamp) - Date.parse(window.expectedTimestamps[index] ?? ""));
    expect(new Set(gaps)).toEqual(new Set([MS_PER_DAY]));
  });

  it("exposes the same bounds as Unix seconds for the subgraph filter", () => {
    expect(window.rangeStartUnixSeconds).toBe(1_784_505_600);
    expect(window.rangeEndExclusiveUnixSeconds).toBe(1_787_184_000);
    expect(window.rangeEndExclusiveUnixSeconds - window.rangeStartUnixSeconds).toBe(31 * 86_400);
  });

  it.each([
    ["just after midnight", "2026-08-20T00:00:00.000Z"],
    ["mid-morning", "2026-08-20T09:15:00.000Z"],
    ["one millisecond before midnight", "2026-08-20T23:59:59.999Z"],
  ])("returns the same window anywhere within a UTC day (%s)", (_label, instant) => {
    expect(resolveDailyHistoryWindow(new Date(instant))).toEqual(window);
  });

  it("rolls forward exactly one day at the next UTC midnight", () => {
    const next = resolveDailyHistoryWindow(new Date("2026-08-21T00:00:00.000Z"));

    expect(next.rangeEndExclusive).toBe("2026-08-21T00:00:00.000Z");
    expect(next.rangeStart).toBe("2026-07-21T00:00:00.000Z");
  });

  it("does not depend on the host timezone", () => {
    // Same instant, expressed with an offset: the window must be identical.
    const withOffset = new Date("2026-08-20T11:15:00.000+02:00");
    expect(resolveDailyHistoryWindow(withOffset)).toEqual(window);
  });
});
