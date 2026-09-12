import { describe, expect, it } from "vitest";

import { clientKeyFromHeaders, SHARED_FALLBACK_KEY } from "./clientKey";

const headers = (entries: Record<string, string>) => new Headers(entries);

describe("clientKeyFromHeaders", () => {
  it("prefers the header the platform writes", () => {
    const key = clientKeyFromHeaders(
      headers({ "x-real-ip": "203.0.113.7", "x-forwarded-for": "198.51.100.9" }),
    );

    expect(key).toBe("203.0.113.7");
  });

  it("falls back to the forwarded list", () => {
    expect(clientKeyFromHeaders(headers({ "x-forwarded-for": "203.0.113.7" }))).toBe("203.0.113.7");
  });

  it("takes the original client from a forwarded chain", () => {
    // "client, proxy1, proxy2" — the leftmost entry is the party worth counting.
    const key = clientKeyFromHeaders(
      headers({ "x-forwarded-for": "203.0.113.7, 198.51.100.9, 192.0.2.1" }),
    );

    expect(key).toBe("203.0.113.7");
  });

  it("tolerates the spacing real proxies use", () => {
    expect(clientKeyFromHeaders(headers({ "x-forwarded-for": "  203.0.113.7 , 198.51.100.9" }))).toBe(
      "203.0.113.7",
    );
  });

  it("accepts IPv6 and normalises its case", () => {
    expect(clientKeyFromHeaders(headers({ "x-real-ip": "2001:DB8::1" }))).toBe("2001:db8::1");
    expect(clientKeyFromHeaders(headers({ "x-real-ip": "::1" }))).toBe("::1");
  });

  it("counts requests under one key when nothing identifies the caller", () => {
    // Running locally there is no proxy, so every request shares a bucket. That
    // is the safe direction to fail.
    expect(clientKeyFromHeaders(headers({}))).toBe(SHARED_FALLBACK_KEY);
    expect(clientKeyFromHeaders(headers({ "x-forwarded-for": "" }))).toBe(SHARED_FALLBACK_KEY);
    expect(clientKeyFromHeaders(headers({ "x-forwarded-for": "   " }))).toBe(SHARED_FALLBACK_KEY);
  });

  /*
   * Anything a caller can vary freely is an unlimited supply of fresh buckets,
   * and a table with a ceiling would evict real clients to make room for it.
   */
  it("refuses a value that is not shaped like an address", () => {
    for (const value of [
      "not-an-address",
      "<script>alert(1)</script>",
      "203.0.113.7; DROP TABLE",
      "999.999.999.999",
      "203.0.113",
      "203.0.113.7.8",
    ]) {
      expect(clientKeyFromHeaders(headers({ "x-real-ip": value }))).toBe(SHARED_FALLBACK_KEY);
    }
  });

  it("refuses a value longer than any address can be", () => {
    const flood = `${"2001:db8:".repeat(20)}1`;

    expect(clientKeyFromHeaders(headers({ "x-real-ip": flood }))).toBe(SHARED_FALLBACK_KEY);
  });

  it("refuses an octet outside a byte", () => {
    expect(clientKeyFromHeaders(headers({ "x-real-ip": "203.0.113.256" }))).toBe(
      SHARED_FALLBACK_KEY,
    );
    expect(clientKeyFromHeaders(headers({ "x-real-ip": "203.0.113.255" }))).toBe("203.0.113.255");
  });

  it("gives the same caller the same key every time", () => {
    const request = headers({ "x-real-ip": "203.0.113.7" });

    expect(clientKeyFromHeaders(request)).toBe(clientKeyFromHeaders(request));
  });
});
