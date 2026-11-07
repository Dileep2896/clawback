import { GAS_SUPPLIER, Provider } from "@bill-fighter/shared/fixtures";

export type Brand = { name: string; service: string; color: string };

// Colours match each provider's own fictional bill templates, so the portal and its PDFs read as one company.
export const BRANDS = {
  baycurrent: { name: "BayCurrent Business", service: "Electric service", color: "#12355b" },
  baytel: { name: "BayTel Business", service: "Phone lines", color: "#0f5c5c" },
  bayconnect: { name: "BayConnect", service: "Business internet", color: "#4a2a8c" },
  [GAS_SUPPLIER.provider]: { name: GAS_SUPPLIER.name, service: "Natural gas supply", color: "#9c3f1d" },
} satisfies Record<Provider, Brand>;

export const brandOf = (value: unknown): Provider | null => Provider.safeParse(value).data ?? null;
