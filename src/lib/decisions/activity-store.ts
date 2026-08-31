import type { ReleaseDecision } from "../decision/types.ts";
import type { ActivityLogResult, ActivityOutcome, ActivityRecord, ActivityType } from "./activity-types.ts";

export const ACTIVITY_STORAGE_KEY = "release-gate:activity:v1";

const ACTIVITY_CHANGE_EVENT = "release-gate:activity-changed";
export const MAX_ACTIVITY_RECORDS = 100;

type ActivityStoreState = {
  nextId: number;
  records: ActivityRecord[];
};

type BrowserStorage = Pick<Storage, "getItem" | "removeItem" | "setItem">;

export type AddActivityInput = {
  timestamp: string;
  type: ActivityType;
  releaseId: string;
  toolName: string;
  outcome: ActivityOutcome;
  summary: string;
  recommendation?: ReleaseDecision;
};

let storageOverride: BrowserStorage | null | undefined;
let cachedState: ActivityStoreState | null = null;
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

function isActivityType(value: unknown): value is ActivityType {
  return value === "ANALYSIS" || value === "APPROVAL" || value === "REJECTION";
}

function isActivityOutcome(value: unknown): value is ActivityOutcome {
  return value === "SUCCESS" || value === "RELEASE_BLOCKED";
}

function isActivityRecord(value: unknown): value is ActivityRecord {
  if (!isRecord(value)) {
    return false;
  }

  return (
    typeof value.id === "string" &&
    typeof value.timestamp === "string" &&
    isActivityType(value.type) &&
    typeof value.releaseId === "string" &&
    typeof value.toolName === "string" &&
    isActivityOutcome(value.outcome) &&
    typeof value.summary === "string" &&
    (!("recommendation" in value) ||
      value.recommendation === undefined ||
      isReleaseDecision(value.recommendation))
  );
}

function parseActivityOrdinal(id: string): number | null {
  if (!id.startsWith("activity-")) {
    return null;
  }

  const ordinal = Number(id.slice("activity-".length));

  return Number.isSafeInteger(ordinal) && ordinal > 0 ? ordinal : null;
}

function createStateFromRecords(records: readonly ActivityRecord[]): ActivityStoreState {
  const boundedRecords = records.slice(-MAX_ACTIVITY_RECORDS);
  const maxOrdinal = boundedRecords.reduce((currentMax, record) => {
    const ordinal = parseActivityOrdinal(record.id);

    return ordinal && ordinal > currentMax ? ordinal : currentMax;
  }, 0);

  return {
    nextId: maxOrdinal + 1,
    records: [...boundedRecords],
  };
}

function loadPersistedState(storage: BrowserStorage | null): ActivityStoreState {
  if (!storage) {
    return createStateFromRecords([]);
  }

  try {
    const rawValue = storage.getItem(ACTIVITY_STORAGE_KEY);

    if (!rawValue) {
      return createStateFromRecords([]);
    }

    const parsedValue: unknown = JSON.parse(rawValue);

    if (!isRecord(parsedValue) || !Array.isArray(parsedValue.records)) {
      return createStateFromRecords([]);
    }

    const records = parsedValue.records.filter(isActivityRecord).map((record) => ({
      id: record.id,
      timestamp: record.timestamp,
      type: record.type,
      releaseId: record.releaseId,
      toolName: record.toolName,
      outcome: record.outcome,
      summary: record.summary,
      ...(record.recommendation ? { recommendation: record.recommendation } : {}),
    }));

    return createStateFromRecords(records);
  } catch {
    return createStateFromRecords([]);
  }
}

function getActivityStoreState(): ActivityStoreState {
  cachedState ??= loadPersistedState(getBrowserStorage());

  return cachedState;
}

function persistState(state: ActivityStoreState): void {
  const storage = getBrowserStorage();

  if (!storage) {
    return;
  }

  try {
    storage.setItem(
      ACTIVITY_STORAGE_KEY,
      JSON.stringify({
        records: state.records,
      }),
    );
  } catch {
    // Persistence failure must not break the in-memory audit trail.
  }
}

function notifyActivitySubscribers(): void {
  subscribers.forEach((subscriber) => subscriber());

  if (typeof window !== "undefined") {
    window.dispatchEvent(new Event(ACTIVITY_CHANGE_EVENT));
  }
}

export function addActivity(input: AddActivityInput): ActivityRecord {
  const state = getActivityStoreState();
  const activity: ActivityRecord = {
    id: `activity-${state.nextId}`,
    ...input,
  };

  state.nextId += 1;
  state.records = [...state.records, activity].slice(-MAX_ACTIVITY_RECORDS);
  persistState(state);
  notifyActivitySubscribers();

  return activity;
}

export function getActivityLog(releaseId?: string): ActivityLogResult {
  const records = getActivityStoreState().records;
  const activities = releaseId
    ? records.filter((activity) => activity.releaseId === releaseId)
    : records;

  return {
    activities,
  };
}

export function resetActivityLog(): void {
  const state = getActivityStoreState();

  state.nextId = 1;
  state.records = [];

  const storage = getBrowserStorage();

  try {
    storage?.removeItem(ACTIVITY_STORAGE_KEY);
  } catch {
    // Reset should still clear the in-memory demo activity if localStorage fails.
  }

  notifyActivitySubscribers();
}

export function subscribeToActivityLogChanges(subscriber: () => void): () => void {
  subscribers.add(subscriber);

  if (typeof window !== "undefined") {
    window.addEventListener(ACTIVITY_CHANGE_EVENT, subscriber);
  }

  return () => {
    subscribers.delete(subscriber);

    if (typeof window !== "undefined") {
      window.removeEventListener(ACTIVITY_CHANGE_EVENT, subscriber);
    }
  };
}

export function resetActivityLogForTests(): void {
  resetActivityLog();
}

export function setActivityStorageForTests(storage: BrowserStorage | null): void {
  storageOverride = storage;
  cachedState = null;
  subscribers.clear();
}

export function resetActivityRuntimeCacheForTests(): void {
  cachedState = null;
}
