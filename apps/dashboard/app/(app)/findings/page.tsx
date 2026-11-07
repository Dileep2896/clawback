import type { Metadata } from "next";
import { FindingsList } from "../../../components/savings/findings.tsx";

export const metadata: Metadata = { title: "Findings" };

export default function FindingsPage() {
  return <FindingsList />;
}
