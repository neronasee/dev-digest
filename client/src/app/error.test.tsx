import { describe, it, expect, afterEach, vi } from "vitest";
import React from "react";
import { render, screen, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../messages/en/common.json";
import RouteError from "./error";

afterEach(cleanup);

type RouteErrorProps = { error: Error & { digest?: string }; reset: () => void };

function renderRouteError(props: RouteErrorProps) {
  return render(
    <NextIntlClientProvider locale="en" messages={{ common: messages }}>
      <RouteError {...props} />
    </NextIntlClientProvider>,
  );
}

/** Minimal error-boundary harness — the role Next's router plays in the app:
 * catch a child's render error, render <RouteError>, re-render on reset(). */
class Boundary extends React.Component<
  { children: React.ReactNode },
  { error: unknown | null }
> {
  state = { error: null as unknown | null };
  static getDerivedStateFromError(error: unknown) {
    return { error };
  }
  reset = () => this.setState({ error: null });
  render() {
    if (this.state.error !== null) {
      return <RouteError error={this.state.error as RouteErrorProps["error"]} reset={this.reset} />;
    }
    return this.props.children;
  }
}

describe("RouteError (app/error.tsx)", () => {
  it("shows the fallback when a child throws and re-renders it after reset", async () => {
    const user = userEvent.setup();
    let shouldThrow = true;
    function Flaky() {
      if (shouldThrow) throw new Error("boom");
      return <div>content ok</div>;
    }
    render(
      <NextIntlClientProvider locale="en" messages={{ common: messages }}>
        <Boundary>
          <Flaky />
        </Boundary>
      </NextIntlClientProvider>,
    );

    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    expect(screen.queryByText("content ok")).not.toBeInTheDocument();

    shouldThrow = false;
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByText("content ok")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("wires Try-again (Retry) to reset()", async () => {
    const user = userEvent.setup();
    const reset = vi.fn();
    renderRouteError({ error: new Error("boom"), reset });
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(reset).toHaveBeenCalledOnce();
  });

  it("shows the digest reference when the error carries one", () => {
    renderRouteError({
      error: Object.assign(new Error("boom"), { digest: "abc123" }),
      reset: () => {},
    });
    expect(screen.getByText(/abc123/)).toBeInTheDocument();
  });

  it("does not throw on an unexpected error shape", () => {
    renderRouteError({ error: { weird: true } as unknown as RouteErrorProps["error"], reset: () => {} });
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/Error reference/)).not.toBeInTheDocument();
  });
});
