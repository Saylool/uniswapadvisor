import { describe, expect, it } from "vitest";

import type { DataResult } from "../../schemas";
import { loggingFetch, logUnavailable } from "./serverDiagnostics";

/*
 * The secrets these tests hunt for. Both are shaped like the real thing: the RPC
 * URL carries its key in the path, and the Graph key rides in a header.
 */
const RPC_URL = "https://eth-mainnet.example.com/v2/SUPERSECRETKEY";
const GRAPH_KEY = "abcdef0123456789graphkey";

/*
 * Both arrays are live and pushed to together. A getter would look tidier but
 * `const { lines } = capture()` evaluates it once, handing every test a frozen
 * snapshot of an empty array.
 */
const capture = () => {
  const entries: { level: string; message: string }[] = [];
  const lines: string[] = [];

  return {
    entries,
    lines,
    log: (level: "warn" | "error", message: string) => {
      entries.push({ level, message });
      lines.push(message);
    },
  };
};

const respondWith = (status: number) => async () =>
  new Response(status === 204 ? null : "{}", { status });

const init = { headers: { Authorization: `Bearer ${GRAPH_KEY}` } };

describe("loggingFetch", () => {
  it("records the status of a failed response", async () => {
    const { lines, log } = capture();

    await loggingFetch("v3-pool", respondWith(404), log)(RPC_URL, init);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("[v3-pool]");
    expect(lines[0]).toContain("HTTP 404");
  });

  it("treats any failed status as operational", async () => {
    const { entries, log } = capture();

    await loggingFetch("v3-pool", respondWith(404), log)(RPC_URL, init);

    // A pool that does not exist answers 200 with an empty result, so a failure
    // status here always means the request itself was wrong or refused.
    expect(entries[0]?.level).toBe("error");
  });

  it("distinguishes the statuses that mean different things", async () => {
    for (const status of [400, 401, 403, 429, 500, 503]) {
      const { lines, log } = capture();
      await loggingFetch("v3-pool", respondWith(status), log)(RPC_URL, init);

      expect(lines[0]).toContain(`HTTP ${status}`);
    }
  });

  it("says nothing when the response is fine", async () => {
    const { lines, log } = capture();

    await loggingFetch("v3-pool", respondWith(200), log)(RPC_URL, init);

    // One line per successful request would bury the one that matters.
    expect(lines).toEqual([]);
  });

  it("never writes down the URL", async () => {
    const { lines, log } = capture();

    await loggingFetch("v3-pool", respondWith(404), log)(RPC_URL, init);

    // The RPC URL embeds the provider key in its path, so logging it leaks it.
    expect(lines.join("\n")).not.toContain("SUPERSECRETKEY");
    expect(lines.join("\n")).not.toContain("eth-mainnet.example.com");
    expect(lines.join("\n")).not.toContain("https://");
  });

  it("never writes down a request header", async () => {
    const { lines, log } = capture();

    await loggingFetch("v3-pool", respondWith(401), log)(RPC_URL, init);

    expect(lines.join("\n")).not.toContain(GRAPH_KEY);
    expect(lines.join("\n")).not.toContain("Bearer");
    expect(lines.join("\n")).not.toContain("Authorization");
  });

  it("returns the response untouched", async () => {
    const { log } = capture();
    const response = await loggingFetch("v3-pool", respondWith(200), log)(RPC_URL, init);

    expect(response.status).toBe(200);
    expect(await response.text()).toBe("{}");
  });

  it("records only the name of a thrown error, and rethrows it", async () => {
    const { lines, log } = capture();
    const thrower = async () => {
      // A real `fetch` rejection routinely quotes the host it could not reach.
      throw new TypeError(`fetch failed for ${RPC_URL}`);
    };

    await expect(loggingFetch("rpc", thrower, log)(RPC_URL, init)).rejects.toThrow(TypeError);

    expect(lines[0]).toContain("threw TypeError");
    expect(lines.join("\n")).not.toContain("SUPERSECRETKEY");
    expect(lines.join("\n")).not.toContain("fetch failed");
  });

  it("names an aborted request as such, so a timeout is recognisable", async () => {
    const { lines, log } = capture();
    const aborter = async () => {
      throw new DOMException("The operation was aborted.", "AbortError");
    };

    await expect(loggingFetch("rpc", aborter, log)(RPC_URL, init)).rejects.toThrow();

    expect(lines[0]).toContain("threw AbortError");
  });

  it("survives something thrown that is not an Error", async () => {
    const { lines, log } = capture();
    const thrower = async () => {
      throw RPC_URL;
    };

    await expect(loggingFetch("rpc", thrower, log)(RPC_URL, init)).rejects.toBeDefined();

    expect(lines[0]).toContain("threw string");
    expect(lines.join("\n")).not.toContain("SUPERSECRETKEY");
  });

  it("records how long the attempt took", async () => {
    const { lines, log } = capture();

    await loggingFetch("v3-pool", respondWith(500), log)(RPC_URL, init);

    expect(lines[0]).toMatch(/after \d+ms$/);
  });
});

describe("logUnavailable", () => {
  const failure: DataResult<number> = {
    status: "unavailable",
    reason: "invalid-response",
    message: "The market data source returned an unreadable response.",
  };

  it("pairs the category with the wording the user saw", () => {
    const { lines, log } = capture();

    logUnavailable("v3-pool", failure, log);

    expect(lines[0]).toContain("[v3-pool]");
    expect(lines[0]).toContain("invalid-response");
    expect(lines[0]).toContain("The market data source returned an unreadable response.");
  });

  it("hands the result back unchanged", () => {
    const { log } = capture();

    expect(logUnavailable("v3-pool", failure, log)).toBe(failure);
  });

  it("calls a provider failure an error", () => {
    const { entries, log } = capture();

    logUnavailable("v3-pool", failure, log);

    expect(entries[0]?.level).toBe("error");
  });

  it.each(["not-found", "invalid-input", "insufficient-data"] as const)(
    "calls %s ordinary use rather than a defect",
    (reason) => {
      const { entries, log } = capture();

      logUnavailable("v3-pool", { status: "unavailable", reason, message: "Nothing here." }, log);

      // A mistyped address must not read like an outage, or the channel stops
      // being worth reading.
      expect(entries[0]?.level).toBe("warn");
    },
  );

  it.each(["configuration-error", "network-error", "timeout", "rate-limited", "unknown"] as const)(
    "calls %s something to act on",
    (reason) => {
      const { entries, log } = capture();

      logUnavailable("v3-pool", { status: "unavailable", reason, message: "Went wrong." }, log);

      expect(entries[0]?.level).toBe("error");
    },
  );

  it("says nothing about a read that produced data", () => {
    const { lines, log } = capture();

    logUnavailable("v3-pool", { status: "success", data: 1 }, log);
    logUnavailable("v3-pool", {
      status: "partial",
      data: 1,
      missingFields: ["toFixed"],
      warnings: ["A caveat."],
    }, log);

    expect(lines).toEqual([]);
  });
});
