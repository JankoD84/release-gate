import type { ReleaseEvidence, ReleaseLookupResult } from "../releases/types.ts";

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

export type DecisionAnalysis = {
  releaseId: string;
  decision: ReleaseDecision;
  confidence: DecisionConfidence;
  blockingEvidence: readonly DecisionEvidenceItem[];
  warnings: readonly DecisionEvidenceItem[];
  conditions: readonly string[];
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

