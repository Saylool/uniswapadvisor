# Uniswap Strategy Advisor

An educational, AI-assisted decision-support tool for Uniswap v3 and v4 liquidity
strategies. Users describe a goal in plain language; the application explains the
relevant Uniswap features and parameters.

**This is not financial advice.** The application does not predict prices, does
not guarantee returns, and cannot attest that any smart contract is safe.

## Status

Project foundation only. There is no market data, no AI integration, no
persistence, no authentication and no wallet connectivity in this build. The
landing page is static.

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
| `npm run lint`      | ESLint                                             |
| `npm run typecheck` | Generate route types, then `tsc --noEmit`          |

`typecheck` runs `next typegen` first because the App Router type helpers
(`PageProps`, `LayoutProps`, `RouteContext`) are generated, not hand-written.

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
| `src/schemas`         | Zod schemas validating external responses and AI structured output.         |
| `src/types`           | Internal application types, normalised away from external API shapes.       |

### Boundary rules

- External API shapes never reach components. Normalise into internal types
  (`src/types`) at the service boundary, validating with `src/schemas`.
- Analytics functions stay pure and deterministic so their results are
  reproducible and testable without network access.
- Prompts are composed as `base + feature + user input + verified data`. There is
  no single prompt containing all application logic.
- Server-only modules (anything reading `process.env` or holding a credential)
  must never be imported by a Client Component.
- Missing or stale data returns an explicit missing-data state. The application
  must never substitute fabricated market values.

## Environment variables

All credentials are server-side. See `.env.example`. Never prefix a credential
with `NEXT_PUBLIC_` — that inlines it into the client bundle.
