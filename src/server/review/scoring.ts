import {
  READY_THRESHOLD,
  SCORE_ERROR_COST,
  SCORE_WARN_COST,
} from "@/lib/config";
import type { Finding } from "./types";

export const SCORE_CONFIG = {
  errorCost: SCORE_ERROR_COST,
  warnCost: SCORE_WARN_COST,
  readyThreshold: READY_THRESHOLD,
} as const;

export function scoreFindings(
  findings: Pick<Finding, "severity" | "state">[],
): number {
  const open = findings.filter((f) => f.state === "open");
  const errors = open.filter((f) => f.severity === "error").length;
  const warns = open.filter((f) => f.severity === "warn").length;
  return Math.max(0, 100 - SCORE_CONFIG.errorCost * errors - SCORE_CONFIG.warnCost * warns);
}

export function readinessLabel(score: number | null, deepPending: boolean) {
  if (deepPending || score === null) return null;
  if (score >= SCORE_CONFIG.readyThreshold) return "Ready to submit";
  return "Needs revision. Fix the flags or explain dismissals. Nothing is auto-rejected.";
}
