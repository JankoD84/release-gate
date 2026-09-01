import type { DecisionAnalysis, ReleaseDecision, RequiredAction } from "./types.ts";
import type { ActivityRecord } from "../decisions/activity-types.ts";
import type { FinalDecisionState } from "../decisions/final-decision-types.ts";
import type { RepositoryReference } from "../releases/repository.ts";
import type { ChangeRiskEvidence, CiEvidence, EvidenceProvenance, ReleaseCandidateMetadata, ReleaseRecord, SecurityEvidence, TestEvidence } from "../releases/types.ts";

type PacketEvidence<TStatus extends string> = {
  status: TStatus;
  details: string;
  provenance?: EvidenceProvenance;
};

export type ReleaseDecisionPacket = {
  schemaVersion: 1;
  repository: {
    source: "LIVE" | "DEMO";
    provider: "github" | "gitlab" | "synthetic";
    fullPath: string;
    publicUrl?: string;
  };
  release: {
    id: string;
    version: string;
    name: string;
    branch: string;
    commitSha: string;
    updatedAt: string;
    provenance?: EvidenceProvenance;
  };
candidate?: ReleaseCandidateMetadata;
generatedAt: string;
  systemRecommendation: {
    decision: ReleaseDecision;
    confidence: DecisionAnalysis["confidence"];
    summary: string;
    evaluatedAt: string;
  };
  evidenceCompleteness: DecisionAnalysis["evidenceCompleteness"];
  evidenceFreshness: DecisionAnalysis["evidenceFreshness"];
  riskFingerprint: DecisionAnalysis["riskFingerprint"];
  decisionPath: DecisionAnalysis["decisionPath"];
  evidence: {
    ci: PacketEvidence<CiEvidence["status"]>;
    tests: PacketEvidence<TestEvidence["status"]>;
    security: PacketEvidence<SecurityEvidence["status"]>;
    changeRisk: PacketEvidence<ChangeRiskEvidence["level"]>;
  };
  analysis: {
    blockers: DecisionAnalysis["blockingEvidence"];
    warnings: DecisionAnalysis["warnings"];
    conditions: DecisionAnalysis["conditions"];
    requiredActions: readonly RequiredAction[];
  };
  requiredActions: readonly RequiredAction[];
  humanDecision: FinalDecisionState;
  activitySummary: readonly Pick<ActivityRecord, "timestamp" | "type" | "outcome" | "summary" | "recommendation">[];
};

function formatMaybeUnavailable(status: string, availableDetails: string, unavailableDetails: string): string {
  return status === "NOT_AVAILABLE" ? unavailableDetails : availableDetails;
}

function createRepositoryPacket(mode: "LIVE" | "DEMO", repository?: RepositoryReference): ReleaseDecisionPacket["repository"] {
  if (mode === "LIVE" && repository) {
    return {
      source: "LIVE",
      provider: repository.provider,
      fullPath: repository.fullPath,
      publicUrl: repository.url,
    };
  }

  return {
    source: "DEMO",
    provider: "synthetic",
    fullPath: "Deterministic scenarios",
  };
}

export function createReleaseDecisionPacket(input: {
  mode: "LIVE" | "DEMO";
  repository?: RepositoryReference;
  release: ReleaseRecord;
  analysis: DecisionAnalysis;
  humanDecision: FinalDecisionState;
  activities?: readonly ActivityRecord[];
  generatedAt?: string;
}): ReleaseDecisionPacket {
  const { analysis, release } = input;

  return {
    schemaVersion: 1,
    repository: createRepositoryPacket(input.mode, input.repository),
    release: {
      id: release.id,
      version: release.version,
      name: release.name,
      branch: release.branch,
      commitSha: release.commitSha,
      updatedAt: release.updatedAt,
      ...(release.provenance ? { provenance: release.provenance } : {}),
    },
    ...(release.candidate ? { candidate: release.candidate } : {}),
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    systemRecommendation: {
      decision: analysis.decision,
      confidence: analysis.confidence,
      summary: analysis.summary,
      evaluatedAt: analysis.evaluatedAt,
    },
    evidenceCompleteness: analysis.evidenceCompleteness,
    evidenceFreshness: analysis.evidenceFreshness,
    riskFingerprint: analysis.riskFingerprint,
    decisionPath: analysis.decisionPath,
    evidence: {
      ci: {
        status: release.evidence.ci.status,
        details: formatMaybeUnavailable(
          release.evidence.ci.status,
          `${release.evidence.ci.passedJobs} / ${release.evidence.ci.totalJobs} jobs passed; ${release.evidence.ci.failedJobs} failed.`,
          "No public CI evidence available.",
        ),
        ...(release.evidence.ci.provenance ? { provenance: release.evidence.ci.provenance } : {}),
      },
      tests: {
        status: release.evidence.tests.status,
        details: formatMaybeUnavailable(
          release.evidence.tests.status,
          `${release.evidence.tests.passed} / ${release.evidence.tests.total} tests passed; ${release.evidence.tests.failed} failed; ${release.evidence.tests.flaky} flaky.`,
          "No public test evidence available.",
        ),
        ...(release.evidence.tests.provenance ? { provenance: release.evidence.tests.provenance } : {}),
      },
      security: {
        status: release.evidence.security.status,
        details: formatMaybeUnavailable(
          release.evidence.security.status,
          `${release.evidence.security.critical} critical; ${release.evidence.security.high} high; ${release.evidence.security.medium} medium; ${release.evidence.security.low} low findings.`,
          "No public security evidence available.",
        ),
        ...(release.evidence.security.provenance ? { provenance: release.evidence.security.provenance } : {}),
      },
      changeRisk: {
        status: release.evidence.changeRisk.level,
        details: `${release.evidence.changeRisk.filesChanged} files changed; ${release.evidence.changeRisk.linesAdded} additions; ${release.evidence.changeRisk.linesDeleted} deletions; components: ${release.evidence.changeRisk.changedComponents.join(", ") || "none"}.`,
        ...(release.evidence.changeRisk.provenance ? { provenance: release.evidence.changeRisk.provenance } : {}),
      },
    },
    analysis: {
      blockers: analysis.blockingEvidence,
      warnings: analysis.warnings,
      conditions: analysis.conditions,
      requiredActions: analysis.requiredActions,
    },
    requiredActions: analysis.requiredActions,
    humanDecision: input.humanDecision,
    activitySummary: (input.activities ?? []).slice(-5).map((activity) => ({
      timestamp: activity.timestamp,
      type: activity.type,
      outcome: activity.outcome,
      summary: activity.summary,
      ...(activity.recommendation ? { recommendation: activity.recommendation } : {}),
    })),
  };
}

function formatDecision(decision: ReleaseDecision | "PENDING"): string {
  return decision === "CONDITIONAL_GO" ? "CONDITIONAL GO" : decision.replace("_", " ");
}

function provenanceMarkdown(provenance?: EvidenceProvenance): string {
  if (!provenance) return "";
  const source = `Source: ${provenance.label}`;
  return provenance.externalUrl ? `${source}\nLink: ${provenance.externalUrl}` : source;
}

function listMarkdown(items: readonly string[]): string {
  return items.length === 0 ? "None" : items.map((item) => `- ${item}`).join("\n");
}

function actionsMarkdown(actions: readonly RequiredAction[]): string {
  if (actions.length === 0) {
    return "None — current evidence does not require remediation.";
  }

  return actions.map((action) => `- [${action.priority}] ${action.message}`).join("\n");
}

export function createReleaseDecisionPacketMarkdown(packet: ReleaseDecisionPacket): string {
  const humanDecision = packet.humanDecision.status === "DECIDED" ? packet.humanDecision.decision.finalDecision : "PENDING";
  const humanDetails = packet.humanDecision.status === "DECIDED"
    ? `Action: ${packet.humanDecision.decision.action}\nFinal Decision: ${formatDecision(packet.humanDecision.decision.finalDecision)}\nActor: ${packet.humanDecision.decision.actor}\nReason: ${packet.humanDecision.decision.reason}\nDecided At: ${packet.humanDecision.decision.decidedAt}`
    : "PENDING";

  return [
    "# Release Gate Decision Packet",
    "",
    `Repository: ${packet.repository.provider === "synthetic" ? "Synthetic fixtures" : packet.repository.provider === "github" ? "GitHub" : "GitLab"} / ${packet.repository.fullPath}`,
    packet.repository.publicUrl ? `Repository URL: ${packet.repository.publicUrl}` : undefined,
    packet.candidate ? `Candidate Type: ${packet.candidate.candidateType}` : undefined,
    packet.candidate?.candidateNumber !== undefined ? `Candidate Number: ${packet.candidate.candidateNumber}` : undefined,
    packet.candidate ? `Candidate Title: ${packet.candidate.title}` : `Release: ${packet.release.version}`,
    packet.candidate?.headBranch ? `Source Branch: ${packet.candidate.headBranch}` : undefined,
    packet.candidate?.baseBranch ? `Target Branch: ${packet.candidate.baseBranch}` : `Branch: ${packet.release.branch}`,
    packet.candidate?.publicUrl ? `Candidate URL: ${packet.candidate.publicUrl}` : undefined,
    `Release ID: ${packet.release.id}`,
    `Commit: ${packet.release.commitSha}`,
    `Generated At: ${packet.generatedAt}`,
    "",
    "## System Recommendation",
    "",
    formatDecision(packet.systemRecommendation.decision),
    "",
    `Confidence: ${packet.systemRecommendation.confidence}`,
    packet.systemRecommendation.summary,
    "",
    "## Evidence Intelligence",
    "",
    `Completeness: ${packet.evidenceCompleteness.percentage}% · ${packet.evidenceCompleteness.verifiedSurfaces} / ${packet.evidenceCompleteness.totalSurfaces} verified`,
    `Missing Surfaces: ${packet.evidenceCompleteness.missingSurfaces.join(", ") || "None"}`,
    "",
    "### Freshness",
    listMarkdown(Object.entries(packet.evidenceFreshness).map(([surface, freshness]) => `${surface}: ${freshness.state}${freshness.observedAt ? ` (observed ${freshness.observedAt})` : ""}`)),
    "",
    "### Risk Fingerprint",
    `Risk Reasons: ${packet.riskFingerprint.riskReasons.join(", ") || "None"}`,
    `Changed Areas: ${packet.riskFingerprint.changedAreas.join(", ") || "None"}`,
    `Critical Components: ${packet.riskFingerprint.criticalComponents.join(", ") || "None"}`,
    "",
    "### Decision Path",
    `Current Decision: ${formatDecision(packet.decisionPath.currentDecision)}`,
    `Target Decision: ${formatDecision(packet.decisionPath.targetDecision)}`,
    "Currently Prevented By:",
    listMarkdown(packet.decisionPath.currentlyPreventedBy),
    "Next Best Actions:",
    listMarkdown(packet.decisionPath.nextBestActions),
    packet.decisionPath.note,
    "",
    "## Evidence",
    "",
    "### CI",
    packet.evidence.ci.status,
    packet.evidence.ci.details,
    provenanceMarkdown(packet.evidence.ci.provenance),
    "",
    "### Tests",
    packet.evidence.tests.status,
    packet.evidence.tests.details,
    provenanceMarkdown(packet.evidence.tests.provenance),
    "",
    "### Security",
    packet.evidence.security.status,
    packet.evidence.security.details,
    provenanceMarkdown(packet.evidence.security.provenance),
    "",
    "### Change Risk",
    packet.evidence.changeRisk.status,
    packet.evidence.changeRisk.details,
    provenanceMarkdown(packet.evidence.changeRisk.provenance),
    "",
    "## Required Actions",
    "",
    actionsMarkdown(packet.requiredActions),
    "",
    "## Human Final Decision",
    "",
    formatDecision(humanDecision),
    "",
    humanDetails,
    "",
    "Generated by Release Gate.",
  ].filter((line) => line !== undefined).join("\n");
}
