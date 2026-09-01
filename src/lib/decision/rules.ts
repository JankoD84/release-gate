import type { ReleaseEvidence } from "../releases/types.ts";
import type { DecisionEvidenceItem, RequiredAction } from "./types.ts";

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

  if (evidence.ci.status === "NOT_AVAILABLE") {
    warnings.push({
      category: "CI",
      severity: "WARNING",
      code: "CI_NOT_AVAILABLE",
      message: "CI evidence is not available from the public repository provider.",
    });
  }

  if (evidence.ci.status === "PENDING") {
    warnings.push({
      category: "CI",
      severity: "WARNING",
      code: "CI_PENDING",
      message: "CI checks are still pending for the candidate HEAD SHA.",
    });
  }

  if (evidence.tests.status === "NOT_AVAILABLE") {
    warnings.push({
      category: "TESTS",
      severity: "WARNING",
      code: "TESTS_NOT_AVAILABLE",
      message: "Automated test evidence is not available from the public repository provider.",
    });
  }

  if (evidence.security.status === "NOT_AVAILABLE") {
    warnings.push({
      category: "SECURITY",
      severity: "WARNING",
      code: "SECURITY_NOT_AVAILABLE",
      message: "Security evidence is not available from the public repository provider.",
    });
  }

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

const requiredActionOrder = [
  "FIX_CI",
  "FIX_TESTS",
  "FIX_CRITICAL_SECURITY",
  "FIX_SECURITY",
  "VERIFY_CI_EVIDENCE",
  "WAIT_FOR_CI_COMPLETION",
  "INVESTIGATE_FLAKY_TESTS",
  "VERIFY_TEST_EVIDENCE",
  "REVIEW_CHANGE_SURFACE",
  "REVIEW_CRITICAL_COMPONENT",
  "REVIEW_SECURITY_FINDINGS",
  "VERIFY_SECURITY_EVIDENCE",
] as const;

const blockerActionMap: Record<string, RequiredAction> = {
  CI_FAILED: {
    code: "FIX_CI",
    priority: "BLOCKER",
    category: "CI",
    message: "Resolve failing CI jobs and rerun CI before release promotion.",
  },
  TESTS_FAILED: {
    code: "FIX_TESTS",
    priority: "BLOCKER",
    category: "TESTS",
    message: "Resolve failing automated tests and rerun the suite.",
  },
  SECURITY_CRITICAL_FINDINGS: {
    code: "FIX_CRITICAL_SECURITY",
    priority: "BLOCKER",
    category: "SECURITY",
    message: "Resolve critical security findings before release promotion.",
  },
  SECURITY_HIGH_FINDINGS: {
    code: "FIX_SECURITY",
    priority: "BLOCKER",
    category: "SECURITY",
    message: "Resolve high-severity security findings before release promotion.",
  },
};

const warningActionMap: Record<string, RequiredAction> = {
  CI_NOT_AVAILABLE: {
    code: "VERIFY_CI_EVIDENCE",
    priority: "REQUIRED",
    category: "CI",
    message: "Verify CI evidence outside Release Gate before release promotion.",
  },
  CI_PENDING: {
    code: "WAIT_FOR_CI_COMPLETION",
    priority: "REQUIRED",
    category: "CI",
    message: "Wait for pending CI checks on the candidate HEAD SHA to complete before release promotion.",
  },
  FLAKY_TESTS_PRESENT: {
    code: "INVESTIGATE_FLAKY_TESTS",
    priority: "REQUIRED",
    category: "TESTS",
    message: "Investigate flaky tests and confirm they do not mask a release regression.",
  },
  TESTS_WARNING: {
    code: "INVESTIGATE_FLAKY_TESTS",
    priority: "REQUIRED",
    category: "TESTS",
    message: "Investigate flaky tests and confirm they do not mask a release regression.",
  },
  TESTS_NOT_AVAILABLE: {
    code: "VERIFY_TEST_EVIDENCE",
    priority: "REQUIRED",
    category: "TESTS",
    message: "Verify automated test evidence outside Release Gate before release promotion.",
  },
  CHANGE_RISK_MEDIUM: {
    code: "REVIEW_CHANGE_SURFACE",
    priority: "RECOMMENDED",
    category: "CHANGE_RISK",
    message: "Review the elevated change surface and rollback readiness.",
  },
  CHANGE_RISK_HIGH: {
    code: "REVIEW_CHANGE_SURFACE",
    priority: "REQUIRED",
    category: "CHANGE_RISK",
    message: "Review the high change surface and rollback readiness.",
  },
  CRITICAL_COMPONENTS_CHANGED: {
    code: "REVIEW_CRITICAL_COMPONENT",
    priority: "REQUIRED",
    category: "CHANGE_RISK",
    message: "Review changes to critical components before release promotion.",
  },
  SECURITY_WARNING: {
    code: "REVIEW_SECURITY_FINDINGS",
    priority: "RECOMMENDED",
    category: "SECURITY",
    message: "Review non-blocking security findings and accept residual security risk.",
  },
  SECURITY_MEDIUM_FINDINGS: {
    code: "REVIEW_SECURITY_FINDINGS",
    priority: "RECOMMENDED",
    category: "SECURITY",
    message: "Review medium-severity security findings before release promotion.",
  },
  SECURITY_NOT_AVAILABLE: {
    code: "VERIFY_SECURITY_EVIDENCE",
    priority: "REQUIRED",
    category: "SECURITY",
    message: "Verify security evidence outside Release Gate before release promotion.",
  },
};

function actionRank(action: RequiredAction): number {
  const index = requiredActionOrder.indexOf(action.code as (typeof requiredActionOrder)[number]);

  return index === -1 ? requiredActionOrder.length : index;
}

export function createRequiredActions(
  blockers: readonly DecisionEvidenceItem[],
  warnings: readonly DecisionEvidenceItem[],
): readonly RequiredAction[] {
  const actionsByCode = new Map<string, RequiredAction>();

  for (const item of [...blockers, ...warnings]) {
    const action = item.severity === "BLOCKER" ? blockerActionMap[item.code] : warningActionMap[item.code];
    if (!action || actionsByCode.has(action.code)) {
      continue;
    }

    actionsByCode.set(action.code, action);
  }

  return [...actionsByCode.values()].sort((left, right) => actionRank(left) - actionRank(right) || left.code.localeCompare(right.code));
}

export function createConditions(
  warnings: readonly DecisionEvidenceItem[],
): readonly string[] {
  const conditions: string[] = [];
  const warningCodes = new Set(warnings.map((warning) => warning.code));

  if (warningCodes.has("CI_NOT_AVAILABLE")) {
    conditions.push("Acknowledge that CI evidence was unavailable from the public repository provider.");
  }

  if (warningCodes.has("CI_PENDING")) {
    conditions.push("Wait for pending CI checks on the candidate HEAD SHA to complete before release promotion.");
  }

  if (warningCodes.has("FLAKY_TESTS_PRESENT") || warningCodes.has("TESTS_WARNING") || warningCodes.has("TESTS_NOT_AVAILABLE")) {
    conditions.push("Acknowledge flaky-test risk or unavailable automated-test evidence before release promotion.");
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

  if (warningCodes.has("SECURITY_NOT_AVAILABLE")) {
    conditions.push("Acknowledge that security evidence is unavailable and verify security status before release promotion.");
  } else if (
    warningCodes.has("SECURITY_WARNING") ||
    warningCodes.has("SECURITY_MEDIUM_FINDINGS")
  ) {
    conditions.push("Review non-blocking security findings and accept residual security risk.");
  }

  return conditions;
}
