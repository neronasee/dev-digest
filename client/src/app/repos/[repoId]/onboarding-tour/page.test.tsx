/**
 * OnboardingTourPage — the /repos/:repoId/onboarding-tour route through the
 * REAL data hooks and repo context, with fetch stubbed per the house rule:
 * every URL the mounted tree fetches is served (/repos for the repo context,
 * /repos/:id/onboarding for the page, plus the generate POST when a test
 * triggers it). Covers the read-surface acceptance criteria:
 * five sections from a persisted tour with zero model calls (AC-9), empty
 * state + working Generate (AC-10), TOC jump (AC-11) and scroll-spy highlight
 * (AC-12), collapse (AC-13), double-activation guard on Regenerate (AC-17),
 * Share link (AC-18), script-text-as-data (AC-21), diagram fallback (AC-20),
 * and the load error state.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { render, screen, cleanup, within, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { OnboardingTourResponse, Repo } from "@devdigest/shared";
import { RepoProvider } from "@/lib/repo-context";
import { ToastProvider } from "@/lib/toast";
import messages from "../../../../../messages/en/onboarding.json";
import OnboardingTourPage from "./page";

vi.mock("next/navigation", () => ({
  useParams: () => ({ repoId: "r1" }),
  usePathname: () => "/repos/r1/onboarding-tour",
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

vi.mock("@/components/app-shell", () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

// ---- fixtures -------------------------------------------------------------

const REPOS: Repo[] = [
  {
    id: "r1",
    workspace_id: "ws1",
    owner: "acme",
    name: "payments-api",
    full_name: "acme/payments-api",
    default_branch: "main",
    clone_path: "/srv/clones/acme-payments-api",
    last_polled_at: "2026-10-01T00:00:00Z",
    created_by: null,
  },
];

/** Mirrors the seeded DEMO_TOUR for acme/payments-api (Task 4). */
const TOUR: OnboardingTourResponse = {
  repo_id: "r1",
  generated_at: new Date(Date.now() - 3 * 3_600_000).toISOString(),
  facts: { indexed_files: 9, index_status: "full", cloned: true },
  tour: {
    architecture: {
      overview:
        "The service is a classic three-layer API: `src/api` handlers call domain services, which own all persistence. Cross-cutting middleware wraps every route.",
      diagram: null,
    },
    critical_paths: [
      { path: "src/api/users.ts", description: "User route handlers — the API surface newcomers touch first." },
      { path: "src/middleware/ratelimit.ts", description: "Rate-limit middleware applied to every route." },
      { path: "src/config.ts", description: "Environment and feature configuration." },
      { path: "src/payments/refund.ts", description: "Refund domain logic — the money path." },
    ],
    run_locally: [
      { title: "Install", description: "Install dependencies.", command: "npm install" },
      { title: "Start dependencies", description: "Bring up Postgres and Redis.", command: "docker compose up -d" },
      { title: "Run", description: "Start the dev server.", command: "npm run dev" },
    ],
    reading_path: [
      { path: "specs/api-layering.md", purpose: "The layering rules the API follows.", why: "Explains where new handlers go." },
      { path: "docs/architecture.md", purpose: "System overview.", why: "The long-form version of this tour's first section." },
      { path: "insights/postmortems.md", purpose: "Past incidents.", why: "What breaks when the money path is rushed." },
    ],
    first_tasks: [
      { title: "Add pagination to the users list", description: "Small, well-scoped handler change.", artifact_kind: "pr", artifact_ref: "482" },
      { title: "Document the refund retry policy", description: "Docs-only change with reviewer notes.", artifact_kind: "pr", artifact_ref: "483" },
      { title: "Tighten rate-limit config validation", description: "Config schema cleanup.", artifact_kind: "pr", artifact_ref: "484" },
    ],
    generation: { model: "seed", cost_usd: null, sampled_files: 12, sampled_artifacts: 4, dropped_ungrounded: 0 },
  },
};

const EMPTY: OnboardingTourResponse = {
  repo_id: "r1",
  tour: null,
  generated_at: null,
  facts: { indexed_files: 9, index_status: "full", cloned: true },
};

// ---- harness --------------------------------------------------------------

const res = (body: unknown, status = 200) =>
  ({ ok: status < 400, status, json: async () => body }) as Response;

interface StubOptions {
  tour?: unknown;
  status?: number;
  /** A controllable promise keeps a generate POST pending (AC-17). */
  generate?: Promise<Response>;
}

function stubFetch(opts: StubOptions = {}) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String(input);
    if (url.endsWith("/repos/r1/onboarding/generate") && init?.method === "POST") {
      // The generate response defaults to a populated tour even when the GET
      // fixture is the empty one (AC-10's generate must succeed).
      return opts.generate ?? res(TOUR);
    }
    if (url.endsWith("/repos/r1/onboarding")) return res(opts.tour ?? TOUR, opts.status);
    if (url.endsWith("/repos")) return res(REPOS);
    throw new Error(`[test] unexpected fetch ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

const postCalls = (fetchMock: ReturnType<typeof stubFetch>) =>
  fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");

/** Drivable IntersectionObserver: the test fires entries at section ids. */
class MockIntersectionObserver {
  static instances: MockIntersectionObserver[] = [];
  callback: IntersectionObserverCallback;
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
  constructor(cb: IntersectionObserverCallback) {
    this.callback = cb;
    MockIntersectionObserver.instances.push(this);
  }
  fire(ids: string[]) {
    // The spy reads only `isIntersecting` + `target`; fabricate the rest away.
    const entries = ids.map((id) => ({ target: document.getElementById(id), isIntersecting: true }));
    this.callback(entries as unknown as IntersectionObserverEntry[], this as unknown as IntersectionObserver);
  }
}

const scrollTargets: Element[] = [];

function renderPage() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={qc}>
      <NextIntlClientProvider locale="en" messages={{ onboarding: messages }}>
        <ToastProvider>
          <RepoProvider>
            <OnboardingTourPage />
          </RepoProvider>
        </ToastProvider>
      </NextIntlClientProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  MockIntersectionObserver.instances = [];
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
  scrollTargets.length = 0;
  Element.prototype.scrollIntoView = function recordScroll(this: Element) {
    scrollTargets.push(this);
  };
});
afterEach(cleanup);

/**
 * Wait for the SETTLED state: path rows render as <span> until the repo
 * context's own query resolves, then re-render as provider links — awaiting a
 * link (not raw text) sidesteps the transient swap.
 */
async function awaitTourLoaded() {
  expect(await screen.findByRole("link", { name: "specs/api-layering.md" })).toBeInTheDocument();
}

// ---- tests ----------------------------------------------------------------

describe("OnboardingTourPage", () => {
  it("renders all five sections from the persisted tour with zero model calls (AC-9)", async () => {
    const fetchMock = stubFetch();
    renderPage();

    await awaitTourLoaded();
    // Each title exists twice on purpose (card heading + TOC entry) — assert
    // the headings, the section structure a reader scans.
    for (const title of [
      "Architecture overview",
      "Critical paths",
      "How to run locally",
      "Guided reading path",
      "First tasks",
    ]) {
      expect(screen.getByRole("heading", { name: title })).toBeInTheDocument();
    }

    // Seeded content the e2e flow asserts on, too.
    expect(screen.getByText("npm install")).toBeInTheDocument();
    expect(screen.getByText("docker compose up -d")).toBeInTheDocument();

    // Mechanical header facts: index count + generation age, model chip.
    expect(screen.getByText(/generated from index of 9 files · generated /)).toBeInTheDocument();
    expect(screen.getByText(/seed · —/)).toBeInTheDocument();

    // Reading the page costs nothing: no POST ever fired.
    expect(postCalls(fetchMock)).toHaveLength(0);
  });

  it("shows the preconditions empty state and generates from it (AC-10)", async () => {
    const fetchMock = stubFetch({ tour: EMPTY });
    renderPage();

    expect(await screen.findByText("No onboarding tour yet")).toBeInTheDocument();
    expect(screen.getByText(/imported with a local clone and an index/)).toBeInTheDocument();
    // Never placeholder section content.
    expect(screen.queryByText("Architecture overview")).toBeNull();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Generate onboarding tour" }));
    await waitFor(() => expect(postCalls(fetchMock)).toHaveLength(1));
    // The generate response seeds the read cache → the tour appears.
    expect(await screen.findByRole("heading", { name: "Architecture overview" })).toBeInTheDocument();
  });

  it("double-activating Regenerate while pending fires exactly one POST, and completion replaces the sections (AC-17)", async () => {
    let resolveGenerate!: (r: Response) => void;
    const pending = new Promise<Response>((r) => {
      resolveGenerate = r;
    });
    const fetchMock = stubFetch({ generate: pending });
    renderPage();
    await awaitTourLoaded();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Regenerate" }));
    // The in-flight state swaps the label and disables further activation.
    const busy = await screen.findByRole("button", { name: "Generating…" });
    expect(busy).toBeDisabled();
    await user.click(busy);
    expect(postCalls(fetchMock)).toHaveLength(1);

    await act(async () => {
      resolveGenerate(
        res({
          ...TOUR,
          tour: {
            ...TOUR.tour!,
            architecture: { overview: "REGENERATED: the money path now runs through the outbox.", diagram: null },
          },
        }),
      );
    });
    expect(await screen.findByText(/REGENERATED: the money path/)).toBeInTheDocument();
  });

  it("renders script text in tour prose as visible text, never as elements (AC-21)", async () => {
    stubFetch({
      tour: {
        ...TOUR,
        tour: {
          ...TOUR.tour!,
          architecture: {
            overview:
              "Layers the API. <script>alert(1)</script> Middleware wraps every route.",
            diagram: null,
          },
        },
      },
    });
    renderPage();
    await awaitTourLoaded();

    expect(
      await screen.findByText("Layers the API. <script>alert(1)</script> Middleware wraps every route."),
    ).toBeInTheDocument();
    expect(document.querySelector("script")).toBeNull();
  });

  it("keeps the prose standing when the diagram source is unrenderable (AC-20)", async () => {
    stubFetch({
      tour: {
        ...TOUR,
        tour: {
          ...TOUR.tour!,
          architecture: {
            overview: "Prose stands alone when the diagram cannot render.",
            diagram: "definitely ~~ not ((( a mermaid diagram",
          },
        },
      },
    });
    renderPage();
    await awaitTourLoaded();

    expect(await screen.findByText("Prose stands alone when the diagram cannot render.")).toBeInTheDocument();
    // The page stays functional: TOC and collapse still work.
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Collapse Architecture overview" }));
    expect(screen.queryByText("Prose stands alone when the diagram cannot render.")).toBeNull();
  });

  it("copies this page's URL to the clipboard with an announced confirmation (AC-18)", async () => {
    // userEvent.setup() installs ITS OWN navigator.clipboard stub — create the
    // user FIRST, then install ours, or the component's writeText bypasses it.
    const user = userEvent.setup();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    stubFetch();
    renderPage();
    await awaitTourLoaded();

    await user.click(screen.getByRole("button", { name: "Share link" }));

    expect(writeText).toHaveBeenCalledWith(window.location.href);
    expect(await screen.findByText("Link copied")).toBeInTheDocument();
  });

  it("scrolls to a section when its TOC entry is activated (AC-11)", async () => {
    stubFetch();
    renderPage();
    await awaitTourLoaded();

    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Guided reading path" }));

    expect(scrollTargets).toHaveLength(1);
    expect(scrollTargets[0]).toBe(document.getElementById("reading-path"));
  });

  it("highlights the TOC entry in view and advances the read-progress chip (AC-12/AC-16)", async () => {
    stubFetch();
    renderPage();
    await awaitTourLoaded();

    const io = MockIntersectionObserver.instances.at(-1)!;
    expect(io.observe).toHaveBeenCalledTimes(5);
    expect(screen.getByText("0 of 5 read")).toBeInTheDocument();

    act(() => io.fire(["architecture"]));
    expect(screen.getByRole("button", { name: "Architecture overview" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByText("1 of 5 read")).toBeInTheDocument();

    act(() => io.fire(["critical-paths"]));
    expect(screen.getByRole("button", { name: "Critical paths" })).toHaveAttribute("aria-current", "true");
    expect(screen.getByRole("button", { name: "Architecture overview" }).getAttribute("aria-current")).toBeNull();
    expect(screen.getByText("2 of 5 read")).toBeInTheDocument();
  });

  it("collapses a section card, hiding its body, and restores it (AC-13)", async () => {
    stubFetch();
    renderPage();
    expect(await screen.findByRole("link", { name: "src/api/users.ts" })).toBeInTheDocument();

    const card = document.getElementById("critical-paths")!;
    const user = userEvent.setup();
    await user.click(within(card).getByRole("button", { name: "Collapse Critical paths" }));

    expect(within(card).queryByText("src/api/users.ts")).toBeNull();
    const expand = within(card).getByRole("button", { name: "Expand Critical paths" });
    expect(expand).toHaveAttribute("aria-expanded", "false");

    await user.click(expand);
    expect(within(card).getByText("src/api/users.ts")).toBeInTheDocument();
  });

  it("surfaces a load error with a retry (read path)", async () => {
    stubFetch({ status: 500 });
    renderPage();

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Couldn’t load the onboarding tour");
    expect(screen.queryByText("Architecture overview")).toBeNull();
  });
});
