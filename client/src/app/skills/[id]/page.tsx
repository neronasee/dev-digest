import type { Metadata } from "next";
import { SkillDetailView } from "./_components/SkillDetailView";

/* Route: /skills/:id — thin server page. The detail view (header + the three
   Config/Preview/Versioning tabs, ?tab state) lives in
   _components/SkillDetailView. */
export const metadata: Metadata = { title: "Skill Editor" };

export default function SkillDetailPage() {
  return <SkillDetailView />;
}
