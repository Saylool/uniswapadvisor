import { NextResponse, type NextRequest } from "next/server";

import { clientKeyFromHeaders } from "./lib/ratelimit/clientKey";
import {
  POOL_ANALYSIS_REQUEST_LIMIT,
  poolAnalysisRateLimiter,
} from "./lib/ratelimit/poolAnalysisRateLimiter";
import { EvmAddressSchema } from "./schemas/primitives";

/*
 * Rate limits the one route that spends third-party API quota.
 *
 * Here rather than inside the page because a refused request should cost as
 * little as possible: Proxy runs before rendering begins, and it can answer with
 * a real `429` and a `Retry-After` header, which a Server Component has no way
 * to set.
 *
 * Imports reach past the schema barrel on purpose. The barrel pulls in every
 * domain contract, and this file runs on every matched request; only the address
 * format is needed here.
 *
 * Two limits worth stating plainly:
 *
 *   - The count lives in one process's memory. A platform that runs several
 *     instances multiplies the effective limit by however many are warm, so this
 *     is a deterrent against casual abuse, not a hard ceiling. A hard ceiling
 *     needs a store the instances share.
 *   - It identifies a caller by proxy-set headers, so it is only as trustworthy
 *     as the hop in front of it. See `clientKey.ts`.
 */

export const config = {
  matcher: "/pool",
};

/**
 * A page for the refused request.
 *
 * Deliberately self-contained rather than reusing the application's layout: at
 * this point the goal is to spend nothing, and rendering the real page is the
 * cost being avoided. Only a number is interpolated.
 */
const tooManyRequestsPage = (retryAfterSeconds: number): string => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Too many requests</title>
    <style>
      :root { color-scheme: light dark; }
      body {
        margin: 0; padding: 1.5rem; min-height: 100vh;
        display: grid; place-items: center;
        font: 16px/1.6 ui-sans-serif, system-ui, sans-serif;
      }
      main { max-width: 34rem; }
      h1 { font-size: 1.5rem; margin: 0 0 1rem; }
      p { margin: 0 0 1rem; }
    </style>
  </head>
  <body>
    <main>
      <h1>Too many requests</h1>
      <p>
        This page reads live Uniswap data on every visit, so it is limited to
        ${POOL_ANALYSIS_REQUEST_LIMIT} analyses per minute.
      </p>
      <p>Try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}.</p>
      <p><a href="/">Back to the advisor</a></p>
    </main>
  </body>
</html>
`;

export function proxy(request: NextRequest): NextResponse {
  /*
   * Only a request that will actually reach the subgraphs is counted. A missing
   * or malformed address is answered by the page itself without a single
   * upstream call, so charging it against someone's allowance would mean a typo
   * costs them an analysis.
   */
  const requested = request.nextUrl.searchParams.get("address");
  if (requested === null || !EvmAddressSchema.safeParse(requested).success) {
    return NextResponse.next();
  }

  const decision = poolAnalysisRateLimiter.check(clientKeyFromHeaders(request.headers));
  if (decision.allowed) return NextResponse.next();

  return new NextResponse(tooManyRequestsPage(decision.retryAfterSeconds), {
    status: 429,
    headers: {
      "Retry-After": String(decision.retryAfterSeconds),
      "Content-Type": "text/html; charset=utf-8",
      // Never let a shared cache serve one visitor's refusal to another.
      "Cache-Control": "no-store",
    },
  });
}
