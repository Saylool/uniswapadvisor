/**
 * Compile-time regression tests.
 *
 * These assertions are checked by `npm run typecheck` (and by `next build`),
 * never executed. Each `@ts-expect-error` fails the build in *both* directions:
 * if the code below stops being an error — because a type was loosened — tsc
 * reports the directive as unused.
 *
 * The filename deliberately avoids the `.test.ts` / `.spec.ts` suffixes so Vitest
 * does not collect it as a suite with no cases in it.
 */
import type { DataResult, Pool, PoolMarketSnapshot } from "./index";

const snapshot = null as unknown as PoolMarketSnapshot;

/** Narrowing on `status` reaches `data` on the two variants that carry it. */
export function readTvlUsd(result: DataResult<PoolMarketSnapshot>): number | null {
  switch (result.status) {
    case "success":
    case "partial":
      return result.data.tvlUsd;
    case "unavailable":
      return null;
  }
}

/** Narrowing on `protocolVersion` reaches each protocol's own fee shape. */
export function readFeePpm(pool: Pool): number | null {
  switch (pool.protocolVersion) {
    case "v3":
      return pool.feePpm;
    case "v4":
      return pool.fee.kind === "static" ? pool.fee.feePpm : pool.fee.currentFeePpm;
  }
}

/** A partial result naming real fields of the data it wraps. */
export const partialResult: DataResult<PoolMarketSnapshot> = {
  status: "partial",
  data: snapshot,
  missingFields: ["tvlUsd", "volume7dUsd"],
  warnings: ["figures are one block behind"],
};

export function rejectedAtCompileTime(
  pool: Pool,
  result: DataResult<PoolMarketSnapshot>,
): void {
  const emptyMissingFields: DataResult<PoolMarketSnapshot> = {
    status: "partial",
    data: snapshot,
    // @ts-expect-error a partial with nothing missing is a success, not a partial.
    missingFields: [],
    warnings: [],
  };
  void emptyMissingFields;

  const misspelledField: DataResult<PoolMarketSnapshot> = {
    status: "partial",
    data: snapshot,
    // @ts-expect-error missing-field names must be real keys of the wrapped data.
    missingFields: ["tvlUSD"],
    warnings: [],
  };
  void misspelledField;

  if (result.status === "unavailable") {
    // @ts-expect-error a failed fetch carries no data to read.
    void result.data;
  }

  if (result.status === "success") {
    // @ts-expect-error missingFields belongs to a partial result only.
    void result.missingFields;
    // @ts-expect-error reason belongs to an unavailable result only.
    void result.reason;
  }

  if (pool.protocolVersion === "v4") {
    // @ts-expect-error feePpm is the v3 fee shape and must not appear on a v4 pool.
    void pool.feePpm;
  }

  if (pool.protocolVersion === "v3") {
    // @ts-expect-error hooks are a v4 concept and must not appear on a v3 pool.
    void pool.hookAddress;
  }

  // @ts-expect-error liquidity stays an exact decimal string, never a number.
  const liquidityAsNumber: number | null = snapshot.liquidity;
  void liquidityAsNumber;

  // @ts-expect-error fetch time replaced the ambiguous single "observed at" field.
  void snapshot.observedAt;
}
