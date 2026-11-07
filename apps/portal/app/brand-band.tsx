import type { Brand } from "../lib/brands.ts";

export function BrandBand({ brand }: { brand: Brand }) {
  return (
    <header style={{ backgroundColor: brand.color }} className="px-4 py-6 text-white sm:px-8">
      <p data-testid="brand-name" className="text-3xl font-semibold tracking-tight sm:text-4xl">
        {brand.name}
      </p>
      <p className="mt-1">{brand.service}</p>
    </header>
  );
}
