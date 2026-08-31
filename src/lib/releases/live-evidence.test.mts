import assert from "node:assert/strict";
import test from "node:test";

import { analyzeReleaseRecord } from "../decision/engine.ts";
import { RELEASE_RECORDS } from "./fixtures.ts";
import {
  deriveChangedComponents,
  normalizeGitChangeRisk,
  validateLiveEvidenceDocument,
} from "./live-evidence.ts";
import type { LiveEvidenceDocument } from "./live-evidence.ts";

const sha = "6dcdc4ca80ae510f2e7f9727d814ca31b27a0180";

const liveDocument: LiveEvidenceDocument = {
  schemaVersion: 1,
  source: "github-actions",
  repository: "JankoD84/release-gate",
  branch: "main",
  commitSha: sha,
  generatedAt: "2026-08-31T12:00:00.000Z",
  workflow: {
    name: "release-evidence",
    runId: "123",
    runUrl: "https://github.com/JankoD84/release-gate/actions/runs/123",
  },
  release: {
    id: `live-${sha}`,
    version: "main@6dcdc4c",
    name: "Current live main release evidence",
    risk: "LOW",
    updatedAt: "2026-08-31T12:00:00.000Z",
    branch: "main",
    commitSha: sha,
    evidence: {
      ci: {
        status: "PASS",
        workflow: "release-evidence",
        totalJobs: 3,
        passedJobs: 3,
        failedJobs: 0,
        durationSeconds: 100,
      },
      tests: {
        status: "PASS",
        total: 52,
        passed: 52,
        failed: 0,
        flaky: 0,
        coveragePercent: null,
      },
      security: {
        status: "PASS",
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      },
      changeRisk: {
        level: "LOW",
        filesChanged: 1,
        linesAdded: 3,
        linesDeleted: 1,
        changedComponents: ["web"],
        reasons: ["Small localized change surface detected."],
      },
    },
  },
};

test("live evidence payload validation accepts complete current SHA document", () => {
  const result = validateLiveEvidenceDocument(liveDocument);

  assert.equal(result.ok, true);
  assert.equal(result.document.release.id, `live-${sha}`);
});

test("live evidence payload validation rejects malformed or mismatched identity", () => {
  const result = validateLiveEvidenceDocument({ ...liveDocument, release: { ...liveDocument.release, id: "live-main" } });

  assert.equal(result.ok, false);
  assert.equal(result.error.code, "LIVE_EVIDENCE_INVALID");
});

test("coverage unavailable does not change decision behavior", () => {
  const analysis = analyzeReleaseRecord(liveDocument.release, { evaluatedAt: "2026-08-31T12:00:00.000Z" });

  assert.equal(analysis.data.decision, "GO");
  assert.equal(liveDocument.release.evidence.tests.coveragePercent, null);
});

test("demo provider fixture coverage remains unchanged", () => {
  assert.deepEqual(
    RELEASE_RECORDS.map((release) => release.evidence.tests.coveragePercent),
    [91, 86, 79],
  );
});

test("changed components are derived deterministically from paths", () => {
  assert.deepEqual(
    deriveChangedComponents([
      "src/app/page.tsx",
      "src/components/release-gate/ui.tsx",
      "src/lib/webmcp/register-tools.ts",
      "src/lib/decision/engine.ts",
      "src/lib/releases/fixtures.ts",
      ".github/workflows/release-evidence.yml",
      "README.md",
    ]),
    ["agent-interface", "ci", "docs", "release-data", "release-orchestration", "web"],
  );
});

test("change-risk normalization evaluates change surface only", () => {
  const risk = normalizeGitChangeRisk({
    filesChanged: 2,
    linesAdded: 10,
    linesDeleted: 5,
    changedFiles: ["src/lib/webmcp/register-tools.ts", "README.md"],
  });

  assert.equal(risk.level, "MEDIUM");
  assert.ok(risk.changedComponents.includes("agent-interface"));
});
