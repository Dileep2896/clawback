import { isSandbox } from "@bill-fighter/shared/sandbox";
import { SignUpForm } from "./signup-form.tsx";

// Read on the server, so the sandbox flag never has to be a public build variable.
export const dynamic = "force-dynamic";

export default function SignUpPage() {
  return <SignUpForm sandbox={isSandbox()} />;
}
