import { analyzeRelease, analyzeReleaseRecord } from "../decision/engine.ts";
import type { DecisionAnalysis, ReleaseDecision } from "../decision/types.ts";
import type { ReleaseMode } from "../mode.ts";
import { getReleaseById } from "../releases/fixtures.ts";
import type { ReleaseRecord } from "../releases/types.ts";
import { addActivity } from "./activity-store.ts";
import type {
  FinalDecisionMutationResult,
  FinalDecisionRecord,
  FinalDecisionState,
  HumanAcknowledgementRequiredError,
  ReleaseBlockedError,
} from "./final-decision-types.ts";

export const FINAL_DECISION_STORAGE_KEY = "release-gate:decisions:v1";

const FINAL_DECISION_CHANGE_EVENT = "release-gate:decisions-changed";

type FinalDecisionStoreState = {
  recordsByReleaseId: Map<string, FinalDecisionRecord>;
};

type BrowserStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export type DecisionMutationOptions = {
  now?: () => string;
  mode?: ReleaseMode;
};

let storageOverride: BrowserStorage | null | undefined;
let cachedState: FinalDecisionStoreState | null = null;
const subscribers = new Set<() => void>();

function getBrowserStorage(): BrowserStorage | null {
  if (storageOverride !== undefined) {
    return storageOverride;
  }

  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isReleaseDecision(value: unknown): value is ReleaseDecision {
  return value === "GO" || value === "CONDITIONAL_GO" || value === "NO_GO";
}

function isFinalDecisionRecord(value: unknown): value is FinalDecisionRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.releaseId === "string" &&
    (value.action === "APPROVE" || value.action === "REJECT") &&
    isReleaseDecision(value.recommendation) &&
    isReleaseDecision(value.finalDecision) &&
    value.actor === "human" &&
    typeof value.reason === "string" &&
    typeof value.decidedAt === "string"
  );
}

function createStateFromRecords(
  records: readonly FinalDecisionRecord[],
): FinalDecisionStoreState {
  return {
    recordsByReleaseId: new Map(records.map((record) => [record.releaseId, record])),
  };
}

function loadPersistedState(storage: BrowserStorage | null): FinalDecisionStoreState {
  if (!storage) {
    return createStateFromRecords([]);
  }

  try {
    const rawValue = storage.getItem(FINAL_DECISION_STORAGE_KEY);

    if (!rawValue) {
      return createStateFromRecords([]);
    }

    const parsedValue: unknown = JSON.parse(rawValue);

    if (!isRecord(parsedValue) || !Array.isArray(parsedValue.records)) {
      return createStateFromRecords([]);
    }

    const records = parsedValue.records.filter(isFinalDecisionRecord).map((record) => ({
      releaseId: record.releaseId,
      action: record.action,
      recommendation: record.recommendation,
      finalDecision: record.finalDecision,
      actor: record.actor,
      reason: record.reason,
      decidedAt: record.decidedAt,
    }));

    return createStateFromRecords(records);
  } catch {
    return createStateFromRecords([]);
  }
}

function getFinalDecisionStoreState(): FinalDecisionStoreState {
  cachedState ??= loadPersistedState(getBrowserStorage());

  return cachedState;
}

function persistState(state: FinalDecisionStoreState): void {
  const storage = getBrowserStorage();

  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      FINAL_DECISION_STORAGE_KEY,
      JSON.stringify({
        records: [...state.recordsByReleaseId.values()],
      }),
    );
  } catch {
    // Persistence failure must not break the in-memory release gate state.
  }
}

function notifyFinalDecisionSubscribers(): void {
  subscribers.forEach((subscriber) => subscriber());

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(FINAL_DECISION_CHANGE_EVENT));
  }
}

function getTimestamp(options: DecisionMutationOptions): string {
  return options.now?.() ?? new Date().toISOString();
}

function createAcknowledgementError(
  releaseId: string,
): HumanAcknowledgementRequiredError {
  return {
    code: "HUMAN_ACKNOWLEDGEMENT_REQUIRED",
    releaseId,
    message:
      "Human approval requires acknowledgement=true after reviewing the current recommendation and evidence.",
  };
}

function createReleaseBlockedError(
  releaseId: string,
  blockingEvidence: ReleaseBlockedError["blockingEvidence"],
): ReleaseBlockedError {
  return {
    code: "RELEASE_BLOCKED",
    releaseId,
    recommendation: "NO_GO",
    blockingEvidence,
    message: "NO_GO is a hard-blocked recommendation and cannot be approved.",
  };
}

function mapApprovedFinalDecision(recommendation: ReleaseDecision): ReleaseDecision {
  return recommendation === "GO" ? "GO" : "CONDITIONAL_GO";
}

export function approveReleaseAnalysis(
  analysis: DecisionAnalysis,
  acknowledgement: boolean,
  options: DecisionMutationOptions = {},
): FinalDecisionMutationResult {
  const releaseId = analysis.releaseId;
  if (!acknowledgement) {
    return {
      ok: false,
      error: createAcknowledgementError(releaseId),
    };
  }

  if (analysis.decision === "NO_GO") {
    const state = getFinalDecisionStoreState();
    const existingDecision = state.recordsByReleaseId.get(releaseId);

    if (existingDecision?.action === "APPROVE") {
      state.recordsByReleaseId.delete(releaseId);
      persistState(state);
      notifyFinalDecisionSubscribers();
    }

    addActivity({
      timestamp: analysis.evaluatedAt,
      type: "APPROVAL",
      releaseId,
      toolName: "approve_release",
      outcome: "RELEASE_BLOCKED",
      summary: "Human approval was blocked because the current recommendation is NO_GO.",
      recommendation: analysis.decision,
      mode: options.mode ?? "DEMO",
    });

    return {
      ok: false,
      error: createReleaseBlockedError(releaseId, analysis.blockingEvidence),
    };
  }

  const record: FinalDecisionRecord = {
    releaseId,
    action: "APPROVE",
    recommendation: analysis.decision,
    finalDecision: mapApprovedFinalDecision(analysis.decision),
    actor: "human",
    reason: "Human explicitly acknowledged the current recommendation and evidence.",
    decidedAt: analysis.evaluatedAt,
  };

  const state = getFinalDecisionStoreState();
  state.recordsByReleaseId.set(releaseId, record);
  persistState(state);
  notifyFinalDecisionSubscribers();

  addActivity({
    timestamp: record.decidedAt,
    type: "APPROVAL",
    releaseId,
    toolName: "approve_release",
    outcome: "SUCCESS",
    summary: `Human approved ${record.finalDecision}.`,
    recommendation: record.recommendation,
    mode: options.mode ?? "DEMO",
  });

  return {
    ok: true,
    decision: record,
  };
}

export function approveRelease(
  releaseId: string,
  acknowledgement: boolean,
  options: DecisionMutationOptions = {},
): FinalDecisionMutationResult {
  const analysis = analyzeRelease(releaseId, { evaluatedAt: getTimestamp(options) });

  if (!analysis.ok) {
    return {
      ok: false,
      error: analysis.error,
    };
  }

  return approveReleaseAnalysis(analysis.data, acknowledgement, {
    ...options,
    mode: options.mode ?? "DEMO",
  });
}

export function approveReleaseRecord(
  record: ReleaseRecord,
  acknowledgement: boolean,
  options: DecisionMutationOptions = {},
): FinalDecisionMutationResult {
  const analysis = analyzeReleaseRecord(record, { evaluatedAt: getTimestamp(options) });

  return approveReleaseAnalysis(analysis.data, acknowledgement, {
    ...options,
    mode: options.mode ?? "LIVE",
  });
}

export function rejectReleaseAnalysis(
  analysis: DecisionAnalysis,
  reason: string | undefined,
  options: DecisionMutationOptions = {},
): FinalDecisionMutationResult {
  const releaseId = analysis.releaseId;
  const decidedAt = analysis.evaluatedAt;
  const cleanReason = reason?.trim() || "Human explicitly rejected the release.";
  const record: FinalDecisionRecord = {
    releaseId,
    action: "REJECT",
    recommendation: analysis.decision,
    finalDecision: "NO_GO",
    actor: "human",
    reason: cleanReason,
    decidedAt,
  };

  const state = getFinalDecisionStoreState();
  state.recordsByReleaseId.set(releaseId, record);
  persistState(state);
  notifyFinalDecisionSubscribers();

  addActivity({
    timestamp: record.decidedAt,
    type: "REJECTION",
    releaseId,
    toolName: "reject_release",
    outcome: "SUCCESS",
    summary: `Human rejected release; final decision is ${record.finalDecision}.`,
    recommendation: record.recommendation,
    mode: options.mode ?? "DEMO",
  });

  return {
    ok: true,
    decision: record,
  };
}

export function rejectRelease(
  releaseId: string,
  reason = "Human explicitly rejected the release.",
  options: DecisionMutationOptions = {},
): FinalDecisionMutationResult {
  const release = getReleaseById(releaseId);

  if (!release.ok) {
    return {
      ok: false,
      error: release.error,
    };
  }

  const decidedAt = getTimestamp(options);
  const analysis = analyzeRelease(releaseId, { evaluatedAt: decidedAt });

  if (!analysis.ok) {
    return {
      ok: false,
      error: analysis.error,
    };
  }

  return rejectReleaseAnalysis(analysis.data, reason, {
    ...options,
    mode: options.mode ?? "DEMO",
  });
}

export function rejectReleaseRecord(
  record: ReleaseRecord,
  reason = "Human explicitly rejected the release.",
  options: DecisionMutationOptions = {},
): FinalDecisionMutationResult {
  const analysis = analyzeReleaseRecord(record, { evaluatedAt: getTimestamp(options) });

  return rejectReleaseAnalysis(analysis.data, reason, {
    ...options,
    mode: options.mode ?? "LIVE",
  });
}

export function getFinalDecision(releaseId: string): FinalDecisionState {
  const decision = getFinalDecisionStoreState().recordsByReleaseId.get(releaseId);

  return decision
    ? {
        releaseId,
        status: "DECIDED",
        decision,
      }
    : {
        releaseId,
        status: "PENDING",
      };
}

export function resetFinalDecisionStore(): void {
  const state = getFinalDecisionStoreState();
  state.recordsByReleaseId.clear();

  const storage = getBrowserStorage();

  try {
    storage?.removeItem(FINAL_DECISION_STORAGE_KEY);
  } catch {
    // Reset should still clear the in-memory demo state if localStorage fails.
  }

  notifyFinalDecisionSubscribers();
}

export function subscribeToFinalDecisionChanges(subscriber: () => void): () => void {
  subscribers.add(subscriber);

  if (typeof window !== "undefined") {
    window.addEventListener(FINAL_DECISION_CHANGE_EVENT, subscriber);
  }

  return () => {
    subscribers.delete(subscriber);

    if (typeof window !== "undefined") {
      window.removeEventListener(FINAL_DECISION_CHANGE_EVENT, subscriber);
    }
  };
}

export function resetFinalDecisionStoreForTests(): void {
  resetFinalDecisionStore();
}

export function setFinalDecisionStorageForTests(storage: BrowserStorage | null): void {
  storageOverride = storage;
  cachedState = null;
  subscribers.clear();
}

export function resetFinalDecisionRuntimeCacheForTests(): void {
  cachedState = null;
}
