import { describe, expect, it } from "vitest";

import {
  alignTickDown,
  alignTickUp,
  maxUsableTick,
  minUsableTick,
  priceAtTick,
  TICK_BASE,
  tickAtOrAbovePrice,
  tickAtOrBelowPrice,
} from "./v3TickMath";

const MIN_TICK = -887_272;
const MAX_TICK = 887_272;

/** Decimals for a pair where both tokens use 18, so no adjustment applies. */
const EIGHTEEN = { token0Decimals: 18, token1Decimals: 18 } as const;

/*
 * `ln(1.0001)` summed independently of the module, so the assertions below do not
 * inherit the constant they are meant to check. Alternating Mercator series,
 * accumulated smallest term first.
 */
const LN_TICK_BASE_REFERENCE = (() => {
  let total = 0;
  for (let term = 20; term >= 1; term -= 1) {
    total += (term % 2 === 1 ? 1 : -1) * (1e-4 ** term / term);
  }
  return total;
})();

describe("TICK_BASE", () => {
  it("is the ratio Uniswap fixed between adjacent ticks", () => {
    expect(TICK_BASE).toBe(1.0001);
  });
});

describe("tickAtOrBelowPrice", () => {
  it("puts a price of 1 at tick 0 when both tokens share decimals", () => {
    expect(tickAtOrBelowPrice({ price: 1, ...EIGHTEEN })).toEqual({ tick: 0, clampedTo: null });
  });

  it("puts one tick above par at tick 1", () => {
    expect(tickAtOrBelowPrice({ price: 1.0001, ...EIGHTEEN })).toEqual({
      tick: 1,
      clampedTo: null,
    });
  });

  it("rounds down, not to nearest", () => {
    // ln(2) / ln(1.0001) = 6931.818..., so the tick at or below is 6931.
    expect(tickAtOrBelowPrice({ price: 2, ...EIGHTEEN })?.tick).toBe(6931);
  });

  it("rounds down for negative ticks too, rather than toward zero", () => {
    // ln(0.5) / ln(1.0001) = -6931.818..., so the tick at or below is -6932.
    // Truncation toward zero would answer -6931, a tick whose price exceeds 0.5.
    expect(tickAtOrBelowPrice({ price: 0.5, ...EIGHTEEN })?.tick).toBe(-6932);
  });

  /*
   * The decimal adjustment, checked against pools whose live ticks are public.
   * These are the assertions that fail if the adjustment is dropped, or applied
   * with the exponent's sign reversed.
   */
  it("places DAI/USDC at par near the tick the live pool trades at", () => {
    // DAI (18 decimals) sorts before USDC (6), so token0 = DAI. One DAI buys one
    // USDC, but only 1e-12 of a USDC's smallest unit per DAI wei:
    //   ln(1e-12) / ln(1.0001) = -276324.026...
    // The live DAI/USDC pool sits in exactly this neighbourhood.
    expect(
      tickAtOrBelowPrice({ price: 1, token0Decimals: 18, token1Decimals: 6 })?.tick,
    ).toBe(-276_325);
  });

  it("places USDC/WETH near the tick the live pool trades at", () => {
    // USDC (6) sorts before WETH (18), so token0 = USDC and the price of one USDC
    // in WETH is about 1/3000. Raw price 1/3000 * 1e12 = 3.33e8:
    //   ln(3.33e8) / ln(1.0001) = 196256.347...
    expect(
      tickAtOrBelowPrice({ price: 1 / 3000, token0Decimals: 6, token1Decimals: 18 })?.tick,
    ).toBe(196_256);
  });

  it("moves the tick to the other side of zero when the decimals are swapped", () => {
    // Same price, opposite decimal gap. A conversion that ignored decimals would
    // answer 0 for both; one with the exponent reversed would answer these two
    // the wrong way round.
    const sixOverEighteen = tickAtOrBelowPrice({
      price: 1,
      token0Decimals: 18,
      token1Decimals: 6,
    });
    const eighteenOverSix = tickAtOrBelowPrice({
      price: 1,
      token0Decimals: 6,
      token1Decimals: 18,
    });

    expect(sixOverEighteen?.tick).toBe(-276_325);
    expect(eighteenOverSix?.tick).toBe(276_324);
  });

  it("clamps a price above TickMath's range and says so", () => {
    // 1.0001^887272 is about 3.4e38, so 1e39 has no tick.
    expect(tickAtOrBelowPrice({ price: 1e39, ...EIGHTEEN })).toEqual({
      tick: MAX_TICK,
      clampedTo: "max",
    });
  });

  it("clamps a price below TickMath's range and says so", () => {
    expect(tickAtOrBelowPrice({ price: 1e-39, ...EIGHTEEN })).toEqual({
      tick: MIN_TICK,
      clampedTo: "min",
    });
  });

  it("does not claim to have clamped a price that is merely extreme", () => {
    const result = tickAtOrBelowPrice({ price: 1e38, ...EIGHTEEN });

    expect(result?.clampedTo).toBeNull();
    expect(result?.tick).toBeLessThan(MAX_TICK);
  });

  it("reports the tick of a price that is exactly a tick's price", () => {
    // Without a boundary tolerance this is the case that silently answers k - 1:
    // the division lands a few picoticks short of the whole number.
    for (const tick of [-887_272, -276_325, -60, -1, 0, 1, 60, 196_256, 887_272]) {
      const price = priceAtTick({ tick, ...EIGHTEEN });
      expect(price).not.toBeNull();
      expect(tickAtOrBelowPrice({ price: price ?? 0, ...EIGHTEEN })?.tick).toBe(tick);
    }
  });

  it("rejects a price that is not a finite positive number", () => {
    for (const price of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(tickAtOrBelowPrice({ price, ...EIGHTEEN })).toBeNull();
    }
  });

  it("rejects decimals outside ERC-20's uint8", () => {
    expect(tickAtOrBelowPrice({ price: 1, token0Decimals: -1, token1Decimals: 18 })).toBeNull();
    expect(tickAtOrBelowPrice({ price: 1, token0Decimals: 18, token1Decimals: 256 })).toBeNull();
    expect(tickAtOrBelowPrice({ price: 1, token0Decimals: 1.5, token1Decimals: 18 })).toBeNull();
  });

  it("rejects an input carrying an unexpected field", () => {
    const withTypo = { price: 1, token0Decimals: 18, token1Decimals: 18, decimals: 18 };
    expect(tickAtOrBelowPrice(withTypo as never)).toBeNull();
  });
});

describe("tickAtOrAbovePrice", () => {
  it("rounds up rather than down", () => {
    expect(tickAtOrAbovePrice({ price: 2, ...EIGHTEEN })?.tick).toBe(6932);
    expect(tickAtOrAbovePrice({ price: 0.5, ...EIGHTEEN })?.tick).toBe(-6931);
  });

  it("agrees with the downward conversion when the price is exactly a tick's price", () => {
    for (const tick of [-276_325, -60, 0, 60, 196_256]) {
      const price = priceAtTick({ tick, ...EIGHTEEN }) ?? 0;

      expect(tickAtOrAbovePrice({ price, ...EIGHTEEN })?.tick).toBe(tick);
      expect(tickAtOrBelowPrice({ price, ...EIGHTEEN })?.tick).toBe(tick);
    }
  });

  it("sits exactly one tick above the downward conversion for a price in between", () => {
    for (const price of [2, 0.5, 1 / 3000, 1234.5678]) {
      const below = tickAtOrBelowPrice({ price, ...EIGHTEEN })?.tick ?? 0;
      const above = tickAtOrAbovePrice({ price, ...EIGHTEEN })?.tick ?? 0;

      expect(above - below).toBe(1);
    }
  });

  it("brackets the price it was given", () => {
    for (const price of [2, 0.5, 1 / 3000, 1234.5678, 1e20]) {
      const below = tickAtOrBelowPrice({ price, ...EIGHTEEN })?.tick ?? 0;
      const above = tickAtOrAbovePrice({ price, ...EIGHTEEN })?.tick ?? 0;

      expect(priceAtTick({ tick: below, ...EIGHTEEN }) ?? 0).toBeLessThanOrEqual(price);
      expect(priceAtTick({ tick: above, ...EIGHTEEN }) ?? 0).toBeGreaterThanOrEqual(price);
    }
  });

  it("clamps upward past the top of TickMath's range", () => {
    expect(tickAtOrAbovePrice({ price: 1e39, ...EIGHTEEN })).toEqual({
      tick: MAX_TICK,
      clampedTo: "max",
    });
  });
});

describe("the tick base's accuracy", () => {
  /*
   * `Math.log(1.0001)` is several hundred ulps away from ln(1.0001) in this
   * runtime, which shifts a tick by about 1e-7 at the ends of the range. That is
   * far too small to disturb an ordinary price, but at MIN_TICK and MAX_TICK it
   * pushes the conversion just past the boundary, and the result comes back
   * clamped rather than exact. This is the assertion that notices.
   */
  it("places the extreme ticks exactly instead of one step outside the range", () => {
    const lowestPrice = Math.exp(MIN_TICK * LN_TICK_BASE_REFERENCE);
    const highestPrice = Math.exp(MAX_TICK * LN_TICK_BASE_REFERENCE);

    expect(tickAtOrBelowPrice({ price: lowestPrice, ...EIGHTEEN })).toEqual({
      tick: MIN_TICK,
      clampedTo: null,
    });
    expect(tickAtOrAbovePrice({ price: highestPrice, ...EIGHTEEN })).toEqual({
      tick: MAX_TICK,
      clampedTo: null,
    });
  });
});

describe("priceAtTick", () => {
  it("prices tick 0 at par when both tokens share decimals", () => {
    expect(priceAtTick({ tick: 0, ...EIGHTEEN })).toBe(1);
  });

  it("prices tick 1 one basis point above par", () => {
    expect(priceAtTick({ tick: 1, ...EIGHTEEN }) ?? 0).toBeCloseTo(1.0001, 12);
  });

  it("undoes the decimal adjustment", () => {
    // The DAI/USDC tick from above must price back to roughly one USDC per DAI.
    expect(priceAtTick({ tick: -276_325, token0Decimals: 18, token1Decimals: 6 }) ?? 0).toBeCloseTo(
      1,
      3,
    );
  });

  it("increases with the tick", () => {
    let previous = Number.NEGATIVE_INFINITY;
    for (const tick of [-887_272, -276_325, -1, 0, 1, 6931, 887_272]) {
      const price = priceAtTick({ tick, ...EIGHTEEN }) ?? 0;
      expect(price).toBeGreaterThan(previous);
      previous = price;
    }
  });

  it("stays finite and positive at every extreme of tick and decimals", () => {
    // The widest exponent reachable is 887272 * ln(1.0001) + 255 * ln(10), about
    // 675.9. `exp` of that is ~3.4e293, so neither end overflows.
    for (const tick of [MIN_TICK, MAX_TICK]) {
      for (const [token0Decimals, token1Decimals] of [
        [0, 255],
        [255, 0],
        [0, 0],
        [255, 255],
      ] as const) {
        const price = priceAtTick({ tick, token0Decimals, token1Decimals });

        expect(price).not.toBeNull();
        expect(Number.isFinite(price ?? Number.NaN)).toBe(true);
        expect(price ?? 0).toBeGreaterThan(0);
      }
    }
  });

  it("lands at the bottom of the interval the original price fell in", () => {
    const price = 1234.5678;
    const tick = tickAtOrBelowPrice({ price, ...EIGHTEEN })?.tick ?? 0;
    const roundTripped = priceAtTick({ tick, ...EIGHTEEN }) ?? 0;

    expect(roundTripped).toBeLessThanOrEqual(price);
    expect(roundTripped * TICK_BASE).toBeGreaterThan(price);
  });

  it("rejects a tick outside TickMath's range or one that is not whole", () => {
    expect(priceAtTick({ tick: MAX_TICK + 1, ...EIGHTEEN })).toBeNull();
    expect(priceAtTick({ tick: MIN_TICK - 1, ...EIGHTEEN })).toBeNull();
    expect(priceAtTick({ tick: 1.5, ...EIGHTEEN })).toBeNull();
  });

  it("rejects decimals outside ERC-20's uint8", () => {
    expect(priceAtTick({ tick: 0, token0Decimals: 256, token1Decimals: 18 })).toBeNull();
  });
});

describe("minUsableTick / maxUsableTick", () => {
  it("returns TickMath's own bounds only when the spacing is 1", () => {
    expect(minUsableTick(1)).toBe(MIN_TICK);
    expect(maxUsableTick(1)).toBe(MAX_TICK);
  });

  it("pulls the bounds inward for every real v3 fee tier's spacing", () => {
    // 0.01% -> 1, 0.05% -> 10, 0.30% -> 60, 1.00% -> 200.
    expect(minUsableTick(10)).toBe(-887_270);
    expect(maxUsableTick(10)).toBe(887_270);
    expect(minUsableTick(60)).toBe(-887_220);
    expect(maxUsableTick(60)).toBe(887_220);
    expect(minUsableTick(200)).toBe(-887_200);
    expect(maxUsableTick(200)).toBe(887_200);
  });

  it("handles the widest spacing a v3 pool may have", () => {
    // 16383 * 54 = 884682, the last multiple inside the range.
    expect(minUsableTick(16_383)).toBe(-884_682);
    expect(maxUsableTick(16_383)).toBe(884_682);
  });

  it("returns multiples of the spacing that sit inside TickMath's range", () => {
    for (const spacing of [1, 2, 10, 60, 200, 2047, 16_383]) {
      const lowest = minUsableTick(spacing) ?? Number.NaN;
      const highest = maxUsableTick(spacing) ?? Number.NaN;

      // `Math.abs` because a negative multiple leaves -0, which `toBe` separates from 0.
      expect(Math.abs(lowest % spacing)).toBe(0);
      expect(Math.abs(highest % spacing)).toBe(0);
      expect(lowest).toBeGreaterThanOrEqual(MIN_TICK);
      expect(highest).toBeLessThanOrEqual(MAX_TICK);
      // Nothing usable lies outside them.
      expect(lowest - spacing).toBeLessThan(MIN_TICK);
      expect(highest + spacing).toBeGreaterThan(MAX_TICK);
    }
  });

  it("rejects a spacing no v3 pool can have", () => {
    for (const spacing of [0, -60, 1.5, 16_384, Number.NaN]) {
      expect(minUsableTick(spacing)).toBeNull();
      expect(maxUsableTick(spacing)).toBeNull();
    }
  });
});

describe("alignTickDown / alignTickUp", () => {
  it("leaves an already aligned tick alone", () => {
    expect(alignTickDown({ tick: 120, tickSpacing: 60 })).toBe(120);
    expect(alignTickUp({ tick: 120, tickSpacing: 60 })).toBe(120);
    expect(alignTickDown({ tick: -120, tickSpacing: 60 })).toBe(-120);
    expect(alignTickUp({ tick: -120, tickSpacing: 60 })).toBe(-120);
  });

  it("rounds a positive tick outward in each direction", () => {
    expect(alignTickDown({ tick: 125, tickSpacing: 60 })).toBe(120);
    expect(alignTickUp({ tick: 125, tickSpacing: 60 })).toBe(180);
  });

  /*
   * The trap this module exists to avoid. JavaScript's `%` and integer division
   * both truncate toward zero, so the naive form answers -120 for the downward
   * case — a tick *above* the input. Most pools that pair a 6-decimal token as
   * token0 live entirely in negative ticks, so the naive form would widen one
   * edge of nearly every real range and narrow the other.
   */
  it("rounds a negative tick away from zero when rounding down", () => {
    expect(alignTickDown({ tick: -125, tickSpacing: 60 })).toBe(-180);
    expect(alignTickDown({ tick: -125, tickSpacing: 60 })).not.toBe(-120);
  });

  it("rounds a negative tick toward zero when rounding up", () => {
    expect(alignTickUp({ tick: -125, tickSpacing: 60 })).toBe(-120);
    expect(alignTickUp({ tick: -125, tickSpacing: 60 })).not.toBe(-180);
  });

  it("aligns the live USDC/WETH tick to its pool's spacing", () => {
    expect(alignTickDown({ tick: 196_256, tickSpacing: 10 })).toBe(196_250);
    expect(alignTickUp({ tick: 196_256, tickSpacing: 10 })).toBe(196_260);
  });

  it("aligns the live DAI/USDC tick, whose spacing leaves it untouched", () => {
    expect(alignTickDown({ tick: -276_325, tickSpacing: 1 })).toBe(-276_325);
    expect(alignTickUp({ tick: -276_325, tickSpacing: 1 })).toBe(-276_325);
  });

  it("never returns a tick the pool would refuse", () => {
    for (const spacing of [1, 10, 60, 200, 16_383]) {
      for (const tick of [
        MIN_TICK,
        MIN_TICK + 1,
        -887_000,
        -125,
        -1,
        0,
        1,
        125,
        887_000,
        MAX_TICK - 1,
        MAX_TICK,
        -5_000_000,
        5_000_000,
      ]) {
        const down = alignTickDown({ tick, tickSpacing: spacing }) ?? Number.NaN;
        const up = alignTickUp({ tick, tickSpacing: spacing }) ?? Number.NaN;

        for (const aligned of [down, up]) {
          expect(Math.abs(aligned % spacing)).toBe(0);
          expect(aligned).toBeGreaterThanOrEqual(minUsableTick(spacing) ?? Number.NaN);
          expect(aligned).toBeLessThanOrEqual(maxUsableTick(spacing) ?? Number.NaN);
        }

        expect(down).toBeLessThanOrEqual(up);
      }
    }
  });

  it("stays at the input's own side of the spacing when the clamp does not apply", () => {
    for (const spacing of [1, 10, 60, 200]) {
      for (const tick of [-887_000, -125, -1, 0, 1, 125, 887_000]) {
        expect(alignTickDown({ tick, tickSpacing: spacing }) ?? Number.NaN).toBeLessThanOrEqual(
          tick,
        );
        expect(alignTickUp({ tick, tickSpacing: spacing }) ?? Number.NaN).toBeGreaterThanOrEqual(
          tick,
        );
      }
    }
  });

  it("is idempotent", () => {
    for (const spacing of [1, 10, 60, 200, 16_383]) {
      for (const tick of [-887_000, -125, 0, 125, 887_000]) {
        const down = alignTickDown({ tick, tickSpacing: spacing }) ?? Number.NaN;
        const up = alignTickUp({ tick, tickSpacing: spacing }) ?? Number.NaN;

        expect(alignTickDown({ tick: down, tickSpacing: spacing })).toBe(down);
        expect(alignTickUp({ tick: up, tickSpacing: spacing })).toBe(up);
      }
    }
  });

  /*
   * At the floor of the range the clamp outranks the rounding direction: there is
   * no multiple of 60 below -887220, so rounding "down" from MIN_TICK has to move
   * up. Returning -887280 instead would be a tick the pool rejects outright.
   */
  it("lets the clamp win over the rounding direction at the ends of the range", () => {
    expect(alignTickDown({ tick: MIN_TICK, tickSpacing: 60 })).toBe(-887_220);
    expect(alignTickUp({ tick: MAX_TICK, tickSpacing: 60 })).toBe(887_220);
    expect(alignTickDown({ tick: -5_000_000, tickSpacing: 60 })).toBe(-887_220);
    expect(alignTickUp({ tick: 5_000_000, tickSpacing: 60 })).toBe(887_220);
  });

  it("rejects a spacing no v3 pool can have", () => {
    for (const tickSpacing of [0, -60, 1.5, 16_384]) {
      expect(alignTickDown({ tick: 0, tickSpacing })).toBeNull();
      expect(alignTickUp({ tick: 0, tickSpacing })).toBeNull();
    }
  });

  it("rejects a tick that is not a safe whole number", () => {
    for (const tick of [1.5, Number.NaN, Number.POSITIVE_INFINITY, 2 ** 53]) {
      expect(alignTickDown({ tick, tickSpacing: 60 })).toBeNull();
      expect(alignTickUp({ tick, tickSpacing: 60 })).toBeNull();
    }
  });
});
