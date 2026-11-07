import { describe, expect, it } from "vitest";
import {
  SCORE_CONFIG,
  readinessLabel,
  scoreFindings,
} from "@/server/review/scoring";

describe("scoring", () => {
  it("starts at 100 and subtracts only open findings", () => {
    expect(scoreFindings([])).toBe(100);
    expect(
      scoreFindings([
        { severity: "error", state: "open" },
        { severity: "warn", state: "open" },
        { severity: "error", state: "dismissed" },
        { severity: "warn", state: "applied" },
      ]),
    ).toBe(100 - SCORE_CONFIG.errorCost - SCORE_CONFIG.warnCost);
  });

  it("never goes below zero", () => {
    const findings = Array.from({ length: 20 }, () => ({
      severity: "error" as const,
      state: "open" as const,
    }));
    expect(scoreFindings(findings)).toBe(0);
  });

  it("labels readiness and keeps the decision with the human", () => {
    expect(readinessLabel(null, false)).toBeNull();
    expect(readinessLabel(100, true)).toBeNull();
    expect(readinessLabel(SCORE_CONFIG.readyThreshold, false)).toContain(
      "Ready to submit",
    );
    expect(readinessLabel(SCORE_CONFIG.readyThreshold - 1, false)).toContain(
      "Nothing is auto-rejected",
    );
  });
});
