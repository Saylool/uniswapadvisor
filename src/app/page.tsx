import { EducationalDisclaimer } from "@/components/EducationalDisclaimer";

/**
 * Scope shown on the landing page. These are the features the advisor is being
 * built to cover — none of them are implemented yet, so the UI labels them as
 * planned rather than available.
 */
const PLANNED_COVERAGE = [
  {
    version: "Uniswap v3",
    features: [
      {
        name: "Concentrated liquidity",
        summary:
          "Choosing a price range that matches how much of the time you want your capital earning fees.",
      },
      {
        name: "Fee tier selection",
        summary:
          "Comparing the available fee tiers for a pair against how that pair actually trades.",
      },
      {
        name: "Range orders",
        summary:
          "Using a one-sided position to convert between two tokens as price moves through a band.",
      },
    ],
  },
  {
    version: "Uniswap v4",
    features: [
      {
        name: "Hook discovery",
        summary:
          "Finding published hooks relevant to a goal, with their limitations stated plainly.",
      },
      {
        name: "Dynamic fee hooks",
        summary:
          "Understanding when a fee that responds to market conditions is worth the added complexity.",
      },
      {
        name: "TWAMM-style strategies",
        summary:
          "Spreading a large order over time instead of executing it against a single point of liquidity.",
      },
    ],
  },
] as const;

const METHOD_STEPS = [
  {
    step: "Verified data",
    detail:
      "Pool statistics are fetched from Uniswap subgraphs and public registries, never assumed.",
  },
  {
    step: "Deterministic maths",
    detail:
      "Volatility, ranges and liquidity metrics are computed in plain TypeScript, so the numbers are reproducible.",
  },
  {
    step: "AI interpretation",
    detail:
      "The model explains what those figures mean for your goal. It is not allowed to invent them.",
  },
] as const;

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-12 px-6 py-16 sm:py-24">
      <header className="flex flex-col gap-4">
        <span className="w-fit rounded-full border border-border px-3 py-1 font-mono text-xs uppercase tracking-widest text-muted">
          Early foundation
        </span>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">
          Uniswap Strategy Advisor
        </h1>
        <p className="max-w-2xl text-lg leading-relaxed text-muted">
          An AI-powered advisor for Uniswap{" "}
          <span className="text-accent">v3</span> and{" "}
          <span className="text-accent">v4</span>. Describe what you are trying
          to do in ordinary language, and get an explanation of the features and
          parameters involved — without needing to know the low-level mechanics
          first.
        </p>
      </header>

      <EducationalDisclaimer />

      <section className="flex flex-col gap-6">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">
          How it will work
        </h2>
        <ol className="flex flex-col gap-4 sm:flex-row">
          {METHOD_STEPS.map(({ step, detail }, index) => (
            <li
              key={step}
              className="flex-1 rounded-lg border border-border bg-surface p-4"
            >
              <p className="font-mono text-xs text-accent">
                {String(index + 1).padStart(2, "0")}
              </p>
              <p className="mt-2 font-medium">{step}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">
                {detail}
              </p>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">
          Planned coverage
        </h2>
        <div className="grid gap-8 sm:grid-cols-2">
          {PLANNED_COVERAGE.map(({ version, features }) => (
            <div key={version} className="flex flex-col gap-4">
              <h3 className="font-medium">{version}</h3>
              <ul className="flex flex-col gap-4">
                {features.map(({ name, summary }) => (
                  <li key={name} className="border-l-2 border-border pl-4">
                    <p className="text-sm font-medium">{name}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted">
                      {summary}
                    </p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-auto border-t border-border pt-6 text-sm leading-relaxed text-muted">
        <p>
          Nothing above is live yet: this build is the project foundation, with
          no market data, no AI analysis and no wallet connection. The advisor
          produces recommendations only — it will never sign or send a
          transaction on your behalf.
        </p>
      </footer>
    </main>
  );
}
