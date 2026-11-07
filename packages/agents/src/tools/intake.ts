import { db as sharedDb, type Db } from "@bill-fighter/db/client";
import { accounts, customers, locations } from "@bill-fighter/db/schema";
import { getPlatform } from "@bill-fighter/platform/factory";
import type { Mail } from "@bill-fighter/platform/types";
import { asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { defineTool } from "../tool-wrapper.ts";

export function createIntakeTools({ db, mail }: { db: Db; mail: () => Promise<Pick<Mail, "parseInbound">> }) {
  return [
    defineTool({
      name: "parse_inbound_email",
      description: "Reads the inbound bill email. Returns its sender and subject, and the account numbers on file that it mentions.",
      inputSchema: z.strictObject({ messageId: z.string(), from: z.string(), to: z.string(), subject: z.string(), text: z.string() }),
      targets: () => [],
      async handler(input) {
        const email = (await mail()).parseInbound(input);
        // Whole tokens, so BE-7001 cannot match inside BE-70012. The body stays here: it is untrusted, and Intake only needs ids.
        const tokens = new Set(`${email.subject} ${email.text}`.split(/[^\w-]+/));
        const onFile = await db.selectDistinct({ number: accounts.accountNumber }).from(accounts);
        return {
          messageId: email.messageId,
          from: email.from,
          subject: email.subject,
          accountNumbers: onFile.map(({ number }) => number).filter((number) => tokens.has(number)).sort(),
        };
      },
    }),
    defineTool({
      name: "get_customer",
      description: "Finds the one customer holding these account numbers, with all their accounts and providers.",
      inputSchema: z.strictObject({ accountNumbers: z.array(z.string().min(1)).min(1) }),
      targets: () => [],
      async handler({ accountNumbers }) {
        const matches = await db
          .selectDistinct({ customerId: locations.customerId })
          .from(accounts)
          .innerJoin(locations, eq(accounts.locationId, locations.id))
          .where(inArray(accounts.accountNumber, accountNumbers));
        if (matches.length !== 1) return { matched: false, reason: `Those account numbers match ${matches.length} customers` };

        const customerId = matches[0]!.customerId;
        const [customer] = await db
          .select({ id: customers.id, name: customers.name, contactName: customers.contactName })
          .from(customers)
          .where(eq(customers.id, customerId));
        const rows = await db
          .select({
            id: accounts.id,
            provider: accounts.provider,
            accountNumber: accounts.accountNumber,
            serviceType: accounts.serviceType,
            location: locations.name,
          })
          .from(accounts)
          .innerJoin(locations, eq(accounts.locationId, locations.id))
          .where(eq(locations.customerId, customerId))
          .orderBy(asc(accounts.id));
        return { matched: true, customer, providers: [...new Set(rows.map((row) => row.provider))].sort(), accounts: rows };
      },
    }),
  ];
}

export default createIntakeTools({ db: sharedDb, mail: () => getPlatform().mail() });
