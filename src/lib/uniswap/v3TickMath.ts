import { z } from "zod";

import {
  MAX_TICK,
  MIN_TICK,
  PositivePriceSchema,
  type Tick,
  TickSchema,
  TokenDecimalsSchema,
  V3TickSpacingSchema,
} from "../../schemas";

/*
 * Conversion between human prices and Uniswap v3 ticks, and alignment of a tick
 * to a pool's tick spacing.
 *
 * Pure and clock-free: no network, no environment, no I/O. Every function is a
 * total mapping from its arguments to its result, so the same input always
 * produces the same output.
 *
 * Nothing here decides *which* range to use. These are the coordinate transforms
 * a range needs; choosing the bounds is the price-band layer's job, and turning a
 * pair of aligned ticks into a deployable position belongs to a later layer that
 * also carries the pool's identity.
 *
 * ## The price a tick encodes
 *
 * Uniswap defines `price(t) = 1.0001^t`, where the price is token1 per token0 in
 * *raw* units — the tokens' smallest indivisible units, as they appear on-chain.
 * Application prices are human prices: whole token1 per whole token0, which is
 * the direction this project names `token0PriceInToken1`. The two differ by the
 * tokens' decimal difference:
 *
 *   rawPrice = humanPrice * 10^(token1Decimals - token0Decimals)
 *
 * because one whole token0 is `10^token0Decimals` raw units and one whole token1
 * is `10^token1Decimals` raw units.
 *
 * Dropping that adjustment, or applying it with the sign reversed, is the single
 * most damaging mistake available here: a USDC/WETH range would land twelve
 * orders of magnitude away from the pool's real price and still look like a
 * perfectly ordinary tick number. The decimals are therefore required arguments
 * with no default, and the direction is asserted by tests against pools whose
 * live ticks are publicly checkable.
 */

/** The price ratio between two adjacent ticks. Uniswap fixes it at exactly 1.0001. */
export const TICK_BASE = 1.0001;

/**
 * `ln(1.0001)` — the divisor that turns a natural log price into a tick index.
 *
 * Written as `log1p(1e-4)` rather than `Math.log(TICK_BASE)` because `Math.log`
 * is inaccurate for arguments this close to 1: in this runtime it lands about
 * 1.1e-17 from the true value, several hundred units in the last place, which is
 * enough to shift a tick near the ends of TickMath's range. `log1p` computes the
 * same quantity without ever forming the number 1.0001, and reproduces the
 * alternating-series expansion of ln(1.0001) bit for bit.
 *
 * `1e-4` is the exact decimal `TICK_BASE - 1`. It is spelled out rather than
 * computed as `TICK_BASE - 1`, because that subtraction is performed on the
 * nearest double to 1.0001 and yields a slightly different number, which
 * `log1p` faithfully — and unhelpfully — takes the logarithm of.
 */
const LN_TICK_BASE = Math.log1p(1e-4);

/**
 * How close to a whole tick a computed value must be before it is treated as
 * landing exactly on that tick.
 *
 * Without it, a price that *is* a tick's price frequently converts to the tick
 * below: `log(price) / ln(1.0001)` is accurate to roughly 4e-12 ticks across the
 * whole range, and `Math.floor` turns "0.000000000004 short of tick k" into
 * `k - 1`. The tolerance is three orders of magnitude above that measured error
 * and still vanishingly small in price terms — 1e-9 ticks is a relative price
 * difference near 1e-13, far below the precision of any price this application
 * ingests.
 */
const TICK_BOUNDARY_TOLERANCE = 1e-9;

/** A price converted to a tick, and whether TickMath's range truncated it. */
export type TickFromPrice = {
  readonly tick: Tick;
  /**
   * `null` when the tick is the true one. Otherwise names the bound the price
   * exceeded, so a caller can tell the user its range was cut short rather than
   * silently reporting a boundary tick as if the price had asked for it.
   */
  readonly clampedTo: "min" | "max" | null;
};

const PriceInputSchema = z.strictObject({
  /** Whole token1 per whole token0 — the `token0PriceInToken1` direction. */
  price: PositivePriceSchema,
  token0Decimals: TokenDecimalsSchema,
  token1Decimals: TokenDecimalsSchema,
});

/** Input for a price-to-tick conversion. Decimals are required, never assumed. */
export type PriceToTickInput = z.infer<typeof PriceInputSchema>;

const TickInputSchema = z.strictObject({
  tick: TickSchema,
  token0Decimals: TokenDecimalsSchema,
  token1Decimals: TokenDecimalsSchema,
});

export type TickToPriceInput = z.infer<typeof TickInputSchema>;

const AlignmentInputSchema = z.strictObject({
  /**
   * Any safe integer, not only a tick inside TickMath's range: alignment clamps,
   * so an out-of-range input has a well-defined answer rather than being an
   * error the caller has to pre-empt.
   */
  tick: z.int(),
  tickSpacing: V3TickSpacingSchema,
});

export type TickAlignmentInput = z.infer<typeof AlignmentInputSchema>;

/**
 * Largest multiple of `spacing` that does not exceed `tick`, with no clamping.
 *
 * Uses the modulo identity rather than `Math.floor(tick / spacing) * spacing`
 * so the arithmetic stays in exact integers. `%` truncates toward zero in
 * JavaScript, which makes `-125 % 60` equal `-5` rather than the `55` that
 * floored division wants, so the remainder is folded back into `[0, spacing)`
 * first. Skipping that fold is the classic way to round a negative tick the
 * wrong direction — and every pool priced below 1 in raw units, which is most
 * pools pairing a 6-decimal token as token0, lives entirely in negative ticks.
 */
const alignDownExact = (tick: number, spacing: number): number =>
  tick - (((tick % spacing) + spacing) % spacing);

/** Smallest multiple of `spacing` that is not below `tick`, with no clamping. */
const alignUpExact = (tick: number, spacing: number): number => {
  const remainder = ((tick % spacing) + spacing) % spacing;
  return remainder === 0 ? tick : tick + (spacing - remainder);
};

/**
 * The lowest tick a pool with this spacing accepts as a position boundary.
 *
 * Not `MIN_TICK`: a boundary must be a multiple of the pool's spacing, and
 * -887272 is only a multiple when the spacing is 1. For the 0.30% tier's spacing
 * of 60 the real floor is -887220.
 *
 * `null` when the spacing is not one a v3 pool can have.
 */
export const minUsableTick = (tickSpacing: number): number | null => {
  const spacing = V3TickSpacingSchema.safeParse(tickSpacing);
  if (!spacing.success) return null;

  return alignUpExact(MIN_TICK, spacing.data);
};

/** The highest tick a pool with this spacing accepts as a position boundary. */
export const maxUsableTick = (tickSpacing: number): number | null => {
  const spacing = V3TickSpacingSchema.safeParse(tickSpacing);
  if (!spacing.success) return null;

  return alignDownExact(MAX_TICK, spacing.data);
};

const clampToUsable = (tick: number, spacing: number): number => {
  const lowest = alignUpExact(MIN_TICK, spacing);
  const highest = alignDownExact(MAX_TICK, spacing);

  if (tick < lowest) return lowest;
  if (tick > highest) return highest;
  return tick;
};

/**
 * Rounds a tick down to a boundary the pool accepts.
 *
 * The result is always usable: a multiple of `tickSpacing` inside TickMath's
 * range. At the very bottom of that range the clamp outranks the rounding
 * direction — there is no usable tick below {@link minUsableTick}, so a tick at
 * or under it rounds *up* to it. Everywhere else the result is at most the input.
 *
 * `null` when the spacing is not one a v3 pool can have, or the tick is not a
 * safe integer.
 */
export const alignTickDown = (input: TickAlignmentInput): number | null => {
  const parsed = AlignmentInputSchema.safeParse(input);
  if (!parsed.success) return null;

  const { tick, tickSpacing } = parsed.data;
  return clampToUsable(alignDownExact(tick, tickSpacing), tickSpacing);
};

/**
 * Rounds a tick up to a boundary the pool accepts.
 *
 * Mirrors {@link alignTickDown}: always usable, and at the top of TickMath's
 * range the clamp wins, so a tick at or above {@link maxUsableTick} rounds down
 * to it.
 */
export const alignTickUp = (input: TickAlignmentInput): number | null => {
  const parsed = AlignmentInputSchema.safeParse(input);
  if (!parsed.success) return null;

  const { tick, tickSpacing } = parsed.data;
  return clampToUsable(alignUpExact(tick, tickSpacing), tickSpacing);
};

/**
 * The natural log of the raw price a human price corresponds to.
 *
 * Computed in log space rather than as `price * 10 ** (d1 - d0)` so the decimal
 * adjustment cannot overflow: a 255-decimal gap is a factor of 1e255, which
 * would send any ordinary price to `Infinity` or `0` long before the tick itself
 * became unrepresentable.
 */
const rawLogPrice = (input: PriceToTickInput): number =>
  Math.log(input.price) + (input.token1Decimals - input.token0Decimals) * Math.LN10;

const tickFromPrice = (input: unknown, rounding: "down" | "up"): TickFromPrice | null => {
  const parsed = PriceInputSchema.safeParse(input);
  if (!parsed.success) return null;

  /*
   * Always finite and always a safe integer once rounded. `Math.log` of any
   * finite positive double lies in [-745, 710]; the decimal term adds at most
   * 255 * ln(10) ~= 587; and dividing a magnitude under 1332 by ln(1.0001)
   * cannot exceed ~1.4e7. So there is no overflow branch to take here, and none
   * is written.
   */
  const exact = rawLogPrice(parsed.data) / LN_TICK_BASE;

  const nearest = Math.round(exact);
  const unbounded =
    Math.abs(exact - nearest) <= TICK_BOUNDARY_TOLERANCE
      ? nearest
      : rounding === "down"
        ? Math.floor(exact)
        : Math.ceil(exact);

  if (unbounded < MIN_TICK) return { tick: MIN_TICK, clampedTo: "min" };
  if (unbounded > MAX_TICK) return { tick: MAX_TICK, clampedTo: "max" };
  return { tick: unbounded, clampedTo: null };
};

/**
 * The highest tick whose price does not exceed `price` — the same convention as
 * v3-core's `TickMath.getTickAtSqrtRatio`.
 *
 * Use it for the *lower* edge of a range: the resulting tick's price sits at or
 * below the price asked for, so the range starts no later than intended.
 *
 * `null` when the price is not a finite positive number, or a decimals value is
 * outside ERC-20's uint8.
 */
export const tickAtOrBelowPrice = (input: PriceToTickInput): TickFromPrice | null =>
  tickFromPrice(input, "down");

/**
 * The lowest tick whose price is not below `price`.
 *
 * Use it for the *upper* edge of a range. Rounding the other way and relying on
 * {@link alignTickUp} to recover the difference does not work when the pool's
 * spacing is 1, because then every integer is already aligned and the alignment
 * step has nothing left to correct.
 */
export const tickAtOrAbovePrice = (input: PriceToTickInput): TickFromPrice | null =>
  tickFromPrice(input, "up");

/**
 * The human price a tick encodes, in the `token0PriceInToken1` direction.
 *
 * The inverse of {@link tickAtOrBelowPrice} up to that function's rounding: a
 * tick names a half-open price interval, so converting back lands on the bottom
 * of the interval the original price fell in, not on the original price.
 *
 * The result is always a finite, strictly positive, normal double, so there is
 * no overflow case to report. The largest exponent reachable is
 * `887272 * ln(1.0001) + 255 * ln(10)`, about 675.9, and `exp(675.9)` is roughly
 * 3.4e293 — comfortably inside the double range at both ends.
 *
 * `null` only when the tick is outside TickMath's range or is not an integer, or
 * a decimals value is outside ERC-20's uint8.
 */
export const priceAtTick = (input: TickToPriceInput): number | null => {
  const parsed = TickInputSchema.safeParse(input);
  if (!parsed.success) return null;

  const { tick, token0Decimals, token1Decimals } = parsed.data;
  return Math.exp(tick * LN_TICK_BASE - (token1Decimals - token0Decimals) * Math.LN10);
};
