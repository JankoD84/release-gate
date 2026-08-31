import type { ReleaseEvidence } from "../releases/types.ts";
import type { DecisionEvidenceItem } from "./types.ts";

const criticalChangedComponents = new Set([
  "authentication",
  "payments",
  "release-orchestration",
]);

export function findHardBlockers(evidence: ReleaseEvidence): readonly DecisionEvidenceItem[] {
  const blockers: DecisionEvidenceItem[] = [];

  if (evidence.ci.status === "FAIL") {
    blockers.push({
      category: "CI",
      severity: "BLOCKER",
      code: "CI_FAILED",
      message: `CI status is FAIL with ${evidence.ci.failedJobs} failed job(s).`,
    });
  }

  if (evidence.tests.status === "FAIL") {
    blockers.push({
      category: "TESTS",
      severity: "BLOCKER",
      code: "TESTS_FAILED",
      message: `Automated test status is FAIL with ${evidence.tests.failed} failed test(s).`,
    });
  }

  if (evidence.security.critical > 0) {
    blockers.push({
      category: "SECURITY",
      severity: "BLOCKER",
      code: "SECURITY_CRITICAL_FINDINGS",
      message: `${evidence.security.critical} critical security finding(s) block release promotion.`,
    });
  }

  if (evidence.security.high > 0) {
    blockers.push({
      category: "SECURITY",
      severity: "BLOCKER",
      code: "SECURITY_HIGH_FINDINGS",
      message: `${evidence.security.high} high-severity security finding(s) block release promotion.`,
    });
  }

  return blockers;
}

export function findMaterialWarnings(
  evidence: ReleaseEvidence,
): readonly DecisionEvidenceItem[] {
  const warnings: DecisionEvidenceItem[] = [];

  if (evidence.tests.flaky > 0) {
    warnings.push({
      category: "TESTS",
      severity: "WARNING",
      code: "FLAKY_TESTS_PRESENT",
      message: `${evidence.tests.flaky} flaky test(s) require risk acknowledgement.`,
    });
  }

  if (evidence.tests.status === "WARNING") {
    warnings.push({
      category: "TESTS",
      severity: "WARNING",
      code: "TESTS_WARNING",
      message: "Automated test status is WARNING.",
    });
  }

  if (evidence.changeRisk.level === "MEDIUM") {
    warnings.push({
      category: "CHANGE_RISK",
      severity: "WARNING",
      code: "CHANGE_RISK_MEDIUM",
      message: "Change risk is MEDIUM and requires release owner acceptance.",
    });
  }

  if (evidence.changeRisk.level === "HIGH") {
    warnings.push({
      category: "CHANGE_RISK",
      severity: "WARNING",
      code: "CHANGE_RISK_HIGH",
      message: "Change risk is HIGH and requires explicit release owner acceptance.",
    });
  }

  if (evidence.security.status === "WARNING") {
    warnings.push({
      category: "SECURITY",
      severity: "WARNING",
      code: "SECURITY_WARNING",
      message: "Security status is WARNING.",
    });
  }

  if (evidence.security.medium > 0) {
    warnings.push({
      category: "SECURITY",
      severity: "WARNING",
      code: "SECURITY_MEDIUM_FINDINGS",
      message: `${evidence.security.medium} medium-severity security finding(s) require review.`,
    });
  }

  const changedCriticalComponents = evidence.changeRisk.changedComponents.filter(
    (component) => criticalChangedComponents.has(component),
  );

  if (changedCriticalComponents.length > 0) {
    warnings.push({
      category: "CHANGE_RISK",
      severity: "WARNING",
      code: "CRITICAL_COMPONENTS_CHANGED",
      message: `Critical changed component(s): ${changedCriticalComponents.join(", ")}.`,
    });
  }

  return warnings;
}

export function createConditions(
  warnings: readonly DecisionEvidenceItem[],
): readonly string[] {
  const conditions: string[] = [];
  const warningCodes = new Set(warnings.map((warning) => warning.code));

  if (warningCodes.has("FLAKY_TESTS_PRESENT") || warningCodes.has("TESTS_WARNING")) {
    conditions.push("Acknowledge flaky-test risk before release promotion.");
  }

  if (warningCodes.has("CRITICAL_COMPONENTS_CHANGED")) {
    conditions.push("Review payment-sensitive or otherwise critical changed components.");
  }

  if (
    warningCodes.has("CHANGE_RISK_MEDIUM") ||
    warningCodes.has("CHANGE_RISK_HIGH")
  ) {
    conditions.push("Acknowledge elevated change surface and release rollback readiness.");
  }

  if (
    warningCodes.has("SECURITY_WARNING") ||
    warningCodes.has("SECURITY_MEDIUM_FINDINGS")
  ) {
    conditions.push("Review non-blocking security findings and accept residual security risk.");
  }

  return conditions;
}
