import type { ReleaseDecision } from "../decision/types.ts";

export type ActivityType = "ANALYSIS" | "APPROVAL" | "REJECTION";

export type ActivityOutcome = "SUCCESS" | "RELEASE_BLOCKED";

export type ActivityRecord = {
  id: string;
  timestamp: string;
  type: ActivityType;
  releaseId: string;
  toolName: string;
  outcome: ActivityOutcome;
  summary: string;
  recommendation?: ReleaseDecision;
};

export type ActivityLogResult = {
  activities: readonly ActivityRecord[];
};
