import type { SkillCase } from "../../src/index.js";
import { fixtureReader } from "../../src/index.js";

// Quality cases run with no tools (skillTask measures the SKILL.md content in isolation —
// see tasks.ts), so the fixture diff under review is inlined into the prompt, standing in
// for the changeset the skill would normally be pointed at.

const fx = fixtureReader(import.meta.url);

export const cases: SkillCase[] = [
  {
    name: "review of a new module flags outward import, direct adapter construction, and route-level DB access",
    kind: "quality",
    prompt: `Review this backend change before we open the PR. It adds a notifications module to the server (a workspace feed of finished reviews). Go through it against our backend architecture rules and report anything that should change.

\`\`\`diff
${fx("notifications-module.diff")}
\`\`\``,
    grounding: ["container.db", "no drizzle imports", "ContainerOverrides"],
    practices: [
      "flags notifications/helpers.ts importing the Notification type from './routes.js' as something to fix — inner module code must not depend on the routes file, so the review moves the schema/type (e.g. into a module-local contracts file) and turns the dependency back inward",
      "flags notifications/service.ts constructing the concrete TiktokenTokenizer adapter directly (`new TiktokenTokenizer()`) outside the composition root — per the rule that adapter instantiation belongs in server/src/platform/container.ts, the service must consume it through the container instead (e.g. the `container.tokenizer` getter)",
      "flags the GET /notifications route handler querying the notifications table directly via app.container.db with drizzle (the eq/desc imports) instead of going through the service or repository",
      "does not flag notifications/repository.ts using drizzle or the db as a problem — a module repository is the sanctioned home for table access, so the review leaves it alone",
    ],
    threshold: 0.75,
    maxTurns: 4,
  },
  {
    name: "placement guidance routes a new vendor webhook call behind a port, adapter, and container getter",
    kind: "quality",
    prompt:
      "We're about to add Slack notifications to the DevDigest backend: when a review run finishes, the server should post a short summary to the workspace's Slack channel through Slack's incoming-webhook HTTP API. Before I write any code — where should each piece of this live? Walk me through the steps for adding it.",
    grounding: ["@devdigest/shared", "platform/container.ts", "ContainerOverrides"],
    practices: [
      "puts the Slack webhook HTTP call behind a port with an adapter under server/src/adapters/ (an SDK/HTTP wrapper), not a direct fetch or SDK call inside a service or route",
      "says the port interface is declared in @devdigest/shared (the vendored server/src/vendor/shared/adapters.ts) because it wraps an external vendor/network boundary",
      "says the adapter is wired in server/src/platform/container.ts as a lazy getter with a ContainerOverrides slot, and services consume it as `container.<port>` rather than importing the adapter file",
      "says a mock for the new port is added in server/src/adapters/mocks.ts so tests cover the flow hermetically",
      "does not recommend calling Slack (or any HTTP/SDK client) directly from the service — external calls are routed through the port",
    ],
    threshold: 0.8,
    maxTurns: 4,
  },
  {
    name: "client frontend placement question is out of scope and redirected to the frontend skills",
    kind: "quality",
    prompt:
      "Quick structural question. We're restructuring the client/ Next.js app and want it as clean as the backend: which ring should client/src/app/notifications/page.tsx live in, and can it import server/src/modules/notifications/repository.ts directly to read its data?",
    grounding: ["frontend-architecture"],
    practices: [
      "states that client/ frontend code is out of scope for these backend rules instead of assigning the page to one of the rings",
      "redirects the client/ structure question to the frontend skills (frontend-architecture or react-best-practices)",
      "says the page reaches the notification data through the HTTP API (the server's routes), never by importing a server module file such as repository.ts",
    ],
    threshold: 0.7,
    maxTurns: 4,
  },
];
