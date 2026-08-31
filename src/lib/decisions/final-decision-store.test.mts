import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import {
  ACTIVITY_STORAGE_KEY,
  addActivity,
  getActivityLog,
  MAX_ACTIVITY_RECORDS,
  resetActivityLogForTests,
  resetActivityRuntimeCacheForTests,
  setActivityStorageForTests,
} from "./activity-store.ts";
import { resetDemoState } from "./demo-state.ts";
import {
  approveRelease,
  FINAL_DECISION_STORAGE_KEY,
  getFinalDecision,
  rejectRelease,
  resetFinalDecisionRuntimeCacheForTests,
  resetFinalDecisionStoreForTests,
  setFinalDecisionStorageForTests,
} from "./final-decision-store.ts";

const fixedNow = () => "2026-08-31T12:00:00.000Z";

class MemoryStorage implements Pick<Storage, "getItem" | "removeItem" | "setItem"> {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  setFinalDecisionStorageForTests(storage);
  setActivityStorageForTests(storage);
  resetFinalDecisionStoreForTests();
  resetActivityLogForTests();
});

test("get final decision before mutation returns PENDING", () => {
  assert.deepEqual(getFinalDecision("release-240"), {
    releaseId: "release-240",
    status: "PENDING",
  });
});

test("approve release-240 succeeds with final GO", () => {
  const result = approveRelease("release-240", true, { now: fixedNow });

  assert.equal(result.ok, true);
  assert.equal(result.decision.finalDecision, "GO");
  assert.equal(result.decision.recommendation, "GO");
  assert.equal(result.decision.actor, "human");
  assert.equal(getFinalDecision("release-240").status, "DECIDED");
});

test("approve release-250 with acknowledgement true succeeds with final CONDITIONAL_GO", () => {
  const result = approveRelease("release-250", true, { now: fixedNow });

  assert.equal(result.ok, true);
  assert.equal(result.decision.finalDecision, "CONDITIONAL_GO");
  assert.equal(result.decision.recommendation, "CONDITIONAL_GO");
});

test("approve release-250 with acknowledgement false requires human acknowledgement", () => {
  const result = approveRelease("release-250", false, { now: fixedNow });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "HUMAN_ACKNOWLEDGEMENT_REQUIRED");
  assert.equal(getFinalDecision("release-250").status, "PENDING");
});

test("approve release-260 is blocked and stores no approval", () => {
  const result = approveRelease("release-260", true, { now: fixedNow });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "RELEASE_BLOCKED");
  assert.equal(result.error.recommendation, "NO_GO");
  assert.ok(result.error.blockingEvidence.length > 0);
  assert.deepEqual(getFinalDecision("release-260"), {
    releaseId: "release-260",
    status: "PENDING",
  });
});

test("reject release-240 stores final NO_GO", () => {
  const result = rejectRelease("release-240", "Release owner rejected.", {
    now: fixedNow,
  });

  assert.equal(result.ok, true);
  assert.equal(result.decision.finalDecision, "NO_GO");
  assert.equal(result.decision.recommendation, "GO");
  assert.equal(result.decision.reason, "Release owner rejected.");
});

test("reject release-250 stores final NO_GO", () => {
  const result = rejectRelease("release-250", undefined, { now: fixedNow });

  assert.equal(result.ok, true);
  assert.equal(result.decision.finalDecision, "NO_GO");
  assert.equal(result.decision.recommendation, "CONDITIONAL_GO");
});

test("unknown release returns RELEASE_NOT_FOUND", () => {
  const approveResult = approveRelease("release-does-not-exist", true, {
    now: fixedNow,
  });
  const rejectResult = rejectRelease("release-does-not-exist", undefined, {
    now: fixedNow,
  });

  assert.equal(approveResult.ok, false);
  assert.equal(approveResult.error.code, "RELEASE_NOT_FOUND");
  assert.equal(rejectResult.ok, false);
  assert.equal(rejectResult.error.code, "RELEASE_NOT_FOUND");
});

test("approval produces APPROVAL activity", () => {
  approveRelease("release-240", true, { now: fixedNow });

  const activities = getActivityLog().activities;

  assert.equal(activities.length, 1);
  assert.equal(activities[0].type, "APPROVAL");
  assert.equal(activities[0].outcome, "SUCCESS");
  assert.equal(activities[0].releaseId, "release-240");
});

test("rejection produces REJECTION activity", () => {
  rejectRelease("release-250", "Not today.", { now: fixedNow });

  const activities = getActivityLog().activities;

  assert.equal(activities.length, 1);
  assert.equal(activities[0].type, "REJECTION");
  assert.equal(activities[0].outcome, "SUCCESS");
  assert.equal(activities[0].releaseId, "release-250");
});

test("blocked approval produces audit activity", () => {
  approveRelease("release-260", true, { now: fixedNow });

  const activities = getActivityLog().activities;

  assert.equal(activities.length, 1);
  assert.equal(activities[0].type, "APPROVAL");
  assert.equal(activities[0].outcome, "RELEASE_BLOCKED");
  assert.equal(activities[0].recommendation, "NO_GO");
});

test("activity filtering by releaseId works", () => {
  approveRelease("release-240", true, { now: fixedNow });
  rejectRelease("release-250", "Not today.", { now: fixedNow });

  const filtered = getActivityLog("release-250").activities;

  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].releaseId, "release-250");
  assert.equal(filtered[0].type, "REJECTION");
});

test("persisted GO decision can be loaded", () => {
  approveRelease("release-240", true, { now: fixedNow });
  resetFinalDecisionRuntimeCacheForTests();

  const decision = getFinalDecision("release-240");

  assert.equal(decision.status, "DECIDED");
  assert.equal(decision.decision.finalDecision, "GO");
});

test("persisted CONDITIONAL_GO decision can be loaded", () => {
  approveRelease("release-250", true, { now: fixedNow });
  resetFinalDecisionRuntimeCacheForTests();

  const decision = getFinalDecision("release-250");

  assert.equal(decision.status, "DECIDED");
  assert.equal(decision.decision.finalDecision, "CONDITIONAL_GO");
});

test("persisted NO_GO rejection can be loaded", () => {
  rejectRelease("release-260", "Release owner rejected.", { now: fixedNow });
  resetFinalDecisionRuntimeCacheForTests();

  const decision = getFinalDecision("release-260");

  assert.equal(decision.status, "DECIDED");
  assert.equal(decision.decision.action, "REJECT");
  assert.equal(decision.decision.finalDecision, "NO_GO");
  assert.equal(decision.decision.recommendation, "NO_GO");
});

test("malformed decision storage safely falls back", () => {
  storage.setItem(FINAL_DECISION_STORAGE_KEY, "not-json");
  resetFinalDecisionRuntimeCacheForTests();

  assert.deepEqual(getFinalDecision("release-240"), {
    releaseId: "release-240",
    status: "PENDING",
  });
});

test("malformed activity storage safely falls back", () => {
  storage.setItem(ACTIVITY_STORAGE_KEY, JSON.stringify({ records: "not-an-array" }));
  resetActivityRuntimeCacheForTests();

  assert.deepEqual(getActivityLog(), {
    activities: [],
  });
});

test("reset clears decisions", () => {
  approveRelease("release-240", true, { now: fixedNow });

  resetDemoState();

  assert.deepEqual(getFinalDecision("release-240"), {
    releaseId: "release-240",
    status: "PENDING",
  });
  assert.equal(storage.getItem(FINAL_DECISION_STORAGE_KEY), null);
});

test("reset clears activity", () => {
  approveRelease("release-240", true, { now: fixedNow });

  resetDemoState();

  assert.deepEqual(getActivityLog(), {
    activities: [],
  });
  assert.equal(storage.getItem(ACTIVITY_STORAGE_KEY), null);
});

test("activity history remains bounded", () => {
  for (let index = 0; index < MAX_ACTIVITY_RECORDS + 5; index += 1) {
    addActivity({
      timestamp: `2026-08-31T12:00:${String(index).padStart(2, "0")}.000Z`,
      type: "ANALYSIS",
      releaseId: "release-240",
      toolName: "analyze_release",
      outcome: "SUCCESS",
      summary: `Analysis ${index}`,
      recommendation: "GO",
    });
  }

  const activities = getActivityLog().activities;

  assert.equal(activities.length, MAX_ACTIVITY_RECORDS);
  assert.equal(activities[0].summary, "Analysis 5");
  assert.equal(activities.at(-1)?.summary, "Analysis 104");
});

test("NO_GO approval invariant remains enforced regardless of persisted state", () => {
  storage.setItem(
    FINAL_DECISION_STORAGE_KEY,
    JSON.stringify({
      records: [
        {
          releaseId: "release-260",
          action: "APPROVE",
          recommendation: "NO_GO",
          finalDecision: "GO",
          actor: "human",
          reason: "Invalid persisted approval.",
          decidedAt: fixedNow(),
        },
      ],
    }),
  );
  resetFinalDecisionRuntimeCacheForTests();

  const result = approveRelease("release-260", true, { now: fixedNow });
  const decision = getFinalDecision("release-260");

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "RELEASE_BLOCKED");
  assert.equal(decision.status, "PENDING");
});
