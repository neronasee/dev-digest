/**
 * PrBriefCard helpers — pure derivations: the severity icon-shape mapping
 * (every enum value covered, distinct shapes), the label-key mappers, and the
 * compactAge buckets (sub-minute, minutes, hours, days, invalid).
 */
import { describe, it, expect } from "vitest";
import type { BriefMissingInput, RiskSeverity } from "@devdigest/shared";
import { SEVERITY_ICON, severityLabelKey, missingLabelKey, compactAge } from "./helpers";

const NOW = Date.parse("2026-10-04T12:00:00.000Z");

describe("PrBriefCard helpers", () => {
  it("maps every severity to a DISTINCT icon shape and its label key", () => {
    const severities: RiskSeverity[] = ["high", "medium", "low"];
    const icons = severities.map((sv) => SEVERITY_ICON[sv]);
    expect(new Set(icons).size).toBe(severities.length); // shape ≠ color alone
    for (const sv of severities) {
      expect(severityLabelKey(sv)).toBe(`severity.${sv}`);
    }
  });

  it("maps every missing-input kind to its brief.missing.* label key", () => {
    const kinds: BriefMissingInput[] = [
      "intent",
      "blast",
      "description",
      "linked_issue",
      "attached_specs",
    ];
    for (const kind of kinds) {
      expect(missingLabelKey(kind)).toBe(`missing.${kind}`);
    }
  });

  it("compactAge buckets to <1m / minutes / hours / days, and '—' when invalid", () => {
    expect(compactAge("2026-10-04T11:59:40.000Z", NOW)).toBe("<1m");
    expect(compactAge("2026-10-04T11:45:00.000Z", NOW)).toBe("15m");
    expect(compactAge("2026-10-04T07:00:00.000Z", NOW)).toBe("5h");
    expect(compactAge("2026-10-01T12:00:00.000Z", NOW)).toBe("3d");
    expect(compactAge("not-a-date", NOW)).toBe("—");
  });
});
