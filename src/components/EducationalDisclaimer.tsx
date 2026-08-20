/**
 * Single source of truth for the product-wide disclaimer.
 *
 * Every surface that renders a recommendation must show this. Keeping the
 * wording in one component prevents individual feature pages from drifting
 * into softer language than the product is allowed to use.
 */
export function EducationalDisclaimer() {
  return (
    <aside
      aria-label="Important disclaimer"
      className="rounded-lg border border-warning-border bg-warning-surface px-4 py-3 text-sm text-warning-foreground"
    >
      <p className="font-medium">Educational tool — not financial advice.</p>
      <p className="mt-1 leading-relaxed">
        This application explains Uniswap mechanics and helps you reason about
        parameter choices. It does not predict prices, does not guarantee
        returns, and cannot verify that any smart contract is safe. Liquidity
        provision carries real risk, including impermanent loss and total loss
        of funds. Always verify contract addresses and do your own research.
      </p>
    </aside>
  );
}
