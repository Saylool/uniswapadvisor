/*
 * Turns a request's headers into the key a rate limiter counts against.
 *
 * **This is only meaningful behind a proxy that sets these headers itself.**
 * Vercel does: it writes `x-real-ip` and `x-forwarded-for` for every request and
 * a client cannot choose their values. Deployed anywhere that forwards a
 * client's own headers through untouched, both are attacker-controlled and the
 * limit becomes trivially bypassable — the limiter is only ever as trustworthy
 * as the hop in front of it.
 *
 * Running locally there is no proxy and neither header exists, so every request
 * shares one bucket. That is the safe direction to fail: local development is
 * rate-limited as if it were a single client.
 */

/** Used when no header identifies the caller, so requests still get counted. */
export const SHARED_FALLBACK_KEY = "unidentified";

/** Longest possible IPv6 text form, including an IPv4 tail and a zone id. */
const MAX_KEY_LENGTH = 45;

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
const IPV6ISH = /^[0-9a-f:.]+$/;

/**
 * Accepts only values shaped like an address.
 *
 * Not for correctness — a malformed address would simply be its own bucket — but
 * to bound the key space. Anything a caller can vary freely becomes an unlimited
 * supply of fresh buckets, and a table with a ceiling would evict real clients to
 * make room for the junk.
 */
const looksLikeAddress = (value: string): boolean => {
  if (value.length === 0 || value.length > MAX_KEY_LENGTH) return false;

  const ipv4 = IPV4.exec(value);
  if (ipv4 !== null) {
    return ipv4.slice(1).every((octet) => Number(octet) <= 255);
  }

  return value.includes(":") && IPV6ISH.test(value);
};

/**
 * `x-real-ip` first: where both exist the platform wrote it, while
 * `x-forwarded-for` is a list that may have been appended to along the way. From
 * that list the leftmost entry is the original client, which is the party worth
 * counting.
 */
export const clientKeyFromHeaders = (headers: Headers): string => {
  const realIp = headers.get("x-real-ip");
  const forwardedFor = headers.get("x-forwarded-for");

  const candidate = (realIp ?? forwardedFor?.split(",")[0] ?? "").trim().toLowerCase();

  return looksLikeAddress(candidate) ? candidate : SHARED_FALLBACK_KEY;
};
