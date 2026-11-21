import type { Market } from "../../core/types";
import type { ProductResult } from "../../research/events";
import { ProductCard } from "./ProductCard";

/** One card per product, two to a row on a wide screen. `market` is the market the run was for. */
export function Products({ products, market }: { products: ProductResult[]; market: Market | undefined }) {
  if (products.length === 0) {
    return <p className="text-sm text-muted-foreground">No candidate products were identified for this question.</p>;
  }
  return (
    <section aria-labelledby="products-heading" className="space-y-4">
      <h2 id="products-heading" className="text-xl font-semibold">
        Where to buy
      </h2>
      <p className="text-xs text-muted-foreground" data-testid="last-observed-notice">
        Prices and availability were last observed by Exa and must be confirmed on the merchant&apos;s page.
      </p>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        {products.map((product) => (
          <ProductCard key={product.candidate.name} product={product} market={market} />
        ))}
      </div>
    </section>
  );
}
