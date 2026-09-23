import type { AgentSummary } from "@devdigest/shared";

/** Case-insensitive filter over an agent's name + description. */
export function filterAgents(agents: AgentSummary[], search: string): AgentSummary[] {
  const q = search.trim().toLowerCase();
  if (!q) return agents;
  return agents.filter((a) => `${a.name} ${a.description}`.toLowerCase().includes(q));
}
