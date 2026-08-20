import {
  type DataResult,
  nonZeroEvmAddress,
  type PoolDailyPriceHistory,
} from "../../schemas";
import {
  DAILY_HISTORY_DAYS,
  resolveDailyHistoryWindow,
} from "./v3DailyHistoryWindow";
import { normalizeV3DailyPriceHistory } from "./v3DailyPriceHistoryAdapter";
import {
  DEFAULT_SUBGRAPH_TIMEOUT_MS,
  type FetchLike,
  postV3SubgraphQuery,
} from "./v3SubgraphTransport";

/**
 * The pool address is passed twice, as two variables, because the generated
 * Subgraph API wants two different scalars for the same value: a singular entity
 * lookup always takes `id: ID!`, while a filter on an entity-reference field takes
 * the referenced entity's id scalar, which graph-node renders as `String` for both
 * `String` and `Bytes` ids. Splicing the address into the query text would avoid
 * the duplication and reintroduce an injection surface, so it stays a variable.
 *
 * `date` is `Int!` on `PoolDayData`, hence `Int!` bounds.
 *
 * The top-level `pool { id }` is requested so an unknown pool is distinguishable
 * from a known pool with no indexed days. Each daily row repeats `pool { id }` so
 * its ownership can be verified individually: a filter is a request, not proof of
 * what came back. `first` caps the result at the window size, which is why no
 * `skip` pagination is needed.
 */
export const V3_DAILY_PRICE_HISTORY_QUERY = `query PoolDailyPriceHistory(
  $poolId: ID!
  $poolRef: String!
  $rangeStart: Int!
  $rangeEndExclusive: Int!
  $dayLimit: Int!
) {
  pool(id: $poolId) {
    id
  }
  poolDayDatas(
    where: { pool: $poolRef, date_gte: $rangeStart, date_lt: $rangeEndExclusive }
    orderBy: date
    orderDirection: asc
    first: $dayLimit
  ) {
    id
    date
    token1Price
    pool {
      id
    }
  }
  _meta {
    block {
      number
      timestamp
    }
    hasIndexingErrors
  }
}`;

const INVALID_ADDRESS =
  "The pool address must be 0x followed by 40 hexadecimal characters, and cannot be the zero address.";
const NOT_CONFIGURED =
  "Uniswap v3 market data is not configured on this server. Set THE_GRAPH_API_KEY and UNISWAP_V3_ETHEREUM_SUBGRAPH_ID.";

/** Shared with the snapshot reader: no v3 pool is ever deployed at address zero. */
const PoolAddressSchema = nonZeroEvmAddress(INVALID_ADDRESS);

export type EthereumV3DailyPriceHistoryRequest = {
  readonly poolAddress: string;
  /** Raw environment values; validated here so the wrapper stays free of logic. */
  readonly apiKey: string | undefined;
  readonly subgraphId: string | undefined;
  readonly fetchImpl: FetchLike;
  /** Injected clock. Fixes both `fetchedAt` and the UTC day window. */
  readonly now: () => Date;
  readonly timeoutMs?: number;
};

/**
 * Reads the previous 31 completed UTC days of closing prices for one Ethereum
 * mainnet Uniswap v3 pool.
 *
 * Validation order matches the snapshot reader: caller input first, then server
 * configuration, and neither reaches the network.
 *
 * The injected clock is read twice, and deliberately so: once before the request
 * to fix the UTC day window being asked about, and once after the response
 * arrives to stamp `fetchedAt`. They are different facts — what was requested
 * versus when the answer landed — and collapsing them into one reading is what
 * would let a slow request disguise stale data.
 */
export const fetchEthereumV3DailyPriceHistory = async (
  request: EthereumV3DailyPriceHistoryRequest,
): Promise<DataResult<PoolDailyPriceHistory>> => {
  const address = PoolAddressSchema.safeParse(request.poolAddress);
  if (!address.success) {
    return { status: "unavailable", reason: "invalid-input", message: INVALID_ADDRESS };
  }

  const apiKey = request.apiKey?.trim();
  const subgraphId = request.subgraphId?.trim();
  if (apiKey === undefined || apiKey === "" || subgraphId === undefined || subgraphId === "") {
    return { status: "unavailable", reason: "configuration-error", message: NOT_CONFIGURED };
  }

  // Read before the request so the window reflects the day the query asked about.
  const requestedAt = request.now();
  const window = resolveDailyHistoryWindow(requestedAt);

  const transport = await postV3SubgraphQuery({
    apiKey,
    subgraphId,
    query: V3_DAILY_PRICE_HISTORY_QUERY,
    variables: {
      poolId: address.data,
      poolRef: address.data,
      rangeStart: window.rangeStartUnixSeconds,
      rangeEndExclusive: window.rangeEndExclusiveUnixSeconds,
      dayLimit: DAILY_HISTORY_DAYS,
    },
    fetchImpl: request.fetchImpl,
    timeoutMs: request.timeoutMs ?? DEFAULT_SUBGRAPH_TIMEOUT_MS,
  });

  if (!transport.ok) {
    return { status: "unavailable", reason: transport.reason, message: transport.message };
  }

  /*
   * Read again, now that the response is in hand.
   *
   * `fetchedAt` is defined as when the answer arrived, and freshness is measured
   * against it. Reusing the pre-request instant would subtract the request's own
   * duration from the apparent lag, so a slow call would make the source look
   * fresher than it is — and a genuinely stale response could pass the staleness
   * gate purely because the round trip was slow.
   */
  const receivedAt = request.now();

  return normalizeV3DailyPriceHistory({
    payload: transport.payload,
    poolAddress: address.data,
    fetchedAt: receivedAt.toISOString(),
    window,
  });
};
