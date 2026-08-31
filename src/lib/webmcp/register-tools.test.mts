import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { setReleaseModeForTests } from "../mode.ts";
import {
  getActivityLog,
  resetActivityLogForTests,
  setActivityStorageForTests,
} from "../decisions/activity-store.ts";
import {
  getFinalDecision,
  resetFinalDecisionStoreForTests,
  setFinalDecisionStorageForTests,
} from "../decisions/final-decision-store.ts";
import { createWebMcpTools, webMcpToolCatalog } from "./register-tools.ts";

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

type JsonRecord = Record<string, unknown>;

const executeOptions: WebMCP.ToolExecuteCallbackOptions = {
  signal: new AbortController().signal,
};

function assertRecord(value: unknown): asserts value is JsonRecord {
  assert.equal(typeof value, "object");
  assert.notEqual(value, null);
}

function getTool(name: string): WebMCP.ModelContextTool {
  const tool = createWebMcpTools().find((candidate) => candidate.name === name);

  assert.ok(tool, `Expected WebMCP tool '${name}' to exist.`);

  return tool;
}

async function executeTool(name: string, input: JsonRecord = {}): Promise<JsonRecord> {
  const result = await getTool(name).execute(input, executeOptions);

  assertRecord(result);

  return result;
}

beforeEach(() => {
  setReleaseModeForTests("DEMO");
  const storage = new MemoryStorage();

  setFinalDecisionStorageForTests(storage);
  setActivityStorageForTests(storage);
  resetFinalDecisionStoreForTests();
  resetActivityLogForTests();
});

test("WebMCP catalog contains exactly 11 unique tools", () => {
  const names = webMcpToolCatalog.map((tool) => tool.name);

  assert.equal(names.length, 11);
  assert.equal(new Set(names).size, 11);
});

test("WebMCP readOnlyHint annotations match safety semantics", () => {
  const writeToolNames = new Set(["approve_release", "reject_release"]);

  for (const tool of webMcpToolCatalog) {
    assert.equal(tool.annotations?.readOnlyHint, !writeToolNames.has(tool.name), tool.name);
  }
});

test("WebMCP input schemas are strict and consistent", () => {
  for (const tool of webMcpToolCatalog) {
    assertRecord(tool.inputSchema);
    assert.equal(tool.inputSchema.type, "object", tool.name);
    assert.equal(tool.inputSchema.additionalProperties, false, tool.name);
  }

  const approveRelease = webMcpToolCatalog.find((tool) => tool.name === "approve_release");
  assert.ok(approveRelease);
  assertRecord(approveRelease.inputSchema.properties);
  assert.deepEqual(approveRelease.inputSchema.required, ["releaseId", "acknowledgement"]);

  const acknowledgement = approveRelease.inputSchema.properties.acknowledgement;
  assertRecord(acknowledgement);
  assert.equal(acknowledgement.type, "boolean");

  const rejectRelease = webMcpToolCatalog.find((tool) => tool.name === "reject_release");
  assert.ok(rejectRelease);
  assert.deepEqual(rejectRelease.inputSchema.required, ["releaseId"]);
});

test("list_releases execution returns all deterministic releases", async () => {
  const result = await executeTool("list_releases");
  const releases = result.releases;

  assert.ok(Array.isArray(releases));
  assert.equal(releases.length, 3);
  assert.deepEqual(
    releases.map((release) => release.id),
    ["release-240", "release-250", "release-260"],
  );
});

test("get_release execution returns release metadata for a valid releaseId", async () => {
  const result = await executeTool("get_release", { releaseId: "release-240" });
  const release = result.release;

  assertRecord(release);
  assert.equal(release.id, "release-240");
  assert.equal(release.version, "2.4.0");
  assert.equal(release.decision, "GO");
});

test("get_release execution returns RELEASE_NOT_FOUND for an invalid releaseId", async () => {
  const result = await executeTool("get_release", { releaseId: "release-999" });
  const error = result.error;

  assertRecord(error);
  assert.equal(error.code, "RELEASE_NOT_FOUND");
  assert.equal(error.releaseId, "release-999");
});

test("evidence tools return RELEASE_NOT_FOUND without fallback", async () => {
  for (const toolName of [
    "get_ci_status",
    "get_test_results",
    "get_security_findings",
    "get_change_risk",
    "analyze_release",
    "get_final_decision",
  ]) {
    const result = await executeTool(toolName, { releaseId: "release-999" });
    const error = result.error;

    assertRecord(error);
    assert.equal(error.code, "RELEASE_NOT_FOUND", toolName);
    assert.equal(error.releaseId, "release-999", toolName);
  }
});

test("analyze_release execution returns GO for release-240 and remains read-only", async () => {
  const result = await executeTool("analyze_release", { releaseId: "release-240" });
  const analysis = result.analysis;

  assertRecord(analysis);
  assert.equal(analysis.releaseId, "release-240");
  assert.equal(analysis.decision, "GO");
  assert.equal(getFinalDecision("release-240").status, "PENDING");
  assert.equal(getActivityLog().activities.length, 0);
});

test("analyze_release execution returns CONDITIONAL_GO for release-250", async () => {
  const result = await executeTool("analyze_release", { releaseId: "release-250" });
  const analysis = result.analysis;

  assertRecord(analysis);
  assert.equal(analysis.releaseId, "release-250");
  assert.equal(analysis.decision, "CONDITIONAL_GO");
  assert.ok(Array.isArray(analysis.warnings));
  assert.ok(analysis.warnings.length > 0);
});

test("analyze_release execution returns NO_GO for release-260", async () => {
  const result = await executeTool("analyze_release", { releaseId: "release-260" });
  const analysis = result.analysis;

  assertRecord(analysis);
  assert.equal(analysis.releaseId, "release-260");
  assert.equal(analysis.decision, "NO_GO");
  assert.ok(Array.isArray(analysis.blockingEvidence));
  assert.ok(analysis.blockingEvidence.length >= 3);
});

test("approve_release execution requires acknowledgement true", async () => {
  const result = await executeTool("approve_release", {
    releaseId: "release-250",
    acknowledgement: false,
  });
  const error = result.error;

  assert.equal(result.ok, false);
  assertRecord(error);
  assert.equal(error.code, "HUMAN_ACKNOWLEDGEMENT_REQUIRED");
  assert.equal(getFinalDecision("release-250").status, "PENDING");
});

test("approve_release execution records valid human approval for release-250", async () => {
  const result = await executeTool("approve_release", {
    releaseId: "release-250",
    acknowledgement: true,
  });
  const decision = result.decision;

  assert.equal(result.ok, true);
  assertRecord(decision);
  assert.equal(decision.releaseId, "release-250");
  assert.equal(decision.recommendation, "CONDITIONAL_GO");
  assert.equal(decision.finalDecision, "CONDITIONAL_GO");
  assert.equal(decision.actor, "human");
  assert.equal(getActivityLog("release-250").activities.at(-1)?.type, "APPROVAL");
});

test("approve_release execution blocks NO_GO release approval", async () => {
  const result = await executeTool("approve_release", {
    releaseId: "release-260",
    acknowledgement: true,
  });
  const error = result.error;

  assert.equal(result.ok, false);
  assertRecord(error);
  assert.equal(error.code, "RELEASE_BLOCKED");
  assert.deepEqual(getFinalDecision("release-260"), {
    releaseId: "release-260",
    status: "PENDING",
  });
  assert.equal(getActivityLog("release-260").activities.at(-1)?.outcome, "RELEASE_BLOCKED");
});

test("reject_release execution records human rejection while preserving recommendation", async () => {
  const result = await executeTool("reject_release", {
    releaseId: "release-240",
    reason: "We are postponing this deployment.",
  });
  const decision = result.decision;

  assert.equal(result.ok, true);
  assertRecord(decision);
  assert.equal(decision.releaseId, "release-240");
  assert.equal(decision.recommendation, "GO");
  assert.equal(decision.finalDecision, "NO_GO");
  assert.equal(decision.actor, "human");
});

test("get_final_decision execution returns current human decision state", async () => {
  await executeTool("approve_release", {
    releaseId: "release-250",
    acknowledgement: true,
  });

  const result = await executeTool("get_final_decision", { releaseId: "release-250" });
  const decision = result.decision;

  assert.equal(result.releaseId, "release-250");
  assert.equal(result.status, "DECIDED");
  assertRecord(decision);
  assert.equal(decision.finalDecision, "CONDITIONAL_GO");
});

test("get_activity_log execution returns recorded decision activity", async () => {
  await executeTool("reject_release", {
    releaseId: "release-240",
    reason: "Postponed.",
  });

  const result = await executeTool("get_activity_log", { releaseId: "release-240" });
  const activities = result.activities;

  assert.ok(Array.isArray(activities));
  assert.equal(activities.length, 1);
  assert.equal(activities[0].type, "REJECTION");
  assert.equal(activities[0].releaseId, "release-240");
});
