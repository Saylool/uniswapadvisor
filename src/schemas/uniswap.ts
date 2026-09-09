import { z } from "zod";

import {
  Bytes32HexSchema,
  ChainIdSchema,
  EvmAddressSchema,
  nonZeroEvmAddress,
} from "./primitives";

/** Protocol versions this advisor currently models. v2 is out of scope. */
export const ProtocolVersionSchema = z.enum(["v3", "v4"]);

export type ProtocolVersion = z.infer<typeof ProtocolVersionSchema>;

/*
 * Fees are expressed in parts-per-million of the swap amount — the raw on-chain
 * integer unit Uniswap documents as "hundredths of a bip", where 3000 means
 * 0.30%. They stay integers so nothing rounds before the advisor has finished
 * reasoning about them.
 *
 * The limits differ by protocol and the difference is off-by-one, so a shared
 * schema would silently mis-validate one of them:
 *   v3  UniswapV3Factory.enableFeeAmount: require(fee < 1000000)   -> max 999_999
 *   v4  LPFeeLibrary.isValid: self <= MAX_LP_FEE (1000000)         -> max 1_000_000
 *
 * Which tiers are actually *enabled* is governance-controlled, so no whitelist of
 * popular tiers is hardcoded here.
 */
export const V3_MAX_FEE_PPM = 999_999;
export const V4_MAX_LP_FEE_PPM = 1_000_000;

const feePpmUpTo = (maxInclusive: number) => z.int().min(0).max(maxInclusive);

/** v3 swap fee, fixed at pool deployment. */
export const V3FeePpmSchema = feePpmUpTo(V3_MAX_FEE_PPM);

export type V3FeePpm = z.infer<typeof V3FeePpmSchema>;

/**
 * v4 LP fee. Accepts the full inclusive `MAX_LP_FEE` range.
 *
 * v4 marks a pool as dynamic by storing the sentinel `DYNAMIC_FEE_FLAG`
 * (0x800000 = 8_388_608) in the PoolKey's fee field. That is far above
 * `MAX_LP_FEE`, so this schema cannot accept it — the flag is a wire-format
 * detail for the service layer to decode into `V4FeeConfiguration.kind`, never a
 * fee value the rest of the application sees.
 */
export const V4LpFeePpmSchema = feePpmUpTo(V4_MAX_LP_FEE_PPM);

export type V4LpFeePpm = z.infer<typeof V4LpFeePpmSchema>;

/*
 * Tick spacing bounds also differ per protocol:
 *   v3  UniswapV3Factory.enableFeeAmount: tickSpacing > 0 && tickSpacing < 16384
 *   v4  TickMath.MIN_TICK_SPACING = 1, MAX_TICK_SPACING = type(int16).max
 */
export const V3_MAX_TICK_SPACING = 16_383;
export const V4_MAX_TICK_SPACING = 32_767;

const tickSpacingUpTo = (maxInclusive: number) => z.int().min(1).max(maxInclusive);

export const V3TickSpacingSchema = tickSpacingUpTo(V3_MAX_TICK_SPACING);
export const V4TickSpacingSchema = tickSpacingUpTo(V4_MAX_TICK_SPACING);

export type TickSpacing = z.infer<typeof V3TickSpacingSchema>;

/**
 * A tick index. Bounded by TickMath's MIN_TICK/MAX_TICK, which are the same
 * constants in v3 and v4.
 */
export const TickSchema = z.int().min(-887272).max(887272);

export type Tick = z.infer<typeof TickSchema>;

const tokenShape = {
  chainId: ChainIdSchema,
  symbol: z.string().min(1, { error: "Token symbol must not be empty." }),
  /** ERC-20 declares `decimals()` as uint8, so 0-255 is a protocol invariant. */
  decimals: z.int().min(0).max(255),
  name: z.string().min(1).optional(),
} as const;

/**
 * Protocol-independent token identity. Deliberately excludes price, balance and
 * any other time-varying figure: those belong to a market snapshot, which carries
 * an observation time. A token identity does not go stale.
 *
 * The zero address is permitted here because Uniswap v4 uses it to mean the
 * chain's native currency, which is a legitimate identity. Contexts where it is
 * *not* legitimate — every v3 token — use {@link V3TokenSchema} instead.
 */
export const TokenSchema = z.strictObject({
  ...tokenShape,
  address: EvmAddressSchema,
});

export type Token = z.infer<typeof TokenSchema>;

/**
 * A token in a v3 pool. v3 has no native-currency concept — every currency is an
 * ERC-20 contract — so the zero address here means a normalizer dropped a field,
 * not that the pool trades ether.
 */
export const V3TokenSchema = z.strictObject({
  ...tokenShape,
  address: nonZeroEvmAddress(
    "A v3 token must be an ERC-20 contract address; v3 has no native currency.",
  ),
});

export type V3Token = z.infer<typeof V3TokenSchema>;

/*
 * Pool identity differs by protocol, so each variant validates its own id: a v3
 * pool is a contract deployed by the factory and addressed by an EVM address,
 * while a v4 pool is an entry inside the singleton PoolManager keyed by a bytes32
 * PoolId. Both variants expose `id`, so code that only needs a key can read
 * `pool.id` without narrowing.
 */
const v3IdentityShape = {
  protocolVersion: z.literal("v3"),
  chainId: ChainIdSchema,
  id: nonZeroEvmAddress(
    "A v3 pool id must be the deployed pool contract address, never the zero address.",
  ),
} as const;

const v4IdentityShape = {
  protocolVersion: z.literal("v4"),
  chainId: ChainIdSchema,
  id: Bytes32HexSchema,
} as const;

/**
 * Points at a pool without carrying its metadata. A pool id is only unique within
 * one chain and one protocol version, so all three fields are required.
 */
export const PoolReferenceSchema = z.discriminatedUnion("protocolVersion", [
  z.strictObject(v3IdentityShape),
  z.strictObject(v4IdentityShape),
]);

export type PoolReference = z.infer<typeof PoolReferenceSchema>;

/**
 * How a v4 pool charges. A static pool has one fee forever; a dynamic pool lets
 * its hook rewrite the fee per swap, so the current value is only meaningful if we
 * actually observed it — hence `null` rather than a placeholder number.
 */
export const V4FeeConfigurationSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("static"), feePpm: V4LpFeePpmSchema }),
  z.strictObject({ kind: z.literal("dynamic"), currentFeePpm: V4LpFeePpmSchema.nullable() }),
]);

export type V4FeeConfiguration = z.infer<typeof V4FeeConfigurationSchema>;

/**
 * A hook contract attached to a v4 pool. The zero address is refused because
 * on-chain it means "no hook" — that state is `hookAddress: null` on the pool, so
 * it cannot arrive here disguised as a real contract.
 *
 * Security, audit and permission metadata are intentionally absent; they belong to
 * a separate hook-registry model, and this application never asserts that a
 * contract is safe.
 */
export const HookAddressSchema = nonZeroEvmAddress(
  "The zero address means 'no hook'; represent that as null instead.",
);

export type HookAddress = z.infer<typeof HookAddressSchema>;

/**
 * Hook permission flags, taken from v4-core `Hooks.sol`.
 *
 * v4 encodes a hook's permissions in the *address itself*: the low 14 bits say
 * which callbacks the PoolManager will invoke. A hook is deployed to a mined
 * address whose trailing bits spell out its permissions, so the address is data,
 * not just an identifier.
 */
export const HOOK_PERMISSION_FLAGS = {
  BEFORE_INITIALIZE: 1 << 13,
  AFTER_INITIALIZE: 1 << 12,
  BEFORE_ADD_LIQUIDITY: 1 << 11,
  AFTER_ADD_LIQUIDITY: 1 << 10,
  BEFORE_REMOVE_LIQUIDITY: 1 << 9,
  AFTER_REMOVE_LIQUIDITY: 1 << 8,
  BEFORE_SWAP: 1 << 7,
  AFTER_SWAP: 1 << 6,
  BEFORE_DONATE: 1 << 5,
  AFTER_DONATE: 1 << 4,
  BEFORE_SWAP_RETURNS_DELTA: 1 << 3,
  AFTER_SWAP_RETURNS_DELTA: 1 << 2,
  AFTER_ADD_LIQUIDITY_RETURNS_DELTA: 1 << 1,
  AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA: 1 << 0,
} as const;

/** `Hooks.ALL_HOOK_MASK` — the low 14 bits that carry permissions. */
export const ALL_HOOK_MASK = (1 << 14) - 1;

/**
 * Reads a hook address's permission bits.
 *
 * The low 14 bits live in the address's last 4 hex characters, so a 16-bit slice
 * masked to 14 is exact — no bignum and no external dependency needed. The
 * address has already passed {@link EvmAddressSchema}, so the slice is guaranteed
 * to be hex and lower-cased.
 */
export const hookPermissionBits = (hookAddress: string): number =>
  Number.parseInt(hookAddress.slice(-4), 16) & ALL_HOOK_MASK;

/**
 * A return-delta flag is meaningless without the callback it modifies, so each
 * one requires its parent. `Hooks.isValidHookAddress` rejects these orphans
 * outright, whatever the fee mode.
 */
const RETURN_DELTA_DEPENDENCIES = [
  [HOOK_PERMISSION_FLAGS.BEFORE_SWAP_RETURNS_DELTA, HOOK_PERMISSION_FLAGS.BEFORE_SWAP],
  [HOOK_PERMISSION_FLAGS.AFTER_SWAP_RETURNS_DELTA, HOOK_PERMISSION_FLAGS.AFTER_SWAP],
  [
    HOOK_PERMISSION_FLAGS.AFTER_ADD_LIQUIDITY_RETURNS_DELTA,
    HOOK_PERMISSION_FLAGS.AFTER_ADD_LIQUIDITY,
  ],
  [
    HOOK_PERMISSION_FLAGS.AFTER_REMOVE_LIQUIDITY_RETURNS_DELTA,
    HOOK_PERMISSION_FLAGS.AFTER_REMOVE_LIQUIDITY,
  ],
] as const satisfies readonly (readonly [number, number])[];

/*
 * Unrefined object schemas. Kept private: parsing through one of these would skip
 * the cross-field invariants below, which is exactly the hole that makes a
 * swapped token pair invisible. `discriminatedUnion` needs plain object schemas to
 * read the discriminator from, so the invariants are layered on afterwards and
 * these raw shapes never leave the module.
 */
/*
 * The v3 pool facts a subgraph can actually confirm.
 *
 * `tickSpacing` is deliberately absent. No Uniswap subgraph exposes it — not the
 * `Pool` entity, not `Factory`, not the tokens subgraph — so a metadata read has
 * no verified value to report. Deriving it from the fee tier would mean shipping
 * a hardcoded table, which this project refuses because governance can enable
 * nonstandard tiers with their own spacing. It is read separately, on-chain.
 */
const v3PoolMetadataShape = {
  ...v3IdentityShape,
  token0: V3TokenSchema,
  token1: V3TokenSchema,
  feePpm: V3FeePpmSchema,
} as const;

const v3PoolMetadataObject = z.strictObject(v3PoolMetadataShape);

const v3PoolObject = z.strictObject({
  ...v3PoolMetadataShape,
  tickSpacing: V3TickSpacingSchema,
});

const v4PoolObject = z.strictObject({
  ...v4IdentityShape,
  token0: TokenSchema,
  token1: TokenSchema,
  tickSpacing: V4TickSpacingSchema,
  fee: V4FeeConfigurationSchema,
  /** `null` states that the pool runs without a hook. */
  hookAddress: HookAddressSchema.nullable(),
});

/**
 * The minimum surface the pool invariants below need to inspect.
 *
 * Discriminated so the v4-only rules can read `fee` and `hookAddress` while the
 * same helper still accepts a v3 pool, which has neither.
 */
type PoolInvariantInput = {
  readonly chainId: number;
  readonly token0: { readonly chainId: number; readonly address: string };
  readonly token1: { readonly chainId: number; readonly address: string };
} & (
  | { readonly protocolVersion: "v3" }
  | {
      readonly protocolVersion: "v4";
      readonly fee: { readonly kind: "static" | "dynamic" };
      readonly hookAddress: string | null;
    }
);

const tokensShareChain = (pool: PoolInvariantInput): boolean =>
  pool.token0.chainId === pool.chainId && pool.token1.chainId === pool.chainId;

// Uniswap sorts a pool's currencies ascending by address, and the comparison is
// strict, so an equal pair is rejected too. Enforcing it here catches a
// normalizer that swapped the pair, which would otherwise invert every price this
// advisor reports without any visible error. Addresses are already lower-cased
// and equal-length, so lexicographic order matches numeric order.
const tokensCorrectlyOrdered = (pool: PoolInvariantInput): boolean =>
  pool.token0.address < pool.token1.address;

/**
 * `Hooks.isValidHookAddress`, first clause: a hook must be present exactly when
 * the protocol needs one, and must claim at least one permission unless the
 * dynamic fee is what justifies its existence.
 *
 * No hook means the fee cannot be dynamic — there would be nobody to set it. A
 * hook with no permission bits is only meaningful on a dynamic-fee pool, where
 * rewriting the fee is the whole job.
 */
const v4HookMatchesFeeMode = (pool: PoolInvariantInput): boolean => {
  if (pool.protocolVersion === "v3") return true;

  const feeIsDynamic = pool.fee.kind === "dynamic";
  if (pool.hookAddress === null) return !feeIsDynamic;

  return hookPermissionBits(pool.hookAddress) !== 0 || feeIsDynamic;
};

/**
 * `Hooks.isValidHookAddress`, return-delta clauses. Enforced for every hook
 * regardless of fee mode. A null hook has no bits set, so it passes trivially —
 * the same outcome the Solidity check reaches for `address(0)`.
 */
const v4ReturnDeltaFlagsHaveParents = (pool: PoolInvariantInput): boolean => {
  if (pool.protocolVersion === "v3" || pool.hookAddress === null) return true;

  const bits = hookPermissionBits(pool.hookAddress);
  return RETURN_DELTA_DEPENDENCIES.every(
    ([returnsDelta, parent]) => (bits & returnsDelta) === 0 || (bits & parent) !== 0,
  );
};

/**
 * Applies the invariants that hold for every pool regardless of protocol, plus
 * the v4-only hook rules, which a v3 pool passes by construction.
 *
 * Every exported pool schema goes through here, so there is no exported entry
 * point that can parse a pool while skipping them.
 */
const withPoolInvariants = <Schema extends z.ZodType<PoolInvariantInput>>(schema: Schema) =>
  schema
    .refine(tokensShareChain, {
      error: "Both tokens must live on the same chain as the pool.",
    })
    .refine(tokensCorrectlyOrdered, {
      error: "token0.address must sort strictly before token1.address, as Uniswap orders them.",
    })
    .refine(v4HookMatchesFeeMode, {
      error:
        "A dynamic-fee v4 pool requires a hook, and a hook with no permission bits is only valid on a dynamic-fee pool.",
      path: ["hookAddress"],
    })
    .refine(v4ReturnDeltaFlagsHaveParents, {
      error:
        "A hook's return-delta permission bit requires the matching callback bit to be set as well.",
      path: ["hookAddress"],
    });

/**
 * Everything about a v3 pool except its tick spacing.
 *
 * A distinct type rather than a partial `V3Pool`: it states exactly what a
 * subgraph read can verify, so nothing downstream can mistake an unread tick
 * spacing for a missing one. Carries the same token-ordering and chain
 * invariants, which is what makes it usable for price/decimal work on its own.
 */
export const V3PoolMetadataSchema = withPoolInvariants(v3PoolMetadataObject);

export type V3PoolMetadata = z.infer<typeof V3PoolMetadataSchema>;

/**
 * A v3 pool. The fee is fixed for the lifetime of the pool and baked into its own
 * deployment, so it is a plain value with no "is it known?" state.
 */
export const V3PoolSchema = withPoolInvariants(v3PoolObject);

export type V3Pool = z.infer<typeof V3PoolSchema>;

/** A v4 pool inside the singleton PoolManager. */
export const V4PoolSchema = withPoolInvariants(v4PoolObject);

export type V4Pool = z.infer<typeof V4PoolSchema>;

/** A pool of either protocol, narrowable on `protocolVersion`. */
export const PoolSchema = withPoolInvariants(
  z.discriminatedUnion("protocolVersion", [v3PoolObject, v4PoolObject]),
);

export type Pool = z.infer<typeof PoolSchema>;
