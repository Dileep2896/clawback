import { Client } from "pg";
import { describe, expect, it } from "vitest";
import { poolConfig } from "./client.ts";

const CA = "-----BEGIN CERTIFICATE-----\nMIIBtest\n-----END CERTIFICATE-----";
const HOSTED = "postgres://u:p@db.example.com:5432/app?sslmode=no-verify&application_name=clawback&connect_timeout=5";

// What pg itself will use, after it has read the connection string: the config is only right if pg ends up verifying.
const asPg = (config: ReturnType<typeof poolConfig>) => (new Client(config) as unknown as { connectionParameters: unknown }).connectionParameters as { ssl: unknown; application_name: string; host: string };

describe("poolConfig", () => {
  it("leaves a local database exactly as the URL says, with pg's own pool defaults", () => {
    const url = "postgres://bill:bill@localhost:5433/billfighter";
    expect(poolConfig(url, {})).toEqual({ connectionString: url });
  });

  it("verifies a hosted database against PG_CA, whatever sslmode the URL carries", () => {
    for (const sslmode of ["no-verify", "disable", "require", "prefer"]) {
      const config = poolConfig(HOSTED.replace("no-verify", sslmode), { PG_CA: CA });
      expect(config).toHaveProperty("ssl");
      expect((config as { ssl?: unknown }).ssl).toEqual({ ca: CA, rejectUnauthorized: true });
      expect(new URL(config.connectionString).searchParams.has("sslmode")).toBe(false);
      expect(asPg(config).ssl).toEqual({ ca: CA, rejectUnauthorized: true });
    }
  });

  it("keeps every other connection parameter", () => {
    const config = poolConfig(HOSTED, { PG_CA: CA });
    const params = new URL(config.connectionString).searchParams;
    expect(params.get("application_name")).toBe("clawback");
    expect(params.get("connect_timeout")).toBe("5");
    expect(asPg(config)).toMatchObject({ application_name: "clawback", host: "db.example.com" });
  });

  it("caps the pool and lets idle connections go only when PG_POOL_MAX is set", () => {
    expect(poolConfig(HOSTED, { PG_CA: CA, PG_POOL_MAX: "3" })).toMatchObject({ max: 3, idleTimeoutMillis: 2000 });
    expect(poolConfig("postgres://localhost/x", { PG_POOL_MAX: "2" })).toEqual({ connectionString: "postgres://localhost/x", max: 2, idleTimeoutMillis: 2000 });
    expect(poolConfig(HOSTED, { PG_CA: CA })).not.toHaveProperty("max");
  });
});
