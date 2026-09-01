import type { ReleaseEvidence, ReleaseLookupResult, RiskFingerprint } from "../releases/types.ts";
import type { DecisionPath, EvidenceCompleteness, EvidenceFreshness } from "./intelligence.ts";

export type ReleaseDecision = "GO" | "CONDITIONAL_GO" | "NO_GO";

export type DecisionConfidence = "HIGH" | "MEDIUM" | "LOW";

export type DecisionEvidenceCategory = "CI" | "TESTS" | "SECURITY" | "CHANGE_RISK";

export type DecisionEvidenceSeverity = "BLOCKER" | "WARNING";

export type DecisionEvidenceItem = {
  category: DecisionEvidenceCategory;
  severity: DecisionEvidenceSeverity;
  code: string;
  message: string;
};

export type RequiredActionPriority = "BLOCKER" | "REQUIRED" | "RECOMMENDED";

export type RequiredAction = {
  code: string;
  priority: RequiredActionPriority;
  category: string;
  message: string;
};

export type DecisionAnalysis = {
  releaseId: string;
  decision: ReleaseDecision;
  confidence: DecisionConfidence;
  blockingEvidence: readonly DecisionEvidenceItem[];
  warnings: readonly DecisionEvidenceItem[];
  conditions: readonly string[];
  requiredActions: readonly RequiredAction[];
  evidenceCompleteness: EvidenceCompleteness;
  evidenceFreshness: EvidenceFreshness;
  riskFingerprint: RiskFingerprint;
  decisionPath: DecisionPath;
  summary: string;
  evaluatedAt: string;
};

export type DecisionAnalysisResult = ReleaseLookupResult<DecisionAnalysis>;

export type DecisionEvaluationOptions = {
  evaluatedAt?: string;
};

export type ReleaseEvidenceLookup = {
  ci: ReleaseLookupResult<ReleaseEvidence["ci"]>;
  tests: ReleaseLookupResult<ReleaseEvidence["tests"]>;
  security: ReleaseLookupResult<ReleaseEvidence["security"]>;
  changeRisk: ReleaseLookupResult<ReleaseEvidence["changeRisk"]>;
};

