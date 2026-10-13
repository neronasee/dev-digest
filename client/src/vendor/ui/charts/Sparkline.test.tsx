/* Sparkline unit tests — degenerate inputs render nothing; real trends never
   emit NaN geometry (the cx warning seen on single-sweep eval dashboards). */
import { describe, it, expect, afterEach } from "vitest";
import { render, cleanup } from "@testing-library/react";
import { Sparkline } from "./Sparkline";

afterEach(cleanup);

describe("Sparkline", () => {
  it("renders nothing for empty data", () => {
    const { container } = render(<Sparkline data={[]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("renders nothing for a single point (no trend to draw, avoids NaN cx)", () => {
    const { container } = render(<Sparkline data={[0.88]} />);
    expect(container.querySelector("svg")).toBeNull();
  });

  it("draws numeric-only geometry for two points", () => {
    const { container } = render(<Sparkline data={[0.5, 1]} w={80} h={24} />);
    const path = container.querySelector("path");
    const dot = container.querySelector("circle");
    expect(path).not.toBeNull();
    expect(dot).not.toBeNull();
    expect(path!.getAttribute("d")).not.toContain("NaN");
    expect(dot!.getAttribute("cx")).toMatch(/^-?\d+(\.\d+)?$/);
  });

  it("draws a flat line without NaN when all values are equal", () => {
    const { container } = render(<Sparkline data={[1, 1, 1]} />);
    expect(container.querySelector("path")!.getAttribute("d")).not.toContain("NaN");
    expect(container.querySelector("circle")!.getAttribute("cx")).toMatch(/^-?\d+(\.\d+)?$/);
  });
});
