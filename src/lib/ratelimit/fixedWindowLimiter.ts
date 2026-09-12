/*
 * A fixed-window request counter.
 *
 * Pure apart from the clock, which is injected, so a test can walk time forward
 * instead of sleeping.
 *
 * Fixed window rather than sliding: it needs one integer and one timestamp per
 * client where a sliding window needs a list of request times. The known cost is
 * the boundary burst — a client can spend its whole allowance at the end of one
 * window and again at the start of the next, so the real worst case is twice the
 * limit over a short span. For protecting an API quota from casual abuse that is
 * an acceptable trade for the smaller, bounded memory.
 *
 * Every instance of this counter lives in one process's memory. On a platform
 * that runs several instances the effective limit is multiplied by however many
 * are warm, so this is a deterrent rather than a guarantee. A hard limit needs a
 * store the instances share.
 */

export type RateLimitDecision = {
  readonly allowed: boolean;
  /** Requests left in the current window. Zero when the request was refused. */
  readonly remaining: number;
  /** Whole seconds until the window resets. Zero when the request was allowed. */
  readonly retryAfterSeconds: number;
};

export type RateLimiter = {
  /** Counts one request against `key` and says whether it may proceed. */
  readonly check: (key: string) => RateLimitDecision;
  /** How many keys are currently tracked. For tests and diagnostics. */
  readonly size: () => number;
};

export type FixedWindowOptions = {
  /** Requests allowed per window. At least 1. */
  readonly limit: number;
  /** Window length in milliseconds. Greater than zero. */
  readonly windowMs: number;
  /**
   * Ceiling on how many keys are held at once, so a flood of distinct clients
   * cannot grow the table without bound.
   */
  readonly maxTrackedKeys: number;
  readonly now: () => number;
};

type Window = { startedAt: number; count: number };

export const createFixedWindowRateLimiter = (options: FixedWindowOptions): RateLimiter => {
  /*
   * A `Map` iterates in insertion order, and every window that starts is inserted
   * fresh, so the first key is always the one whose window began longest ago —
   * which is also the one most likely to have expired. That makes eviction a
   * single O(1) delete with no scan and no separate sweep of expired entries.
   */
  const windows = new Map<string, Window>();

  const evictUntilRoom = (): void => {
    while (windows.size >= options.maxTrackedKeys) {
      const oldest = windows.keys().next();
      if (oldest.done === true) return;
      windows.delete(oldest.value);
    }
  };

  const startWindow = (key: string, now: number): RateLimitDecision => {
    // Deleted first so a renewed window is re-inserted at the back rather than
    // keeping its original position and being evicted while still active.
    windows.delete(key);
    evictUntilRoom();
    windows.set(key, { startedAt: now, count: 1 });

    return { allowed: true, remaining: options.limit - 1, retryAfterSeconds: 0 };
  };

  const check = (key: string): RateLimitDecision => {
    const now = options.now();
    const current = windows.get(key);

    if (current === undefined || now - current.startedAt >= options.windowMs) {
      return startWindow(key, now);
    }

    if (current.count >= options.limit) {
      const millisecondsLeft = options.windowMs - (now - current.startedAt);
      return {
        allowed: false,
        remaining: 0,
        /*
         * Rounded up, which also makes it impossible to answer zero: reaching
         * here means the window has not elapsed, so `millisecondsLeft` is
         * strictly positive and its ceiling is at least 1. A `Retry-After: 0`
         * would invite an immediate retry that this same branch would refuse.
         */
        retryAfterSeconds: Math.ceil(millisecondsLeft / 1000),
      };
    }

    current.count += 1;
    return { allowed: true, remaining: options.limit - current.count, retryAfterSeconds: 0 };
  };

  return { check, size: () => windows.size };
};
