import type { Metadata } from "next";
import { AgentEditorView } from "./_components/AgentEditorView";

/* Route: /agents/:id — thin server page (F15). The editor view (left agent
   list + config editor, ?tab state) lives in _components/AgentEditorView. */
export const metadata: Metadata = { title: "Agent Editor" };

export default function AgentEditorPage() {
  return <AgentEditorView />;
}
