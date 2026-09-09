import { type DataResult, V3TickSpacingSchema } from "../../schemas";
import { EthCallResponseSchema } from "./v3TickSpacingRawResponse";

/**
 * Calldata for `IUniswapV3PoolImmutables.tickSpacing()`.
 *
 * The function takes no arguments, so the four-byte selector is the entire
 * payload. The value is `keccak256("tickSpacing()")[0:4]`, which cannot be
 * computed here — Node ships NIST SHA-3, not Ethereum's keccak — so it is a
 * constant, cross-checked against three independent sources: the 4byte
 * directory, openchain.xyz (flagged as seen in verified contracts), and the
 * signature in Uniswap's own `IUniswapV3PoolImmutables.sol`.
 */
export const TICK_SPACING_CALLDATA = "0xd0c93a7c";

/** A 32-byte ABI return word: `0x` plus exactly 64 hex characters. */
const ABI_WORD_PATTERN = /^0x[0-9a-fA-F]{64}$/;

const MALFORMED = "The on-chain data source returned a response this application cannot verify.";
const NOT_A_POOL =
  "No Uniswap v3 pool contract answered at this address on Ethereum mainnet.";

const unavailable = (
  reason: "invalid-response" | "not-found",
  message: string,
): DataResult<number> => ({ status: "unavailable", reason, message });

/**
 * Decodes a `tickSpacing()` return value.
 *
 * Pure: no clock, no network, no environment.
 *
 * `tickSpacing` is declared `int24` and, per Uniswap's own comment, is always
 * positive; the type exists only to avoid casting. ABI-encoding right-aligns it
 * in a 32-byte word, so a negative value would arrive sign-extended as a huge
 * number and a corrupt one as anything at all. Both are rejected by decoding
 * through `BigInt` — which is exact, unlike `Number` on a 64-hex-digit string —
 * and then bounding the result through the domain schema.
 *
 * An empty `0x` result means the call returned nothing, which is what an EOA or a
 * non-Uniswap contract does. That is reported as not-found rather than as a
 * malformed response: the address is well-formed, it simply is not a v3 pool.
 */
export const normalizeV3TickSpacing = (payload: unknown): DataResult<number> => {
  const parsed = EthCallResponseSchema.safeParse(payload);
  if (!parsed.success) return unavailable("invalid-response", MALFORMED);

  // Fail closed. A JSON-RPC response may carry both, and a result beside an error
  // is not a verified answer.
  if (parsed.data.error != null) return unavailable("invalid-response", MALFORMED);

  const result = parsed.data.result;
  if (result == null) return unavailable("invalid-response", MALFORMED);
  if (result === "0x") return unavailable("not-found", NOT_A_POOL);
  if (!ABI_WORD_PATTERN.test(result)) return unavailable("invalid-response", MALFORMED);

  const decoded = BigInt(result);
  if (decoded > BigInt(Number.MAX_SAFE_INTEGER)) {
    // Sign-extended negative, or simply not a tick spacing.
    return unavailable("invalid-response", MALFORMED);
  }

  // The schema carries the protocol bound: 1 through 16_383, from the v3 factory's
  // `require(tickSpacing > 0 && tickSpacing < 16384)`.
  const tickSpacing = V3TickSpacingSchema.safeParse(Number(decoded));
  if (!tickSpacing.success) return unavailable("invalid-response", MALFORMED);

  return { status: "success", data: tickSpacing.data };
};
