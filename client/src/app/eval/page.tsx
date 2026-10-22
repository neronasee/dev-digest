import type { Metadata } from "next";
import { EvalDashboardView } from "./_components/EvalDashboardView";

/* Route: /eval — the Eval Dashboard (L06). Thin server page; the view (per-agent
   owner cards, metric trend, recent runs, degradation banner) lives in
   _components/EvalDashboardView. */
export const metadata: Metadata = { title: "Eval Dashboard" };

export default function EvalDashboardPage() {
  return <EvalDashboardView />;
}
