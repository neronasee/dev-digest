import type { Metadata } from "next";
import { PullsListView } from "./_components/PullsListView";

/* Route: /repos/:repoId/pulls — thin server page (F15). The list view reads
   ?status&sort itself via useSearchParams; the route-level constants/styles
   are shared with PRRow/FilterBar. Title renders as "Pull Requests ·
   DevDigest" via the root layout's title.template. */
export const metadata: Metadata = { title: "Pull Requests" };

export default function PullsPage() {
  return <PullsListView />;
}
