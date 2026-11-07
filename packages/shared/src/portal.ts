import type { Provider } from "./fixtures.ts";

/** The one naming scheme for portal logins in the vault, used by the seed script and the Collector's fillSecret. */
export const portalVaultName = (provider: Provider, field: "username" | "password") => `portal/${provider}/${field}`;
