/**
 * Mean and sample standard deviation of a series.
 *
 * `standardDeviation` is `null` when fewer than two values are supplied: sample
 * variance divides by `n - 1`, so a single observation has no spread to measure
 * and returning `0` would claim one.
 */
export type SampleStatistics = {
  readonly count: number;
  readonly mean: number;
  readonly standardDeviation: number | null;
};

/**
 * Computes mean and sample standard deviation in one pass, using Welford's
 * algorithm.
 *
 * Welford accumulates the sum of squared deviations against a running mean rather
 * than subtracting `mean²` from a sum of squares. The textbook form loses most of
 * its significant digits when the values are small relative to their mean — which
 * is exactly the shape of daily log returns, where a 1% move is 0.00995 against a
 * mean near zero — and can even yield a negative variance. This form does not.
 *
 * Deterministic: values are consumed in the order given, so the same series always
 * produces bit-identical output.
 */
export const calculateSampleStatistics = (values: readonly number[]): SampleStatistics => {
  let count = 0;
  let mean = 0;
  let sumOfSquaredDeviations = 0;

  for (const value of values) {
    count += 1;
    const deltaFromOldMean = value - mean;
    mean += deltaFromOldMean / count;
    const deltaFromNewMean = value - mean;
    sumOfSquaredDeviations += deltaFromOldMean * deltaFromNewMean;
  }

  if (count === 0) return { count: 0, mean: 0, standardDeviation: null };
  if (count < 2) return { count, mean, standardDeviation: null };

  /*
   * Mathematically this sum cannot be negative, but in floating point a series of
   * near-identical values can drive it a few ulps below zero — and `Math.sqrt` of
   * that is NaN. Clamping here, at the single point where the sign is decided, is
   * the narrowest possible fix: it turns "-1e-19 spread" into "no spread", which
   * is what the data actually said. It repairs rounding, never genuinely invalid
   * input, which is why it is applied to the deviation sum and nowhere else.
   */
  const sampleVariance = Math.max(sumOfSquaredDeviations, 0) / (count - 1);

  return { count, mean, standardDeviation: Math.sqrt(sampleVariance) };
};
