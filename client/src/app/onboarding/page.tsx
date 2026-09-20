import type { Metadata } from "next";
import { AddRepoView } from "./_components/AddRepoView";

/* Route: /onboarding — thin server page (F15; the screen itself was already a
   separate client component under _components/AddRepoView). */
export const metadata: Metadata = { title: "Add repository" };

export default function AddRepoPage() {
  return <AddRepoView />;
}
