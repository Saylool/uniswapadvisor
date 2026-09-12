import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { DataResult, PoolDailyPriceHistory, PoolMarketSnapshot, V3Pool } from "../schemas";
import { analysePoolRange, DEFAULT_PRICE_BAND_PARAMETERS } from "../lib/advisor/poolRangeAnalysis";
import { formatPercent, formatPrice } from "../lib/format/displayFormats";
import { PoolRangeReport } from "./PoolRangeReport";

/*
 * Rendered through `react-dom/server`, which needs no DOM and no browser. The
 * fixtures go through the real pipeline rather than being hand-written result
 * objects, so the markup is asserted against figures the application would
 * actually produce.
 */

const POOL_ID = `0x${"c".repeat(40)}`;
const POOL_REF = { protocolVersion: "v3", chainId: 1, id: POOL_ID } as const;
const FETCHED_AT = "2026-08-21T09:15:00.000Z";
const CURRENT_PRICE = 1 / 3000;
const DAY_MS = 86_400_000;
const RANGE_START = Date.parse("2026-07-21T00:00:00.000Z");

const pool = (token0Decimals = 6, token1Decimals = 18): V3Pool =>
  ({
    ...POOL_REF,
    token0: { chainId: 1, address: `0x${"a".repeat(40)}`, symbol: "USDC", decimals: token0Decimals },
    token1: { chainId: 1, address: `0x${"b".repeat(40)}`, symbol: "WETH", decimals: token1Decimals },
    feePpm: 3000,
    tickSpacing: 60,
  }) as unknown as V3Pool;

const snapshot = (overrides: Record<string, unknown> = {}): PoolMarketSnapshot =>
  ({
    pool: POOL_REF,
    fetchedAt: FETCHED_AT,
    sourceBlockNumber: "21500000",
    sourceBlockTimestamp: "2026-08-21T09:14:48.000Z",
    token0PriceInToken1: CURRENT_PRICE,
    token1PriceInToken0: 1 / CURRENT_PRICE,
    tvlUsd: 12_500_000,
    volume24hUsd: null,
    volume7dUsd: null,
    volume30dUsd: null,
    tick: 196_256,
    liquidity: "987654321",
    source: "uniswap-v3-subgraph",
    ...overrides,
  }) as unknown as PoolMarketSnapshot;

const history = (): PoolDailyPriceHistory => {
  const points: { timestamp: string; price: number }[] = [];
  let price = CURRENT_PRICE;
  for (let day = 0; day < 31; day += 1) {
    if (day > 0) price *= day % 2 === 0 ? 1.01 : 1 / 1.01;
    points.push({ timestamp: new Date(RANGE_START + day * DAY_MS).toISOString(), price });
  }
  return {
    pool: POOL_REF,
    fetchedAt: FETCHED_AT,
    sourceBlockNumber: "21500000",
    sourceBlockTimestamp: "2026-08-21T09:14:48.000Z",
    rangeStart: "2026-07-21T00:00:00.000Z",
    rangeEndExclusive: new Date(RANGE_START + 31 * DAY_MS).toISOString(),
    interval: "1d",
    priceDirection: "token0PriceInToken1",
    points,
    source: "uniswap-v3-subgraph",
  } as unknown as PoolDailyPriceHistory;
};

const ok = <T,>(data: T): DataResult<T> => ({ status: "success", data });

const analyse = (overrides: Partial<Parameters<typeof analysePoolRange>[0]> = {}) =>
  analysePoolRange({
    pool: ok(pool()),
    snapshot: ok(snapshot()),
    history: ok(history()),
    parameters: DEFAULT_PRICE_BAND_PARAMETERS,
    ...overrides,
  });

const render = (result: ReturnType<typeof analysePoolRange>) =>
  renderToStaticMarkup(<PoolRangeReport result={result} poolAddress={POOL_ID} />);

describe("PoolRangeReport", () => {
  const markup = render(analyse());

  it("names the pair, the fee tier and the spacing", () => {
    expect(markup).toContain("USDC");
    expect(markup).toContain("WETH");
    expect(markup).toContain("0.30%");
    expect(markup).toContain(POOL_ID);
  });

  it("shows the two ticks a position would use", () => {
    const result = analyse();
    if (result.status === "unavailable") throw new Error("fixture should analyse");

    expect(markup).toContain(result.data.range.lowerTick.toLocaleString("en-US"));
    expect(markup).toContain(result.data.range.upperTick.toLocaleString("en-US"));
  });

  it("keeps a small price readable rather than rounding it away", () => {
    // A two-decimal formatter would render this pool's price as "0.00".
    expect(markup).toContain("0.000333333");
    expect(markup).not.toContain(">0.00<");
  });

  it("formats every figure it shows", () => {
    // A field routed through the wrong formatter, or a missing one, surfaces here.
    expect(markup).not.toContain("NaN");
    expect(markup).not.toContain("undefined");
    expect(markup).not.toContain("[object Object]");
  });

  it("says the position is currently in range", () => {
    expect(markup).toContain("Currently in range");
    // The answer itself, not only the sentence underneath it.
    expect(markup).toContain(">Yes<");
    expect(markup).toContain("The pool&#x27;s current tick sits inside these bounds.");
  });

  it("prices each edge from its own tick", () => {
    const result = analyse();
    if (result.status === "unavailable") throw new Error("fixture should analyse");

    const { lowerPrice, upperPrice } = result.data.range;
    expect(formatPrice(lowerPrice)).not.toBe(formatPrice(upperPrice));
    expect(markup).toContain(`Price ${formatPrice(lowerPrice)} WETH per USDC`);
    expect(markup).toContain(`Price ${formatPrice(upperPrice)} WETH per USDC`);
  });

  it("shows volatility as a percentage, not as a bare ratio", () => {
    const result = analyse();
    if (result.status === "unavailable") throw new Error("fixture should analyse");

    expect(markup).toContain(formatPercent(result.data.volatility.annualizedVolatility));
    expect(markup).toContain(formatPercent(result.data.volatility.dailyVolatility));
  });

  it("states what the band is not", () => {
    expect(markup).toContain("not a forecast");
    expect(markup).toContain("not a confidence level");
  });

  it("lists every caveat when the run was partial", () => {
    const result = analysePoolRange({
      pool: ok(pool()),
      snapshot: {
        status: "partial",
        data: snapshot(),
        missingFields: ["volume24hUsd"],
        warnings: ["Rolling volume is not available from this source."],
      },
      history: ok(history()),
      parameters: DEFAULT_PRICE_BAND_PARAMETERS,
    });

    const partialMarkup = render(result);
    expect(partialMarkup).toContain("Rolling volume is not available from this source.");
    // Singular and plural are both grammatical; a single template for both is not.
    expect(partialMarkup).toContain("One caveat applies");
    expect(partialMarkup).not.toContain("One caveat apply");
  });

  it("counts caveats in the plural when there is more than one", () => {
    const result = analysePoolRange({
      pool: ok(pool()),
      snapshot: {
        status: "partial",
        data: snapshot({ sourceBlockTimestamp: null }),
        missingFields: ["volume24hUsd"],
        warnings: ["A fetch caveat."],
      },
      history: ok(history()),
      parameters: DEFAULT_PRICE_BAND_PARAMETERS,
    });
    if (result.status !== "partial") throw new Error("fixture should warn");

    expect(render(result)).toContain(`${result.warnings.length} caveats apply`);
    expect(result.warnings.length).toBeGreaterThan(1);
  });

  it("says the conversion is unverified when the source reported no tick", () => {
    const unverified = render(analyse({ snapshot: ok(snapshot({ tick: null })) }));

    expect(unverified).toContain("reported no tick of its own");
  });

  it("shows an unreported TVL as absent rather than as zero", () => {
    const noTvl = render(analyse({ snapshot: ok(snapshot({ tvlUsd: null })) }));

    expect(noTvl).not.toContain("$0");
    expect(noTvl).toContain("—");
  });
});

describe("PoolRangeReport when there is nothing to show", () => {
  it("names the stage that stopped and repeats its message", () => {
    const failed = render({
      status: "unavailable",
      step: "history",
      reason: "network-error",
      message: "The market data service could not be reached.",
    });

    expect(failed).toContain("reading the pool&#x27;s daily price history");
    expect(failed).toContain("The market data service could not be reached.");
    expect(failed).toContain("network-error");
  });

  it("shows no figures at all rather than blanks where numbers belong", () => {
    const failed = render({
      status: "unavailable",
      step: "pool",
      reason: "configuration-error",
      message: "This application is not configured to read Uniswap data.",
    });

    expect(failed).not.toContain("Suggested tick range");
    expect(failed).not.toContain("Historical volatility");
  });
});
