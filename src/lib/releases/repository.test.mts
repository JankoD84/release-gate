import assert from "node:assert/strict";
import test from "node:test";

import { createCanonicalReleaseId, normalizeReleaseIdRouteParam, releaseDetailHref } from "./release-id.ts";
import { parsePublicRepositoryUrl } from "./repository.ts";

function parseOk(url: string) {
  const result = parsePublicRepositoryUrl(url);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.reference;
}

function parseError(url: string) {
  const result = parsePublicRepositoryUrl(url);
  assert.equal(result.ok, false, JSON.stringify(result));
  return result.error;
}

test("parses valid GitHub repository URLs", () => {
  assert.deepEqual(parseOk("https://github.com/example/project"), {
    provider: "github",
    host: "github.com",
    namespace: "example",
    repository: "project",
    fullPath: "example/project",
    url: "https://github.com/example/project",
  });

  assert.equal(parseOk("https://github.com/example/project/").url, "https://github.com/example/project");
  assert.equal(parseOk("https://github.com/example/project.git").repository, "project");
});

test("parses valid GitLab repository URLs including nested namespaces", () => {
  assert.equal(parseOk("https://gitlab.com/example/project").fullPath, "example/project");
  assert.equal(parseOk("https://gitlab.com/example/subgroup/project").namespace, "example/subgroup");
  assert.equal(parseOk("https://gitlab.com/a/b/c/d/project.git").fullPath, "a/b/c/d/project");
});

test("rejects invalid and unsafe repository URLs", () => {
  for (const url of [
    "http://github.com/example/project",
    "https://github.com/example",
    "https://github.com/example/project/issues",
    "https://github.com/example/project%2Fother",
    "https://github.com/example/project%20name",
    "https://user:pass@github.com/example/project",
    "javascript:alert(1)",
    "file:///tmp/repo",
    "data:text/plain,repo",
    "https://localhost/example/project",
    "https://127.0.0.1/example/project",
    "https://gitlab.example.com/example/project",
  ]) {
    const error = parseError(url);
    assert.ok(error.code === "INVALID_REPOSITORY_URL" || error.code === "UNSUPPORTED_REPOSITORY_PROVIDER", url);
  }
});

test("classifies unsupported providers distinctly", () => {
  assert.equal(parseError("https://bitbucket.org/example/project").code, "UNSUPPORTED_REPOSITORY_PROVIDER");
});

function nextRouteParamFromRenderedHref(href: string): string {
  const routeSegment = href.replace("/releases/", "");
  return encodeURIComponent(routeSegment);
}

test("canonical GitHub PR candidate ID survives actual dashboard to detail route transport", () => {
  const reference = parseOk("https://github.com/JankoD84/release-gate");
  const canonical = createCanonicalReleaseId(reference, "pr", 1);
  const href = releaseDetailHref(canonical);
  const actualRouteParam = nextRouteParamFromRenderedHref(href);
  const normalized = normalizeReleaseIdRouteParam(actualRouteParam);

  assert.equal(canonical, "github:JankoD84/release-gate:pr:1");
  assert.equal(href.startsWith("/releases/rid_"), true);
  assert.equal(href.includes("%"), false);
  assert.equal(actualRouteParam, href.replace("/releases/", ""));
  assert.equal(normalized.ok, true);
  assert.equal(normalized.releaseId, canonical);
});

test("legacy percent-encoded route representation is not recursively decoded", () => {
  const canonical = "github:JankoD84/release-gate:pr:1";
  const onceEncoded = encodeURIComponent(canonical);
  const actualDoubleEncodedRouteParam = encodeURIComponent(onceEncoded);

  const normalized = normalizeReleaseIdRouteParam(actualDoubleEncodedRouteParam);

  assert.equal(normalized.ok, true);
  assert.equal(normalized.releaseId, onceEncoded);
  assert.notEqual(normalized.releaseId, canonical);
});

test("canonical GitLab MR candidate ID survives actual dashboard to detail route transport", () => {
  const reference = parseOk("https://gitlab.com/group/subgroup/project");
  const canonical = createCanonicalReleaseId(reference, "mr", 17);
  const normalized = normalizeReleaseIdRouteParam(nextRouteParamFromRenderedHref(releaseDetailHref(canonical)));

  assert.equal(canonical, "gitlab:group/subgroup/project:mr:17");
  assert.equal(normalized.ok, true);
  assert.equal(normalized.releaseId, canonical);
});

test("release and tag candidate IDs remain route functional with special characters", () => {
  const github = parseOk("https://github.com/example/project");
  const gitlab = parseOk("https://gitlab.com/example/project");
  const release = createCanonicalReleaseId(github, "release", "release/v1.2.3");
  const tag = createCanonicalReleaseId(gitlab, "tag", "v1.2.3!rc1");

  const normalizedRelease = normalizeReleaseIdRouteParam(nextRouteParamFromRenderedHref(releaseDetailHref(release)));
  const normalizedTag = normalizeReleaseIdRouteParam(nextRouteParamFromRenderedHref(releaseDetailHref(tag)));

  assert.equal(normalizedRelease.ok, true);
  assert.equal(normalizedRelease.releaseId, release);
  assert.equal(normalizedTag.ok, true);
  assert.equal(normalizedTag.releaseId, tag);
});

test("unknown canonical release ID remains RELEASE_NOT_FOUND in provider lookup", () => {
  const missing = normalizeReleaseIdRouteParam(encodeURIComponent("github:example/project:pr:999"));

  assert.equal(missing.ok, true);
  assert.equal(missing.releaseId, "github:example/project:pr:999");
});

test("malformed percent encoding does not crash route release ID normalization", () => {
  const malformed = normalizeReleaseIdRouteParam("github%3Aexample%2");

  assert.equal(malformed.ok, false);
  assert.equal(malformed.error.code, "RELEASE_NOT_FOUND");
  assert.equal(malformed.error.releaseId, "github%3Aexample%2");
});
