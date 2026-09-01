import {
  getChangeRiskEvidenceByReleaseId,
  getCiEvidenceByReleaseId,
  getSecurityEvidenceByReleaseId,
  getTestEvidenceByReleaseId,
} from "../releases/fixtures.ts";
import type { ReleaseEvidence, ReleaseRecord } from "../releases/types.ts";
import { createDecisionPath, createEvidenceCompleteness, createEvidenceFreshness, createRiskFingerprint } from "./intelligence.ts";
import { createConditions, createRequiredActions, findHardBlockers, findMaterialWarnings } from "./rules.ts";
import type {
  DecisionAnalysis,
  DecisionAnalysisResult,
  DecisionEvaluationOptions,
  ReleaseDecision,
  ReleaseEvidenceLookup,
} from "./types.ts";

function createSummary(decision: ReleaseDecision): string {
  if (decision === "NO_GO") {
    return "NO_GO: explicit hard blocker evidence prevents release promotion.";
  }

  if (decision === "CONDITIONAL_GO") {
    return "CONDITIONAL_GO: no hard blockers were found, but material warnings require human risk acceptance.";
  }

  return "GO: all release gates are clean and no material warning requires human risk acceptance.";
}

export function evaluateReleaseEvidence(
  releaseId: string,
  evidence: ReleaseEvidence,
  options: DecisionEvaluationOptions = {},
): DecisionAnalysis {
  const blockingEvidence = findHardBlockers(evidence);
  const warnings = findMaterialWarnings(evidence);
  const decision: ReleaseDecision =
    blockingEvidence.length > 0
      ? "NO_GO"
      : warnings.length > 0
        ? "CONDITIONAL_GO"
        : "GO";
  const visibleWarnings = decision === "NO_GO" ? [] : warnings;
  const evaluatedAt = options.evaluatedAt ?? new Date().toISOString();
  const requiredActions = createRequiredActions(blockingEvidence, visibleWarnings);
  const analysisCore = {
    decision,
    blockingEvidence,
    warnings: visibleWarnings,
    requiredActions,
  };

  return {
    releaseId,
    decision,
    confidence: decision === "CONDITIONAL_GO" ? "MEDIUM" : "HIGH",
    blockingEvidence,
    warnings: visibleWarnings,
    conditions: decision === "CONDITIONAL_GO" ? createConditions(warnings) : [],
    requiredActions,
    evidenceCompleteness: createEvidenceCompleteness(evidence),
    evidenceFreshness: createEvidenceFreshness(evidence, evaluatedAt),
    riskFingerprint: createRiskFingerprint(evidence.changeRisk),
    decisionPath: createDecisionPath(analysisCore),
    summary: createSummary(decision),
    evaluatedAt,
  };
}

export function analyzeReleaseRecord(
  record: ReleaseRecord,
  options: DecisionEvaluationOptions = {},
): { ok: true; data: DecisionAnalysis } {
  return {
    ok: true,
    data: evaluateReleaseEvidence(record.id, record.evidence, options),
  };
}

export function analyzeRelease(
  releaseId: string,
  options: DecisionEvaluationOptions = {},
): DecisionAnalysisResult {
  const lookup: ReleaseEvidenceLookup = {
    ci: getCiEvidenceByReleaseId(releaseId),
    tests: getTestEvidenceByReleaseId(releaseId),
    security: getSecurityEvidenceByReleaseId(releaseId),
    changeRisk: getChangeRiskEvidenceByReleaseId(releaseId),
  };

  if (!lookup.ci.ok) {
    return lookup.ci;
  }

  if (!lookup.tests.ok) {
    return lookup.tests;
  }

  if (!lookup.security.ok) {
    return lookup.security;
  }

  if (!lookup.changeRisk.ok) {
    return lookup.changeRisk;
  }

  return {
    ok: true,
    data: evaluateReleaseEvidence(
      releaseId,
      {
        ci: lookup.ci.data,
        tests: lookup.tests.data,
        security: lookup.security.data,
        changeRisk: lookup.changeRisk.data,
      },
      options,
    ),
  };
}
