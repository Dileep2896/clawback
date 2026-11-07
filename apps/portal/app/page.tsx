import { Provider } from "@bill-fighter/shared/fixtures";
import { BRANDS } from "../lib/brands.ts";

export default function Home() {
  return (
    <main>
      <h1 className="px-4 py-6 text-lg sm:px-8">Choose your provider to sign in</h1>
      <ul>
        {Provider.options.map((provider) => {
          const brand = BRANDS[provider];
          return (
            <li key={provider}>
              <a
                href={`/login?brand=${provider}`}
                data-testid={`brand-${provider}`}
                style={{ backgroundColor: brand.color }}
                className="block px-4 py-8 text-white hover:underline sm:px-8 sm:py-10"
              >
                <span className="block text-4xl font-semibold tracking-tight sm:text-6xl">{brand.name}</span>
                <span className="mt-2 block text-lg">{brand.service}</span>
              </a>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
