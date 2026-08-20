import { describe, expect, it } from "vitest";

import { calculateSampleStatistics } from "./sampleStatistics";

describe("calculateSampleStatistics", () => {
  it("reports no spread for an empty series", () => {
    expect(calculateSampleStatistics([])).toEqual({
      count: 0,
      mean: 0,
      standardDeviation: null,
    });
  });

  it("reports no spread for a single value, rather than claiming zero", () => {
    const result = calculateSampleStatistics([0.05]);

    expect(result.count).toBe(1);
    expect(result.mean).toBeCloseTo(0.05, 15);
    // A lone observation has no measurable spread; `0` would assert stability.
    expect(result.standardDeviation).toBeNull();
  });

  it("divides by n - 1, not n", () => {
    // Hand-derived: mean 0.2, deviations -0.1/0/0.1, sum of squares 0.02.
    //   sample     = sqrt(0.02 / 2) = 0.1
    //   population = sqrt(0.02 / 3) = 0.0816496580927726
    const result = calculateSampleStatistics([0.1, 0.2, 0.3]);

    expect(result.mean).toBeCloseTo(0.2, 15);
    expect(result.standardDeviation).toBeCloseTo(0.1, 15);
    expect(result.standardDeviation).not.toBeCloseTo(0.0816496580927726, 6);
  });

  it("gives zero spread for identical values", () => {
    const result = calculateSampleStatistics([0.03, 0.03, 0.03, 0.03]);

    expect(result.mean).toBeCloseTo(0.03, 15);
    expect(result.standardDeviation).toBe(0);
  });

  it("never returns NaN for near-identical values whose deviation sum may round below zero", () => {
    const value = 1e8 + 1 / 3;
    const result = calculateSampleStatistics([value, value, value, value, value]);

    expect(result.standardDeviation).not.toBeNull();
    expect(Number.isNaN(result.standardDeviation ?? Number.NaN)).toBe(false);
    expect(result.standardDeviation).toBe(0);
  });

  it("handles a symmetric series with a hand-checkable answer", () => {
    // Values -2, 0, 2: mean 0, sum of squares 8, sample variance 4, sd 2.
    const result = calculateSampleStatistics([-2, 0, 2]);

    expect(result.mean).toBe(0);
    expect(result.standardDeviation).toBeCloseTo(2, 15);
  });

  it("stays accurate when values are tiny against a large mean", () => {
    // Welford's reason for existing: the textbook sum-of-squares form loses these
    // digits entirely. Values 1e9 ± 1 have sample sd exactly 1.
    const result = calculateSampleStatistics([1e9 - 1, 1e9, 1e9 + 1]);

    expect(result.standardDeviation).toBeCloseTo(1, 9);
  });

  it("is order-deterministic for the same series", () => {
    const values = [0.01, -0.02, 0.03, -0.04, 0.05];
    expect(calculateSampleStatistics(values)).toEqual(calculateSampleStatistics([...values]));
  });
});
