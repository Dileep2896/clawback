import { redirect } from "next/navigation";
import { BRANDS, brandOf } from "../../lib/brands.ts";
import { loginError } from "../../lib/login-errors.ts";
import { BrandBand } from "../brand-band.tsx";
import { login } from "./actions.ts";

const FIELD = "mt-1 block w-full border border-rule bg-white px-3 py-2";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { brand: requested, error } = await searchParams;
  const provider = brandOf(requested);
  if (!provider) redirect("/");
  const brand = BRANDS[provider];
  const message = loginError(error);

  return (
    <>
      <BrandBand brand={brand} />
      <main className="mx-auto max-w-md px-4 py-10">
        <h1 className="text-2xl font-semibold">Sign in to your account</h1>
        {message && (
          <p role="alert" data-testid="login-error" className="mt-4 border-l-4 border-red-700 bg-white px-3 py-2">
            {message}
          </p>
        )}
        <form action={login} className="mt-6 space-y-4">
          <input type="hidden" name="brand" value={provider} />
          <label className="block">
            Username
            <input id="username" name="username" autoComplete="username" required className={FIELD} />
          </label>
          <label className="block">
            Password
            <input id="password" name="password" type="password" autoComplete="current-password" required className={FIELD} />
          </label>
          <button
            type="submit"
            data-testid="login-submit"
            style={{ backgroundColor: brand.color }}
            className="px-5 py-2 font-semibold text-white"
          >
            Sign in
          </button>
        </form>
        <p className="mt-8">
          <a href="/" className="underline">
            Choose another provider
          </a>
        </p>
      </main>
    </>
  );
}
