import { describe, expect, it } from "vitest";

import { createFixedWindowRateLimiter } from "./fixedWindowLimiter";

/** A clock the test moves by hand, so nothing here sleeps. */
const clock = (startedAt = 1_000_000) => {
  let current = startedAt;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
};

const limiter = (limit = 3, windowMs = 60_000, maxTrackedKeys = 100) => {
  const time = clock();
  return {
    time,
    subject: createFixedWindowRateLimiter({ limit, windowMs, maxTrackedKeys, now: time.now }),
  };
};

describe("createFixedWindowRateLimiter", () => {
  it("allows exactly the limit, then refuses", () => {
    const { subject } = limiter(3);

    expect(subject.check("a").allowed).toBe(true);
    expect(subject.check("a").allowed).toBe(true);
    expect(subject.check("a").allowed).toBe(true);
    expect(subject.check("a").allowed).toBe(false);
  });

  it("counts down what is left", () => {
    const { subject } = limiter(3);

    expect(subject.check("a").remaining).toBe(2);
    expect(subject.check("a").remaining).toBe(1);
    expect(subject.check("a").remaining).toBe(0);
    expect(subject.check("a").remaining).toBe(0);
  });

  it("counts each client separately", () => {
    const { subject } = limiter(1);

    expect(subject.check("a").allowed).toBe(true);
    expect(subject.check("b").allowed).toBe(true);
    expect(subject.check("a").allowed).toBe(false);
    expect(subject.check("b").allowed).toBe(false);
  });

  it("opens a new window once the old one has run its full length", () => {
    const { time, subject } = limiter(1, 60_000);

    expect(subject.check("a").allowed).toBe(true);
    time.advance(59_999);
    expect(subject.check("a").allowed).toBe(false);
    time.advance(1);
    // Exactly one window later the allowance is fresh, not one millisecond after.
    expect(subject.check("a").allowed).toBe(true);
  });

  it("says how long to wait, rounded up", () => {
    const { time, subject } = limiter(1, 60_000);

    subject.check("a");
    time.advance(500);
    expect(subject.check("a").retryAfterSeconds).toBe(60);

    time.advance(30_000);
    expect(subject.check("a").retryAfterSeconds).toBe(30);
  });

  it("never tells a caller to retry immediately", () => {
    const { time, subject } = limiter(1, 60_000);

    subject.check("a");
    time.advance(59_999);

    // A `Retry-After: 0` invites a retry that would be refused again.
    expect(subject.check("a").retryAfterSeconds).toBe(1);
  });

  it("reports nothing to wait for when the request is allowed", () => {
    const { subject } = limiter(3);

    expect(subject.check("a").retryAfterSeconds).toBe(0);
  });

  it("keeps the table under its ceiling", () => {
    const { subject } = limiter(5, 60_000, 10);

    for (let index = 0; index < 500; index += 1) subject.check(`client-${index}`);

    expect(subject.size()).toBeLessThanOrEqual(10);
  });

  it("evicts the client whose window started longest ago", () => {
    const { subject } = limiter(1, 60_000, 3);

    subject.check("first");
    subject.check("second");
    subject.check("third"); // table is now full

    // "first" is dropped to make room, so it gets a fresh allowance.
    subject.check("fourth");
    expect(subject.check("first").allowed).toBe(true);
    // "third" is still tracked and still spent.
    expect(subject.check("third").allowed).toBe(false);
  });

  it("moves a renewed window to the back of the eviction queue", () => {
    const { time, subject } = limiter(1, 10_000, 3);

    subject.check("a");
    subject.check("b");
    time.advance(10_000);
    subject.check("a"); // a's window renews, so it should no longer be the oldest

    subject.check("c");
    subject.check("d"); // forces an eviction

    /*
     * b was the oldest surviving window, so b is the one that went. a is asserted
     * first because checking an untracked key inserts it, and with the table at
     * its ceiling that insert evicts whatever is now oldest — including a.
     */
    expect(subject.check("a").allowed).toBe(false);
    expect(subject.check("b").allowed).toBe(true);
  });

  it("is deterministic for the same sequence", () => {
    const one = limiter(2);
    const two = limiter(2);

    for (const key of ["a", "b", "a", "a", "b"]) {
      expect(one.subject.check(key)).toEqual(two.subject.check(key));
    }
  });
});
