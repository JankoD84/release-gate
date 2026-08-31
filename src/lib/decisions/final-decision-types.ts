import type { DecisionEvidenceItem, ReleaseDecision } from "../decision/types.ts";
import type { LiveEvidenceError } from "../releases/live-evidence.ts";
import type { ReleaseNotFoundError } from "../releases/types.ts";

export type FinalDecisionAction = "APPROVE" | "REJECT";

export type FinalDecisionActor = "human";

export type FinalDecisionRecord = {
  releaseId: string;
  action: FinalDecisionAction;
  recommendation: ReleaseDecision;
  finalDecision: ReleaseDecision;
  actor: FinalDecisionActor;
  reason: string;
  decidedAt: string;
};

export type HumanAcknowledgementRequiredError = {
  code: "HUMAN_ACKNOWLEDGEMENT_REQUIRED";
  releaseId: string;
  message: string;
};

export type ReleaseBlockedError = {
  code: "RELEASE_BLOCKED";
  releaseId: string;
  recommendation: "NO_GO";
  blockingEvidence: readonly DecisionEvidenceItem[];
  message: string;
};

export type FinalDecisionError =
  | ReleaseNotFoundError
  | LiveEvidenceError
  | HumanAcknowledgementRequiredError
  | ReleaseBlockedError;

export type FinalDecisionMutationResult =
  | {
      ok: true;
      decision: FinalDecisionRecord;
    }
  | {
      ok: false;
      error: FinalDecisionError;
    };

export type FinalDecisionState =
  | {
      releaseId: string;
      status: "PENDING";
    }
  | {
      releaseId: string;
      status: "DECIDED";
      decision: FinalDecisionRecord;
    };
