import { describe, it, expect, afterEach, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";
import GlobalError from "./global-error";

afterEach(cleanup);

type GlobalErrorProps = { error: Error & { digest?: string }; reset: () => void };

describe("GlobalError (app/global-error.tsx)", () => {
  it("renders the self-contained fallback with Try-again wired to reset()", () => {
    const reset = vi.fn();
    // Deliberately NO next-intl provider: global-error replaces the root
    // layout, so the fallback must not depend on any provider.
    render(<GlobalError error={new Error("layout boom")} reset={reset} />);
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("shows the digest reference when present", () => {
    render(
      <GlobalError
        error={Object.assign(new Error("layout boom"), { digest: "def456" })}
        reset={() => {}}
      />,
    );
    expect(screen.getByText(/def456/)).toBeInTheDocument();
  });

  it("does not throw on an unexpected error shape", () => {
    render(<GlobalError error={{ nope: 1 } as unknown as GlobalErrorProps["error"]} reset={() => {}} />);
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
    expect(screen.queryByText(/Error reference/)).not.toBeInTheDocument();
  });
});
