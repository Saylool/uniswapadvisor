# Uniswap Strategy Advisor

An educational, AI-assisted decision-support tool for Uniswap v3 and v4 liquidity
strategies. Users describe a goal in plain language; the application explains the
relevant Uniswap features and parameters.

**This is not financial advice.** The application does not predict prices, does
not guarantee returns, and cannot attest that any smart contract is safe.

## Status

Early. The landing page is static, and there is no AI integration, persistence,
authentication, wallet connection or transaction capability of any kind.

Three read-only market-data adapters exist, all server-only readers over The
Graph and none wired to any route or component yet:

1. **Current pool snapshot** — one Ethereum mainnet Uniswap v3 pool, normalised
   into a `PoolMarketSnapshot`.
2. **Pool metadata** — a pool's fixed configuration: verified token ordering,
   token `decimals`, symbols and fee tier, normalised into a `V3PoolMetadata`.
   Read separately because the snapshot does not carry it, and it is what any
   price/decimal conversion needs first.
3. **Daily price history** — the previous 31 *completed* UTC days of closing
   prices for one such pool, normalised into a `PoolDailyPriceHistory`. 31 closes
   give 30 daily returns, which is what a 30-day volatility figure needs. The
   current, still-incomplete UTC day is always excluded.

Days the source never indexed are reported as gaps, never invented. There is no
forward-filling of a previous close and no treating a missing day as zero, so a
short series stays visibly short rather than looking complete.

A first deterministic analytics layer sits on top of that history: daily
close-to-close log returns and historical volatility. It is pure — no clock, no
network, no environment — so the same input always yields the same output. A
return is only computed between observations exactly one UTC day apart; a pair
straddling a missing day is skipped rather than rescaled into a daily figure, and
the result reports how much of the window it could actually use. Volatility is the
sample standard deviation (divisor `n - 1`) of those log returns, annualised by
`sqrt(365)` because crypto markets trade every calendar day. Figures are decimal
ratios, not percentages.

On top of that sits a deterministic continuous **price band**: a zero-drift,
log-symmetric range around the current pool price, scaled from historical
volatility by `sqrt(horizonDays / 365)` and a caller-supplied standard-deviation
multiplier. Because it is symmetric in log space it is deliberately asymmetric in
percentage terms — a band that reaches half price downward reaches double price
upward, and only one of those is "50%".

A band is **not a prediction and not a probability guarantee**. The multiplier is
not a confidence level: calling `2` a "95% band" would need a distributional
assumption this project does not establish. Zero volatility collapses the band
onto the current price rather than inventing a minimum width.

A band is a statement about *prices*, not about ticks. Turning one into position
boundaries needs three verified inputs: token ordering, token decimals, and the
pool's tick spacing. The metadata adapter supplies the first two.

**Tick spacing cannot come from a subgraph.** It appears nowhere in the official
Uniswap v3 subgraph schema — not on `Pool`, not on `Factory`, not in the tokens
subgraph. Deriving it from the fee tier would mean hardcoding a tier-to-spacing
table, which this project refuses because governance can enable nonstandard tiers
with their own spacing. So it is read directly from the pool contract with a
read-only `eth_call` to `tickSpacing()`, and `fetchEthereumV3Pool` combines that
with the subgraph metadata into a complete `V3Pool`.

That gives tick conversion all three inputs it needs, and the conversion itself
now exists as a pure module (`src/lib/uniswap/v3TickMath.ts`): a human price maps
to the tick at or below it and to the tick at or above it, a tick maps back to a
price, and a tick rounds to a boundary the pool will accept.

Two details there are worth stating, because getting either wrong yields a number
that looks perfectly ordinary. First, a tick encodes `1.0001^t` as token1 per
token0 in *raw* units, so a human price must be shifted by
`10^(token1Decimals - token0Decimals)` before the logarithm — omit it and a
USDC/WETH range lands twelve orders of magnitude away from the pool. Second,
alignment folds the remainder into `[0, tickSpacing)` before subtracting it,
because JavaScript's `%` truncates toward zero and would round negative ticks the
wrong way; most pools holding a 6-decimal token as token0 sit entirely in negative
ticks.

Alignment always returns a tick a pool accepts: a multiple of the spacing, inside
a range that is *narrower* than `MIN_TICK`/`MAX_TICK`, since ±887272 is only a
multiple of the spacing when the spacing is 1 — for the 0.30% tier the real floor
is -887220. A price outside TickMath's range comes back clamped with the bound it
hit named, so a truncated range can never be mistaken for a requested one.

On top of both sits the composition: `calculateV3TickRange` takes a price band, a
`V3Pool` and the snapshot the band was centred on, and produces a **`V3TickRange`**
— two ticks the pool would accept. Each edge moves *outward* only, so the range
always covers at least the band it came from; rounding inward would quietly hand
back a narrower position while still looking like the band's range.

It is still not a position. Nothing here sizes a deposit, quotes an amount of
either token, or claims the range is a good one.

**The range is checked against the chain's own tick.** The subgraph publishes both
the pool's `tick` and its price, so converting that price with the metadata
adapter's decimals must land on that tick. Nothing else in the application can
tell that a pool's decimals are wrong — every downstream figure stays perfectly
well-formed — so when the two disagree by more than one tick, no range is
published at all. A source that reports no tick still produces a range, with a
warning saying the conversion went unverified.

Three more states are reported rather than smoothed over:

- An edge that runs past what the pool can express is **truncated** to the
  outermost usable tick and flagged, so a shortened range is never mistaken for
  the one that was asked for.
- A band narrower than one tick spacing has no two distinct boundaries. It is
  refused, not widened — widening would invent a range the band never described,
  and whether to accept a wider one is a policy decision for a layer that can say
  so out loud.
- A current tick outside the resulting range is flagged, because a position built
  there would hold a single token and earn nothing until price returns.

The `V3TickRange` schema re-derives every price from its tick by direct
exponentiation, where the calculator works in log space, and pins each boundary to
exactly one tick by requiring both that it covers the band and that the next tick
inward does not. A validator that re-ran the calculator's own expression would
reproduce its bugs and agree with itself.

All of it is now wired into one page. `/pool` takes a pool address, runs the three
reads concurrently, and works them through volatility, band and range to a pair of
ticks. It is a Server Component, so the credentials the readers need never enter a
browser bundle, and the address arrives as a search parameter rather than a path
segment so the form that submits it can be plain HTML with no client JavaScript.

The pipeline reports **which stage** stopped when one does, so a pool with two days
of history, a pool behind an unreachable subgraph, and a missing API key are three
distinguishable outcomes rather than one blank screen.

**No pool address is hardcoded anywhere.** Shipping one would mean asserting from
memory which contract a pair lives at, and an address this application cannot
verify has no place in its UI.

Still absent: no recommendation policy, no risk categories, no AI, no persistence
and no wallet connection.

Shared limits of both adapters:

- Ethereum mainnet (`chainId` 1) and Uniswap v3 only.
- One pool per call, by address.
- No wallet, transaction, signing or approval capability of any kind.
- Rolling 24h/7d/30d volume is **not** available in this phase. The pool entity
  exposes a lifetime cumulative total, which is not a rolling window, so those
  fields stay `null` and the call returns a `partial` result naming them. No
  figure is estimated to fill the gap.
- The subgraph alone cannot build a full `V3Pool`, because the pool entity does
  not report `tickSpacing`. `fetchEthereumV3Pool` adds it from the contract.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in the three values below
npm run dev
```

Open http://localhost:3000, then follow **Analyse a pool** to `/pool` and paste an
Ethereum mainnet Uniswap v3 pool address — the pool contract's own address, not a
token's.

Without `.env.local` filled in, the page still renders: it reports a
`configuration-error` for the stage that needed a credential and makes no network
request.

Fonts are self-hosted from `src/app/fonts/` via `next/font/local`, so `next build`
makes no network request for them and works offline or behind a restrictive
proxy.

## Scripts

| Command             | Purpose                                            |
| ------------------- | -------------------------------------------------- |
| `npm run dev`       | Development server                                 |
| `npm run build`     | Production build (also type-checks)                |
| `npm run start`     | Serve the production build                         |
| `npm test`          | Run the Vitest runtime regression suite once       |
| `npm run lint`      | ESLint                                             |
| `npm run typecheck` | Generate route types, then `tsc --noEmit`          |

`typecheck` runs `next typegen` first because the App Router type helpers
(`PageProps`, `LayoutProps`, `RouteContext`) are generated, not hand-written.
It also checks the persistent compile-time assertions in
`src/schemas/dataResult.type-test.ts`; those assertions are intentionally not
collected by Vitest as runtime tests.

## Architecture

The governing rule is that **the AI never invents market data and never performs
the important financial arithmetic**. The intended request flow is:

```
user input
  -> backend route handler
  -> fetch verified external data   (src/lib/uniswap)
  -> deterministic calculations     (src/lib/analytics)
  -> AI interpretation              (src/lib/ai)
  -> structured JSON response       (src/schemas)
  -> frontend presentation          (src/app, src/components)
```

### Directories

| Path                  | Contents                                                                    |
| --------------------- | --------------------------------------------------------------------------- |
| `src/app`             | App Router routes, layouts and route handlers.                              |
| `src/components`      | Presentational React components. No data fetching, no secrets.              |
| `src/lib/uniswap`     | One isolated service module per external source (v3 subgraph, v4 subgraph, JSON-RPC), plus pure Uniswap protocol math such as tick conversion. |
| `src/lib/analytics`   | Deterministic, dependency-free calculations: volatility, ranges, ratios.    |
| `src/lib/advisor`     | Composition: the pure pipeline from fetched data to a tick range, plus its server-only wrapper. |
| `src/lib/format`      | Deterministic display formatting. Locale-pinned so server-rendered output cannot vary by host. |
| `src/lib/observability` | Server-side diagnostics for failed reads. Records status codes, never URLs or headers. |
| `src/lib/ai`          | OpenAI client wiring and response handling.                                 |
| `src/lib/ai/prompts`  | One module per feature, composed on top of a shared base instruction module. |
| `src/schemas`         | The normalized domain contracts: Zod schemas plus the types inferred from them. |
| `src/types`           | Internal types with no runtime shape to validate, e.g. UI view models.      |

### Boundary rules

- External API shapes never reach components. Service modules normalise them
  into the domain contracts in `src/schemas` at the boundary, and the rest of
  the application only ever sees those.
- Domain types are inferred from their Zod schema (`z.infer`) rather than
  declared alongside it, so a schema and its type cannot drift apart.
- Every data-fetching module returns `DataResult<T>`, which distinguishes
  success, partial and unavailable. Missing financial metrics are `null`;
  `0` means a source reported zero.
- A failure message meant for a user never carries a credential, a URL containing
  one, a stack trace or a raw provider payload. The technical detail goes to a
  server-side log instead (`src/lib/observability`), which records an HTTP status,
  an elapsed time, a thrown error's *name* and the failure category — and never
  the request URL or its headers, because the RPC URL embeds its key in the path
  and the Graph key rides in an `Authorization` header. Tests assert those absences
  directly rather than trusting the code to have left them out.
- Fetch time and source freshness are separate fields. `fetchedAt` records when a
  response arrived; `sourceBlockNumber` / `sourceBlockTimestamp` record what it
  describes. A lagging indexer must never look fresh, so fetch time is never
  copied into the source-block fields.
- Protocol limits that differ between v3 and v4 (fee ceiling, tick spacing, whether
  the zero address is a valid currency) are validated per protocol variant, not by
  a shared permissive schema.
- Analytics functions stay pure and deterministic so their results are
  reproducible and testable without network access.
- Prompts are composed as `base + feature + user input + verified data`. There is
  no single prompt containing all application logic.
- Server-only modules (anything reading `process.env` or holding a credential)
  import `server-only` and are never re-exported through a barrel file, so a
  Client Component cannot reach a credential path by accident.
- Transport and normalisation stay pure and take an injected `fetch` and clock, so
  the whole flow is testable without the server-only wrapper and without network
  access.
- Missing or stale data returns an explicit missing-data state. The application
  must never substitute fabricated market values.

## Environment variables

All credentials are server-side. See `.env.example`. Never prefix a credential
with `NEXT_PUBLIC_` — that inlines it into the client bundle.

The v3 market-data readers need all three of:

| Variable | Purpose |
| --- | --- |
| `THE_GRAPH_API_KEY` | Sent only as an `Authorization: Bearer` header, never in a URL or body. |
| `UNISWAP_V3_ETHEREUM_SUBGRAPH_ID` | The stable **Subgraph ID** from The Graph Explorer — not a deployment/IPFS id. The gateway resolves it to the latest sufficiently synced deployment. |
| `ETHEREUM_RPC_URL` | Mainnet JSON-RPC endpoint for read-only `eth_call`. **Treat the whole URL as a secret** — most providers embed the key in the path. |

Reads are read-only throughout: the RPC path issues `eth_call` and nothing else.
There is no signing, no account access, and no transaction capability anywhere in
the codebase.

With any of them absent or blank, the reader that needs it returns an
`unavailable` result with reason `configuration-error` and makes no network
request — so the page reports a configuration problem rather than a data one.
