import { describe, expect, it } from "vitest";

import { buildDailyLogReturns, MS_PER_DAY } from "./dailyLogReturns";

const DAY_ZERO = Date.parse("2026-07-20T00:00:00.000Z");
const at = (dayIndex: number, offsetMs = 0) =>
  new Date(DAY_ZERO + dayIndex * MS_PER_DAY + offsetMs).toISOString();
const point = (dayIndex: number, price: number) => ({ timestamp: at(dayIndex), price });

describe("buildDailyLogReturns", () => {
  it("produces no returns from fewer than two points", () => {
    expect(buildDailyLogReturns([])).toEqual([]);
    expect(buildDailyLogReturns([point(0, 100)])).toEqual([]);
  });

  it("computes a known consecutive return", () => {
    // ln(110) - ln(100) = ln(1.1) = 0.09531017980432...
    const returns = buildDailyLogReturns([point(0, 100), point(1, 110)]);

    expect(returns).toHaveLength(1);
    expect(returns[0]?.logReturn).toBeCloseTo(0.09531017980432486, 15);
    expect(returns[0]?.fromTimestamp).toBe(at(0));
    expect(returns[0]?.toTimestamp).toBe(at(1));
  });

  it("computes negative returns when price falls", () => {
    // ln(90) - ln(100) = ln(0.9) = -0.10536051565782...
    const returns = buildDailyLogReturns([point(0, 100), point(1, 90)]);

    expect(returns[0]?.logReturn).toBeCloseTo(-0.10536051565782628, 15);
    expect(returns[0]?.logReturn).toBeLessThan(0);
  });

  it("gives exactly zero for an unchanged price", () => {
    expect(buildDailyLogReturns([point(0, 100), point(1, 100)])[0]?.logReturn).toBe(0);
  });

  it("uses log differences, so extreme finite prices do not overflow", () => {
    // 1e300 / 1e-300 overflows to Infinity, and ln(Infinity) is Infinity.
    // ln(1e300) - ln(1e-300) = 1381.5510557964274, finite.
    expect(1e300 / 1e-300).toBe(Number.POSITIVE_INFINITY);

    const returns = buildDailyLogReturns([point(0, 1e-300), point(1, 1e300)]);

    expect(returns[0]?.logReturn).toBeCloseTo(1381.5510557964274, 9);
    expect(Number.isFinite(returns[0]?.logReturn ?? Number.NaN)).toBe(true);
  });

  it("stays finite for extreme downward moves too", () => {
    const returns = buildDailyLogReturns([point(0, 1e300), point(1, 1e-300)]);

    expect(returns[0]?.logReturn).toBeCloseTo(-1381.5510557964274, 9);
  });

  describe("gaps", () => {
    it("skips the pair that straddles a missing day", () => {
      // Day 1 exists, day 2 is missing, days 3 and 4 exist.
      const returns = buildDailyLogReturns([point(1, 100), point(3, 130), point(4, 140)]);

      expect(returns).toHaveLength(1);
      expect(returns[0]?.fromTimestamp).toBe(at(3));
      expect(returns[0]?.toTimestamp).toBe(at(4));
    });

    it("does not rescale a multi-day move into a daily one", () => {
      const twoDayApart = buildDailyLogReturns([point(0, 100), point(2, 121)]);

      expect(twoDayApart).toEqual([]);
      // Neither the full move nor a halved version of it appears anywhere.
      expect(twoDayApart.map((entry) => entry.logReturn)).not.toContain(
        Math.log(121) - Math.log(100),
      );
    });

    it("does not fabricate a point for the missing day", () => {
      const returns = buildDailyLogReturns([point(0, 100), point(2, 121)]);

      expect(returns).toHaveLength(0);
      expect(returns.some((entry) => entry.logReturn === 0)).toBe(false);
    });

    it("handles several separate consecutive segments deterministically", () => {
      const returns = buildDailyLogReturns([
        point(0, 100),
        point(1, 101),
        point(2, 102),
        point(5, 200),
        point(6, 202),
      ]);

      expect(returns.map((entry) => [entry.fromTimestamp, entry.toTimestamp])).toEqual([
        [at(0), at(1)],
        [at(1), at(2)],
        [at(5), at(6)],
      ]);
    });

    it("rejects a span that is not exactly one day, even by a millisecond", () => {
      const shortByOneMs = [point(0, 100), { timestamp: at(1, -1), price: 110 }];
      const longByOneMs = [point(0, 100), { timestamp: at(1, 1), price: 110 }];

      expect(buildDailyLogReturns(shortByOneMs)).toEqual([]);
      expect(buildDailyLogReturns(longByOneMs)).toEqual([]);
    });
  });

  it("returns entries in input order", () => {
    const returns = buildDailyLogReturns([
      point(0, 100),
      point(1, 110),
      point(2, 121),
      point(3, 133.1),
    ]);

    const fromInstants = returns.map((entry) => Date.parse(entry.fromTimestamp));
    expect(fromInstants).toEqual([...fromInstants].sort((a, b) => a - b));
    expect(returns).toHaveLength(3);
  });
});
