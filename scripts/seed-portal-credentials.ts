import { randomBytes } from "node:crypto";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { getPlatform } from "@bill-fighter/platform/factory";
import type { Vault } from "@bill-fighter/platform/types";
import { CUSTOMER } from "@bill-fighter/db/seed/customer";
import { Provider } from "@bill-fighter/shared/fixtures";
import { portalVaultName } from "@bill-fighter/shared/portal";
import { hashLogin, type PortalCredentials } from "../apps/portal/lib/credentials.ts";

const CREDENTIALS_PATH = fileURLToPath(new URL("../data/seed/portal-credentials.json", import.meta.url));

/** The Collector's copy goes to the vault and the portal's hash goes to the file. Re-running rotates both. */
export async function seedPortalCredentials(vault: Vault, path: string = CREDENTIALS_PATH) {
  const logins = {} as PortalCredentials["logins"];
  for (const provider of Provider.options) {
    const username = `${CUSTOMER.id}-${provider}`;
    const password = randomBytes(18).toString("base64url");
    await vault.put(portalVaultName(provider, "username"), username);
    await vault.put(portalVaultName(provider, "password"), password);
    logins[provider] = await hashLogin(username, password);
  }
  const credentials: PortalCredentials = { sessionSecret: randomBytes(32).toString("base64url"), logins };
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(credentials, null, 2)}\n`, { mode: 0o600 });
  await rename(temp, path);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await seedPortalCredentials(await getPlatform().vault());
  console.info(`Stored ${Provider.options.length} portal logins in the vault and their hashes in data/seed/`);
}
