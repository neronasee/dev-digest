import type { Metadata } from "next";
import { PrDetailView } from "./_components/PrDetailView";

/* Route: /repos/:repoId/pulls/:number — thin server page (F3 view + F15
   shell). The view reads params/searchParams (?tab&trace) itself. The PR
   number is route-keyed, so the title needs no fetch: "PR #12 · DevDigest"
   via the root layout's title.template. */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ repoId: string; number: string }>;
}): Promise<Metadata> {
  const { number } = await params;
  return { title: `PR #${number}` };
}

export default function PRDetailPage() {
  return <PrDetailView />;
}
