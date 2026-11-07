import { STORES } from "@bill-fighter/db/seed/customer";

const FREMONT = STORES.find((store) => store.id === "fremont-1")!;

// Intake matches the customer by account number, so the email must print one on file.
export const BILL_ACCOUNT_NUMBER = `BE-${FREMONT.accountSuffix}`;

/** The one bill email, with no messageId: Mail.send assigns one when it is sent. */
export const billEmail = (to: string) => ({
  from: "BayCurrent Electric <billing@baycurrent.example>",
  to,
  subject: `Your BayCurrent Electric bill is ready, account ${BILL_ACCOUNT_NUMBER}`,
  text: `Your latest BayCurrent Electric bill for ${FREMONT.name} is ready.\n\nAccount number: ${BILL_ACCOUNT_NUMBER}\nService address: ${FREMONT.address}\n\nSign in to the customer portal to view and download it.`,
});
