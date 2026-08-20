# Uniswap Strategy Advisor

An educational, AI-assisted decision-support tool for Uniswap v3 and v4 liquidity
strategies. Users describe a goal in plain language; the application explains the
relevant Uniswap features and parameters.

**This is not financial advice.** The application does not predict prices, does
not guarantee returns, and cannot attest that any smart contract is safe.

## Status

Early. The landing page is static, and there is no AI integration, persistence,
authentication, wallet connection or transaction capability of any kind.

The first read-only market-data adapter exists: a server-only reader that fetches
one Ethereum mainnet Uniswap v3 pool from The Graph and normalises it into a
`PoolMarketSnapshot`. It is not wired to any route or component yet. Its limits
are deliberate:

- Ethereum mainnet (`chainId` 1) and Uniswap v3 only.
- One pool per call, by address.
- Rolling 24h/7d/30d volume is **not** available in this phase. The pool entity
  exposes a lifetime cumulative total, which is not a rolling window, so those
  fields stay `null` and the call returns a `partial` result naming them. No
  figure is estimated to fill the gap.
- Full `V3Pool` metadata is not built, because the pool entity does not report
  `tickSpacing`.

## Getting started

```bash
npm install
cp .env.example .env.local   # fill in values as integrations land
npm run dev
```

Open http://localhost:3000.

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
| `src/lib/uniswap`     | One isolated service module per external source (v3 subgraph, v4 subgraph, hook registry). |
| `src/lib/analytics`   | Deterministic, dependency-free calculations: volatility, ranges, ratios.    |
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

The v3 market-data reader needs both of:

| Variable | Purpose |
| --- | --- |
| `THE_GRAPH_API_KEY` | Sent only as an `Authorization: Bearer` header, never in a URL or body. |
| `UNISWAP_V3_ETHEREUM_SUBGRAPH_ID` | The stable **Subgraph ID** from The Graph Explorer — not a deployment/IPFS id. The gateway resolves it to the latest sufficiently synced deployment. |

With either absent or blank, the reader returns an `unavailable` result with
reason `configuration-error` and makes no network request.
