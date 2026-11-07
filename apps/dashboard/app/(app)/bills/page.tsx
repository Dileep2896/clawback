import type { Metadata } from "next";
import { Bills } from "../../../components/savings/bills.tsx";

export const metadata: Metadata = { title: "Bills" };

export default function BillsPage() {
  return <Bills />;
}
