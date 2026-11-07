import type { Metadata } from "next";
import { Overview } from "../../../components/savings/overview.tsx";

export const metadata: Metadata = { title: "Overview" };

export default function OverviewPage() {
  return <Overview />;
}
