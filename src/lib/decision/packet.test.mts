import assert from "node:assert/strict";
import { beforeEach, test } from "node:test";

import { approveRelease, getFinalDecision, rejectRelease, resetFinalDecisionStoreForTests, setFinalDecisionStorageForTests } from "../decisions/final-decision-store.ts";
import { getReleaseRecordById } from "../releases/fixtures.ts";
import { parsePublicRepositoryUrl } from "../releases/repository.ts";
import { analyzeRelease } from "./engine.ts";
import { createReleaseDecisionPacket, createReleaseDecisionPacketMarkdown } from "./packet.ts";

const generatedAt = "2026-09-01T12:00:00.000Z";

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

beforeEach(() => {
  setFinalDecisionStorageForTests(new MemoryStorage());
  resetFinalDecisionStoreForTests();
});

function packetFor(releaseId: string) {
  const release = getReleaseRecordById(releaseId);
  const analysis = analyzeRelease(releaseId, { evaluatedAt: generatedAt });
  const repository = parsePublicRepositoryUrl("https://github.com/example/project");

  assert.equal(release.ok, true);
  assert.equal(analysis.ok, true);
  assert.equal(repository.ok, true);

  return createReleaseDecisionPacket({
    mode: "LIVE",
    repository: repository.reference,
    release: release.data,
    analysis: analysis.data,
    humanDecision: getFinalDecision(releaseId),
    generatedAt,
  });
}

test("packet preserves GO system recommendation with pending human decision", () => {
  const packet = packetFor("release-240");

  assert.equal(packet.schemaVersion, 1);
  assert.equal(packet.repository.provider, "github");
  assert.equal(packet.repository.fullPath, "example/project");
  assert.equal(packet.systemRecommendation.decision, "GO");
  assert.equal(packet.humanDecision.status, "PENDING");
  assert.deepEqual(packet.requiredActions, []);
});

test("packet preserves CONDITIONAL_GO with pending decision and required actions", () => {
  const packet = packetFor("release-250");

  assert.equal(packet.systemRecommendation.decision, "CONDITIONAL_GO");
  assert.equal(packet.humanDecision.status, "PENDING");
  assert.ok(packet.requiredActions.some((action) => action.code === "INVESTIGATE_FLAKY_TESTS"));
});

test("packet preserves NO_GO pending state after blocked approval", () => {
  const blocked = approveRelease("release-260", true, { now: () => generatedAt });
  const packet = packetFor("release-260");

  assert.equal(blocked.ok, false);
  assert.equal(blocked.error.code, "RELEASE_BLOCKED");
  assert.equal(packet.systemRecommendation.decision, "NO_GO");
  assert.deepEqual(packet.humanDecision, { releaseId: "release-260", status: "PENDING" });
  assert.ok(packet.requiredActions.some((action) => action.code === "FIX_CI"));
});

test("packet includes approved CONDITIONAL_GO human final decision", () => {
  approveRelease("release-250", true, { now: () => generatedAt });
  const packet = packetFor("release-250");

  assert.equal(packet.systemRecommendation.decision, "CONDITIONAL_GO");
  assert.equal(packet.humanDecision.status, "DECIDED");
  if (packet.humanDecision.status === "DECIDED") {
    assert.equal(packet.humanDecision.decision.action, "APPROVE");
    assert.equal(packet.humanDecision.decision.finalDecision, "CONDITIONAL_GO");
  }
});

test("packet includes human rejected GO without changing system recommendation", () => {
  rejectRelease("release-240", "Postponed.", { now: () => generatedAt });
  const packet = packetFor("release-240");

  assert.equal(packet.systemRecommendation.decision, "GO");
  assert.equal(packet.humanDecision.status, "DECIDED");
  if (packet.humanDecision.status === "DECIDED") {
    assert.equal(packet.humanDecision.decision.action, "REJECT");
    assert.equal(packet.humanDecision.decision.finalDecision, "NO_GO");
  }
});

test("markdown packet contains repository, recommendation, actions, and human final decision", () => {
  const markdown = createReleaseDecisionPacketMarkdown(packetFor("release-250"));

  assert.match(markdown, /Repository: GitHub \/ example\/project/);
  assert.match(markdown, /CONDITIONAL GO/);
  assert.match(markdown, /Investigate flaky tests/);
  assert.match(markdown, /Human Final Decision/);
  assert.match(markdown, /PENDING/);
});

test("JSON packet contains no environment or secret-shaped internals", () => {
  const json = JSON.stringify(packetFor("release-250"));

  assert.doesNotMatch(json, /process\.env|localStorage|API_KEY|TOKEN|SECRET/i);
});
