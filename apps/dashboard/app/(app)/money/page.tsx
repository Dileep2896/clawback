import type { Metadata } from "next";
import { Money } from "../../../components/savings/money.tsx";

export const metadata: Metadata = { title: "Money" };

export default function MoneyPage() {
  return <Money />;
}
