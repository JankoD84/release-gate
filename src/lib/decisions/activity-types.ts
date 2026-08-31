import type { ReleaseDecision } from "../decision/types.ts";
import type { ReleaseMode } from "../mode.ts";

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
  mode?: ReleaseMode;
};

export type ActivityLogResult = {
  activities: readonly ActivityRecord[];
};
