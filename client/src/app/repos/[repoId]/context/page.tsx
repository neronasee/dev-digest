/* Route: /repos/:repoId/context — the Project Context page (read-only).
   All logic lives in _components/ProjectContextView. */
import { ProjectContextView } from "./_components/ProjectContextView";

export default function ContextPage() {
  return <ProjectContextView />;
}
