import Link from "next/link";

import { EducationalDisclaimer } from "@/components/EducationalDisclaimer";
import { PreferenceBar } from "@/components/PreferenceBar";
import { getRequestDictionary } from "@/lib/i18n/requestLocale";

export default async function Home() {
  const { locale, t } = await getRequestDictionary();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-12 px-6 py-16 sm:py-24">
      <PreferenceBar locale={locale} t={t} />

      <header className="flex flex-col gap-4">
        <span className="w-fit rounded-full border border-border px-3 py-1 font-mono text-xs uppercase tracking-widest text-muted">
          {t.home.badge}
        </span>
        <h1 className="text-4xl font-semibold tracking-tight sm:text-5xl">{t.home.title}</h1>
        <p className="max-w-2xl text-lg leading-relaxed text-muted">
          {t.home.introBeforeV3}
          <span className="text-accent">v3</span>
          {t.home.introBetween}
          <span className="text-accent">v4</span>
          {t.home.introAfterV4}
        </p>
      </header>

      <EducationalDisclaimer t={t} />

      <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">
          {t.home.workingTodayHeading}
        </h2>
        <p className="text-sm leading-relaxed">{t.home.workingTodayBody}</p>
        <Link
          href="/pool"
          className="w-fit rounded-md border border-border bg-background px-4 py-2 text-sm font-medium"
        >
          {t.home.analysePool}
        </Link>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">
          {t.home.methodHeading}
        </h2>
        <ol className="flex flex-col gap-4 sm:flex-row">
          {t.home.methodSteps.map(({ step, detail }, index) => (
            <li key={step} className="flex-1 rounded-lg border border-border bg-surface p-4">
              <p className="font-mono text-xs text-accent">
                {String(index + 1).padStart(2, "0")}
              </p>
              <p className="mt-2 font-medium">{step}</p>
              <p className="mt-1 text-sm leading-relaxed text-muted">{detail}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="flex flex-col gap-6">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted">
          {t.home.coverageHeading}
        </h2>
        <div className="grid gap-8 sm:grid-cols-2">
          {t.home.coverage.map(({ version, features }) => (
            <div key={version} className="flex flex-col gap-4">
              <h3 className="font-medium">{version}</h3>
              <ul className="flex flex-col gap-4">
                {features.map(({ name, summary }) => (
                  <li key={name} className="border-l-2 border-border pl-4">
                    <p className="text-sm font-medium">{name}</p>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{summary}</p>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>

      <footer className="mt-auto border-t border-border pt-6 text-sm leading-relaxed text-muted">
        <p>{t.home.footer}</p>
      </footer>
    </main>
  );
}
