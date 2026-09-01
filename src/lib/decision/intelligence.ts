import type { ReleaseEvidence, RiskFingerprint } from "../releases/types.ts";
import type { DecisionAnalysis, DecisionEvidenceCategory, ReleaseDecision, RequiredAction } from "./types.ts";

export const evidenceSurfaces = ["CI", "TESTS", "SECURITY", "CHANGE_RISK"] as const satisfies readonly DecisionEvidenceCategory[];

export type EvidenceCompleteness = {
  verifiedSurfaces: number;
  totalSurfaces: 4;
  percentage: number;
  missingSurfaces: readonly DecisionEvidenceCategory[];
};

export type FreshnessState = "CURRENT" | "STALE" | "UNKNOWN";

export type EvidenceFreshness = Record<DecisionEvidenceCategory, {
  state: FreshnessState;
  observedAt?: string;
  thresholdDays: number;
}>;

export type DecisionPath = {
  currentDecision: ReleaseDecision;
  targetDecision: ReleaseDecision;
  currentlyPreventedBy: readonly string[];
  nextBestActions: readonly RequiredAction["code"][];
  note: string;
};

const freshnessCurrentThresholdDays = 7;
const freshnessCurrentThresholdMs = freshnessCurrentThresholdDays * 24 * 60 * 60 * 1000;
const unavailableChangeRiskMessages = new Set([
  "github public change evidence is unavailable for this release candidate.",
  "gitlab public change evidence is unavailable for this release candidate.",
]);

function isObserved(status: string): boolean {
  return status !== "NOT_AVAILABLE";
}

function isChangeRiskVerified(evidence: ReleaseEvidence["changeRisk"]): boolean {
  return !evidence.reasons.some((reason) => unavailableChangeRiskMessages.has(reason.toLowerCase()));
}

function calculatePercentage(verifiedSurfaces: number, totalSurfaces: number): number {
  return Math.round((verifiedSurfaces / totalSurfaces) * 100);
}

export function createEvidenceCompleteness(evidence: ReleaseEvidence): EvidenceCompleteness {
  const missingSurfaces: DecisionEvidenceCategory[] = [];

  if (!isObserved(evidence.ci.status)) missingSurfaces.push("CI");
  if (!isObserved(evidence.tests.status)) missingSurfaces.push("TESTS");
  if (!isObserved(evidence.security.status)) missingSurfaces.push("SECURITY");
  if (!isChangeRiskVerified(evidence.changeRisk)) missingSurfaces.push("CHANGE_RISK");

  const totalSurfaces = evidenceSurfaces.length as 4;
  const verifiedSurfaces = totalSurfaces - missingSurfaces.length;

  return {
    verifiedSurfaces,
    totalSurfaces,
    percentage: calculatePercentage(verifiedSurfaces, totalSurfaces),
    missingSurfaces,
  };
}

function freshnessFor(observedAt: string | undefined, evaluatedAt: string): EvidenceFreshness[DecisionEvidenceCategory] {
  if (!observedAt) return { state: "UNKNOWN", thresholdDays: freshnessCurrentThresholdDays };

  const observedMs = Date.parse(observedAt);
  const evaluatedMs = Date.parse(evaluatedAt);

  if (Number.isNaN(observedMs) || Number.isNaN(evaluatedMs) || observedMs > evaluatedMs) {
    return { state: "UNKNOWN", observedAt, thresholdDays: freshnessCurrentThresholdDays };
  }

  return {
    state: evaluatedMs - observedMs <= freshnessCurrentThresholdMs ? "CURRENT" : "STALE",
    observedAt,
    thresholdDays: freshnessCurrentThresholdDays,
  };
}

export function createEvidenceFreshness(evidence: ReleaseEvidence, evaluatedAt: string): EvidenceFreshness {
  return {
    CI: freshnessFor(evidence.ci.provenance?.observedAt, evaluatedAt),
    TESTS: freshnessFor(evidence.tests.provenance?.observedAt, evaluatedAt),
    SECURITY: freshnessFor(evidence.security.provenance?.observedAt, evaluatedAt),
    CHANGE_RISK: freshnessFor(evidence.changeRisk.provenance?.observedAt, evaluatedAt),
  };
}

export function createRiskFingerprint(evidence: ReleaseEvidence["changeRisk"]): RiskFingerprint {
  const fingerprint = evidence.fingerprint ?? {
    riskReasons: evidence.riskReasons ?? [],
    changedAreas: evidence.changedAreas ?? evidence.changedComponents,
    criticalComponents: evidence.criticalComponents ?? [],
  };

  return {
    riskReasons: [...fingerprint.riskReasons],
    changedAreas: [...fingerprint.changedAreas],
    criticalComponents: [...fingerprint.criticalComponents],
  };
}

function preventedByForCode(code: string): string {
  if (code === "CI_FAILED") return "CI has failing jobs.";
  if (code === "TESTS_FAILED") return "Automated tests are failing.";
  if (code === "SECURITY_CRITICAL_FINDINGS") return "Critical security findings block release promotion.";
  if (code === "SECURITY_HIGH_FINDINGS") return "High-severity security findings block release promotion.";
  if (code === "CI_NOT_AVAILABLE") return "CI evidence is unavailable.";
  if (code === "CI_PENDING") return "CI checks are still pending for the candidate HEAD SHA.";
  if (code === "TESTS_NOT_AVAILABLE") return "Automated test evidence is unavailable.";
  if (code === "SECURITY_NOT_AVAILABLE") return "Security evidence is unavailable.";
  if (code === "FLAKY_TESTS_PRESENT") return "Flaky tests require investigation and risk acknowledgement.";
  if (code === "TESTS_WARNING") return "Automated test warning status requires investigation.";
  if (code === "CHANGE_RISK_MEDIUM") return "Medium change surface requires release owner acceptance.";
  if (code === "CHANGE_RISK_HIGH") return "High change surface requires explicit release owner acceptance.";
  if (code === "CRITICAL_COMPONENTS_CHANGED") return "Critical changed components require review.";
  if (code === "SECURITY_WARNING") return "Non-blocking security findings require review.";
  if (code === "SECURITY_MEDIUM_FINDINGS") return "Medium-severity security findings require review.";
  return code.replaceAll("_", " ").toLowerCase();
}

function unique<T>(items: readonly T[]): readonly T[] {
  return [...new Set(items)];
}

export function createDecisionPath(analysis: Pick<DecisionAnalysis, "decision" | "blockingEvidence" | "warnings" | "requiredActions">): DecisionPath {
  return {
    currentDecision: analysis.decision,
    targetDecision: "GO",
    currentlyPreventedBy: unique([...analysis.blockingEvidence, ...analysis.warnings].map((item) => preventedByForCode(item.code))),
    nextBestActions: analysis.requiredActions.map((action) => action.code),
    note: analysis.decision === "GO"
      ? "No stronger recommendation is available because GO is already the strongest deterministic recommendation. Continue to preserve verified evidence before human authorization."
      : "Actions required before a stronger recommendation can be considered. Completing these actions does not guarantee GO because new or changed evidence may alter the recommendation.",
  };
}
