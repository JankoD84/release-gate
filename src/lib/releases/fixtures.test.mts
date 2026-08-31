import assert from "node:assert/strict";
import test from "node:test";

import {
  getCiEvidenceByReleaseId,
  getReleaseById,
  getReleaseRecordById,
  getSecurityEvidenceByReleaseId,
  getTestEvidenceByReleaseId,
  RELEASE_RECORDS,
} from "./fixtures.ts";

test("all three synthetic releases exist", () => {
  assert.deepEqual(
    RELEASE_RECORDS.map((release) => release.id),
    ["release-240", "release-250", "release-260"],
  );
});

test("evidence exists for every release", () => {
  for (const release of RELEASE_RECORDS) {
    assert.ok(release.evidence.ci);
    assert.ok(release.evidence.tests);
    assert.ok(release.evidence.security);
    assert.ok(release.evidence.changeRisk);
  }
});

test("release-240 represents healthy evidence", () => {
  const release = getReleaseRecordById("release-240");

  assert.equal(release.ok, true);
  assert.equal(release.data.risk, "LOW");
  assert.equal(release.data.evidence.ci.status, "PASS");
  assert.equal(release.data.evidence.tests.status, "PASS");
  assert.equal(release.data.evidence.security.status, "PASS");
  assert.equal(release.data.evidence.changeRisk.level, "LOW");
});

test("release-250 contains exactly 6 flaky tests", () => {
  const tests = getTestEvidenceByReleaseId("release-250");

  assert.equal(tests.ok, true);
  assert.equal(tests.data.flaky, 6);
});

test("release-260 contains failed CI", () => {
  const ci = getCiEvidenceByReleaseId("release-260");

  assert.equal(ci.ok, true);
  assert.equal(ci.data.status, "FAIL");
  assert.ok(ci.data.failedJobs >= 1);
});

test("release-260 contains at least one high security finding", () => {
  const security = getSecurityEvidenceByReleaseId("release-260");

  assert.equal(security.ok, true);
  assert.ok(security.data.high >= 1);
});

test("unknown release lookup behaves deterministically", () => {
  const release = getReleaseById("release-does-not-exist");
  const ci = getCiEvidenceByReleaseId("release-does-not-exist");
  const security = getSecurityEvidenceByReleaseId("release-does-not-exist");

  for (const result of [release, ci, security]) {
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "RELEASE_NOT_FOUND");
    assert.equal(result.error.releaseId, "release-does-not-exist");
  }
});
