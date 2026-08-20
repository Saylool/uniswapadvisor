import { describe, expect, it } from "vitest";

import { DataFailureReasonSchema } from "./index";

describe("DataFailureReasonSchema", () => {
  it.each([
    ["configuration-error"],
    ["network-error"],
    ["timeout"],
    ["rate-limited"],
    ["invalid-response"],
    ["not-found"],
    ["unknown"],
  ])("accepts the %s category", (reason) => {
    expect(DataFailureReasonSchema.safeParse(reason).success).toBe(true);
  });

  it.each([["teapot"], [""], ["TIMEOUT"], [500]])("rejects %s", (reason) => {
    expect(DataFailureReasonSchema.safeParse(reason).success).toBe(false);
  });
});
