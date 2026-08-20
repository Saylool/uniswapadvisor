import { describe, expect, it } from "vitest";

import { DataSourceSchema } from "./index";

describe("DataSourceSchema", () => {
  it.each([
    ["uniswap-v3-subgraph"],
    ["uniswap-v4-subgraph"],
    ["hook-registry"],
    ["derived-analytics"],
  ])("accepts %s", (source) => {
    expect(DataSourceSchema.safeParse(source).success).toBe(true);
  });

  it.each([["etherscan"], ["coingecko"], [""], ["UNISWAP-V3-SUBGRAPH"]])(
    "rejects %s",
    (source) => {
      expect(DataSourceSchema.safeParse(source).success).toBe(false);
    },
  );
});
