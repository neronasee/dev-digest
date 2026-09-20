import type { Metadata } from "next";
import { HomeView } from "./_components/HomeView";

/* Route: / — thin server page (F15). The first-repo redirect stays a client
   fetch inside the view (TanStack-only data convention; F16 was deliberately
   skipped — see docs/improvement-plan §9). The title is `absolute` because the
   root page shares the root layout's segment — title.template only applies to
   child segments — and the landing tab should carry the brand, not "Home". */
export const metadata: Metadata = { title: { absolute: "DevDigest" } };

export default function HomePage() {
  return <HomeView />;
}
