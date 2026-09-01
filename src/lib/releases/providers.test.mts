import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { getActivityLog, resetActivityLogForTests, setActivityStorageForTests } from "../decisions/activity-store.ts";
import { getFinalDecision, resetFinalDecisionStoreForTests, setFinalDecisionStorageForTests } from "../decisions/final-decision-store.ts";
import { setReleaseModeForTests } from "../mode.ts";
import { createWebMcpTools, webMcpToolCatalog } from "../webmcp/register-tools.ts";
import { getReleaseProvider, setLiveEvidenceFetchForTests } from "./providers.ts";
import { getDefaultRepositoryReference, setRepositoryReferenceForTests } from "./repository.ts";
import type { LiveEvidenceDocument } from "./live-evidence.ts";

class MemoryStorage implements Pick<Storage, "getItem" | "removeItem" | "setItem"> {
  readonly values = new Map<string, string>();
  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  removeItem(key: string): void { this.values.delete(key); }
  setItem(key: string, value: string): void { this.values.set(key, value); }
}

const executeOptions: WebMCP.ToolExecuteCallbackOptions = { signal: new AbortController().signal };
const sha = "6dcdc4ca80ae510f2e7f9727d814ca31b27a0180";
const liveReleaseId = `live-${sha}`;

function createLiveDocument(overrides: Partial<LiveEvidenceDocument["release"]["evidence"]> = {}): LiveEvidenceDocument {
  const generatedAt = "2026-08-31T12:00:00.000Z";
  return {
    schemaVersion: 1,
    source: "github-actions",
    repository: "JankoD84/release-gate",
    branch: "main",
    commitSha: sha,
    generatedAt,
    workflow: { name: "release-evidence", runId: "123", runUrl: "https://github.com/JankoD84/release-gate/actions/runs/123" },
    release: {
      id: liveReleaseId,
      version: "main@6dcdc4c",
      name: "Current live main release evidence",
      risk: "LOW",
      updatedAt: generatedAt,
      branch: "main",
      commitSha: sha,
      evidence: {
        ci: { status: "PASS", workflow: "release-evidence", totalJobs: 3, passedJobs: 3, failedJobs: 0, durationSeconds: 100 },
        tests: { status: "PASS", total: 52, passed: 52, failed: 0, flaky: 0, coveragePercent: null },
        security: { status: "PASS", critical: 0, high: 0, medium: 0, low: 0 },
        changeRisk: { level: "LOW", filesChanged: 1, linesAdded: 3, linesDeleted: 1, changedComponents: ["web"], reasons: ["Small localized change surface detected."] },
        ...overrides,
      },
    },
  };
}

function mockLiveFetch(document: LiveEvidenceDocument) {
  setLiveEvidenceFetchForTests(async () => Response.json({
    repository: {
      provider: "github",
      host: "github.com",
      namespace: "JankoD84",
      repository: "release-gate",
      fullPath: "JankoD84/release-gate",
      url: "https://github.com/JankoD84/release-gate",
      defaultBranch: "main",
      description: "Release Gate",
    },
    releases: [document.release],
    source: {
      repository: document.repository,
      branch: document.branch,
      commitSha: document.commitSha,
      generatedAt: document.generatedAt,
      workflow: { name: document.workflow.name, runUrl: document.workflow.runUrl },
    },
  }));
}

function getTool(name: string): WebMCP.ModelContextTool {
  const tool = createWebMcpTools().find((candidate) => candidate.name === name);
  assert.ok(tool);
  return tool;
}

async function executeTool(name: string, input: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
  const result = await getTool(name).execute(input, executeOptions);
  assert.equal(typeof result, "object");
  assert.notEqual(result, null);
  return result as Record<string, unknown>;
}

beforeEach(() => {
  const storage = new MemoryStorage();
  setFinalDecisionStorageForTests(storage);
  setActivityStorageForTests(storage);
  resetFinalDecisionStoreForTests();
  resetActivityLogForTests();
  setReleaseModeForTests("LIVE");
  setRepositoryReferenceForTests(getDefaultRepositoryReference());
  mockLiveFetch(createLiveDocument());
});

test("mode selection defaults WebMCP execution to active LIVE without duplicate catalog", async () => {
  assert.equal(webMcpToolCatalog.length, 11);
  const result = await executeTool("list_releases");
  const releases = result.releases as Record<string, unknown>[];

  assert.equal(result.mode, "LIVE");
  assert.equal(releases.length, 1);
  assert.equal(releases[0].id, liveReleaseId);
});

test("live provider returns current release and evidence tools", async () => {
  const provider = getReleaseProvider("LIVE");
  const ci = await provider.getCiEvidence(liveReleaseId);
  const tests = await provider.getTestEvidence(liveReleaseId);
  const security = await provider.getSecurityEvidence(liveReleaseId);
  const changeRisk = await provider.getChangeRiskEvidence(liveReleaseId);

  assert.equal(ci.ok, true);
  assert.equal(tests.ok, true);
  assert.equal(tests.data.coveragePercent, null);
  assert.equal(security.ok, true);
  assert.equal(changeRisk.ok, true);
});

test("live analyze_release is read-only and keeps final decision pending", async () => {
  const result = await executeTool("analyze_release", { releaseId: liveReleaseId });
  const analysis = result.analysis as Record<string, unknown>;

  assert.equal(analysis.decision, "GO");
  assert.equal(getFinalDecision(liveReleaseId).status, "PENDING");
  assert.equal(getActivityLog(undefined, "LIVE").activities.length, 0);
});

test("live approval requires acknowledgement and stores commit-specific decision", async () => {
  const missingAck = await executeTool("approve_release", { releaseId: liveReleaseId, acknowledgement: false });
  assert.equal(missingAck.ok, false);
  assert.equal((missingAck.error as Record<string, unknown>).code, "HUMAN_ACKNOWLEDGEMENT_REQUIRED");

  const approved = await executeTool("approve_release", { releaseId: liveReleaseId, acknowledgement: true });
  assert.equal(approved.ok, true);
  assert.equal(getFinalDecision(liveReleaseId).status, "DECIDED");
  assert.equal(getFinalDecision("live-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa").status, "PENDING");
});

test("live NO_GO approval remains blocked", async () => {
  mockLiveFetch(createLiveDocument({ security: { status: "FAIL", critical: 0, high: 1, medium: 0, low: 0 } }));
  const result = await executeTool("approve_release", { releaseId: liveReleaseId, acknowledgement: true });

  assert.equal(result.ok, false);
  assert.equal((result.error as Record<string, unknown>).code, "RELEASE_BLOCKED");
});

test("stale live release IDs are rejected without fallback", async () => {
  const result = await executeTool("reject_release", { releaseId: "live-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", reason: "stale" });

  assert.equal(result.ok, false);
  assert.equal((result.error as Record<string, unknown>).code, "RELEASE_NOT_FOUND");
});

test("unavailable live evidence does not silently fall back to demo", async () => {
  setLiveEvidenceFetchForTests(async () => Response.json({ code: "PROVIDER_UNAVAILABLE", message: "missing" }, { status: 503 }));
  const result = await executeTool("list_releases");

  assert.equal((result.error as Record<string, unknown>).code, "PROVIDER_UNAVAILABLE");
});
