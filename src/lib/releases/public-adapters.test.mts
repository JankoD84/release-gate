import assert from "node:assert/strict";
import test from "node:test";

import { analyzeReleaseRecord } from "../decision/engine.ts";
import { GitHubPublicRepositoryAdapter, GitLabPublicRepositoryAdapter, mapProviderResponseError } from "./public-adapters.ts";
import { createEvidenceProvenance, safeProviderExternalUrl } from "./provenance.ts";
import { parsePublicRepositoryUrl } from "./repository.ts";
import type { ReleaseRecord } from "./types.ts";

function ref(url: string) {
  const parsed = parsePublicRepositoryUrl(url);
  assert.equal(parsed.ok, true);
  return parsed.reference;
}

function response(data: unknown, status = 200, headers?: HeadersInit): Response {
  return Response.json(data, { status, headers });
}

function fetchMap(routes: Record<string, Response>) {
  return async (input: string): Promise<Response> => {
    const route = routes[input];
    if (!route) return response({ message: `Missing mock for ${input}` }, 404);
    return route.clone();
  };
}

test("GitHub adapter normalizes repository metadata, releases, CI and change data", async () => {
  const reference = ref("https://github.com/example/project");
  const adapter = new GitHubPublicRepositoryAdapter(fetchMap({
    "https://api.github.com/repos/example/project": response({ default_branch: "main", description: "Example" }),
    "https://api.github.com/repos/example/project/releases?per_page=20": response([
      { id: 2, tag_name: "v2.0.0", name: "Release 2", published_at: "2026-02-01T00:00:00.000Z", target_commitish: "bbbb", html_url: "https://github.com/example/project/releases/tag/v2.0.0" },
      { id: 1, tag_name: "v1.0.0", name: "Release 1", published_at: "2026-01-01T00:00:00.000Z", target_commitish: "aaaa" },
    ]),
    "https://api.github.com/repos/example/project/actions/runs?head_sha=bbbb&per_page=20": response({ workflow_runs: [{ conclusion: "success", name: "Release CI", html_url: "https://github.com/example/project/actions/runs/1", updated_at: "2026-02-01T00:05:00.000Z" }] }),
    "https://api.github.com/repos/example/project/actions/runs?head_sha=aaaa&per_page=20": response({ workflow_runs: [] }),
    "https://api.github.com/repos/example/project/compare/aaaa...bbbb": response({ html_url: "https://github.com/example/project/compare/aaaa...bbbb", files: [{ filename: "src/app/page.tsx", additions: 5, deletions: 1 }] }),
  }));

  const result = await adapter.getSnapshot(reference);
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.repository.fullPath, "example/project");
  assert.equal(result.snapshot.releases.length, 2);
  assert.equal(result.snapshot.releases[0].version, "v2.0.0");
  assert.equal(result.snapshot.releases[0].evidence.ci.status, "PASS");
  assert.equal(result.snapshot.releases[0].evidence.tests.status, "NOT_AVAILABLE");
  assert.equal(result.snapshot.releases[0].evidence.security.status, "NOT_AVAILABLE");
  assert.equal(result.snapshot.releases[0].evidence.changeRisk.filesChanged, 1);
  assert.equal(result.snapshot.releases[0].provenance?.sourceType, "release");
  assert.equal(result.snapshot.releases[0].provenance?.externalUrl, "https://github.com/example/project/releases/tag/v2.0.0");
  assert.equal(result.snapshot.releases[0].evidence.ci.provenance?.sourceType, "workflow");
  assert.equal(result.snapshot.releases[0].evidence.ci.provenance?.externalUrl, "https://github.com/example/project/actions/runs/1");
  assert.equal(result.snapshot.releases[0].evidence.changeRisk.provenance?.sourceType, "compare");
  assert.equal(result.snapshot.releases[0].evidence.changeRisk.provenance?.externalUrl, "https://github.com/example/project/compare/aaaa...bbbb");
  assert.equal(result.snapshot.releases[0].evidence.tests.provenance, undefined);
  assert.equal(result.snapshot.releases[0].evidence.security.provenance, undefined);
});

test("GitHub adapter falls back to tags when releases are empty", async () => {
  const reference = ref("https://github.com/example/project.git");
  const adapter = new GitHubPublicRepositoryAdapter(fetchMap({
    "https://api.github.com/repos/example/project": response({ default_branch: "main" }),
    "https://api.github.com/repos/example/project/releases?per_page=20": response([]),
    "https://api.github.com/repos/example/project/tags?per_page=20": response([{ name: "v1", commit: { sha: "aaaa" } }]),
    "https://api.github.com/repos/example/project/actions/runs?head_sha=aaaa&per_page=20": response({ workflow_runs: [] }),
  }));

  const result = await adapter.getSnapshot(reference);
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.releases[0].version, "v1");
  assert.equal(result.snapshot.releases[0].provenance?.sourceType, "tag");
  assert.equal(result.snapshot.releases[0].provenance?.externalUrl, "https://github.com/example/project/releases/tag/v1");
  assert.equal(result.snapshot.releases[0].evidence.ci.status, "NOT_AVAILABLE");
});

test("GitHub repository not found and rate limits are typed", async () => {
  const reference = ref("https://github.com/example/missing");
  const notFound = await new GitHubPublicRepositoryAdapter(fetchMap({
    "https://api.github.com/repos/example/missing": response({ message: "Not Found" }, 404),
  })).getSnapshot(reference);

  assert.equal(notFound.ok, false);
  assert.equal(notFound.error.code, "REPOSITORY_NOT_FOUND");

  const rateLimited = mapProviderResponseError("github", response({ message: "limit" }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "123" }));
  assert.equal(rateLimited.code, "PROVIDER_RATE_LIMITED");
});

test("GitLab adapter normalizes nested namespace releases, pipelines and compare data", async () => {
  const reference = ref("https://gitlab.com/example/subgroup/project");
  const path = "example%2Fsubgroup%2Fproject";
  const adapter = new GitLabPublicRepositoryAdapter(fetchMap({
    [`https://gitlab.com/api/v4/projects/${path}`]: response({ default_branch: "main", description: "GitLab project" }),
    [`https://gitlab.com/api/v4/projects/${path}/releases?per_page=20`]: response([
      { tag_name: "v2", name: "Release 2", released_at: "2026-02-01T00:00:00.000Z", commit: { id: "bbbb" } },
      { tag_name: "v1", name: "Release 1", released_at: "2026-01-01T00:00:00.000Z", commit: { id: "aaaa" } },
    ]),
    [`https://gitlab.com/api/v4/projects/${path}/pipelines?sha=bbbb&per_page=20`]: response([{ status: "success", web_url: "https://gitlab.com/example/subgroup/project/-/pipelines/1", updated_at: "2026-02-01T00:05:00.000Z" }]),
    [`https://gitlab.com/api/v4/projects/${path}/pipelines?sha=aaaa&per_page=20`]: response([]),
    [`https://gitlab.com/api/v4/projects/${path}/repository/compare?from=aaaa&to=bbbb`]: response({ web_url: "https://gitlab.com/example/subgroup/project/-/compare/aaaa...bbbb", diffs: [{ new_path: "src/lib/releases/providers.ts", diff: "@@\n+added\n-old" }] }),
  }));

  const result = await adapter.getSnapshot(reference);
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.repository.namespace, "example/subgroup");
  assert.equal(result.snapshot.releases[0].evidence.ci.status, "PASS");
  assert.equal(result.snapshot.releases[0].evidence.changeRisk.filesChanged, 1);
  assert.equal(result.snapshot.releases[0].evidence.tests.status, "NOT_AVAILABLE");
  assert.equal(result.snapshot.releases[0].evidence.security.status, "NOT_AVAILABLE");
  assert.equal(result.snapshot.releases[0].provenance?.sourceType, "release");
  assert.equal(result.snapshot.releases[0].provenance?.externalUrl, "https://gitlab.com/example/subgroup/project/-/releases/v2");
  assert.equal(result.snapshot.releases[0].evidence.ci.provenance?.sourceType, "pipeline");
  assert.equal(result.snapshot.releases[0].evidence.ci.provenance?.externalUrl, "https://gitlab.com/example/subgroup/project/-/pipelines/1");
  assert.equal(result.snapshot.releases[0].evidence.changeRisk.provenance?.sourceType, "compare");
  assert.equal(result.snapshot.releases[0].evidence.changeRisk.provenance?.externalUrl, "https://gitlab.com/example/subgroup/project/-/compare/aaaa...bbbb");
});

test("GitLab adapter falls back to tags when release endpoint is unavailable", async () => {
  const reference = ref("https://gitlab.com/group/project/");
  const path = "group%2Fproject";
  const adapter = new GitLabPublicRepositoryAdapter(fetchMap({
    [`https://gitlab.com/api/v4/projects/${path}`]: response({ default_branch: "main" }),
    [`https://gitlab.com/api/v4/projects/${path}/releases?per_page=20`]: response({ message: "Forbidden" }, 403),
    [`https://gitlab.com/api/v4/projects/${path}/repository/tags?per_page=20`]: response([{ name: "v1", created_at: "2026-01-01T00:00:00.000Z", commit: { id: "aaaa" } }]),
    [`https://gitlab.com/api/v4/projects/${path}/pipelines?sha=aaaa&per_page=20`]: response([], 403),
  }));

  const result = await adapter.getSnapshot(reference);
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.releases[0].version, "v1");
  assert.equal(result.snapshot.releases[0].provenance?.sourceType, "tag");
  assert.equal(result.snapshot.releases[0].provenance?.externalUrl, "https://gitlab.com/group/project/-/tags/v1");
  assert.equal(result.snapshot.releases[0].evidence.ci.status, "NOT_AVAILABLE");
});

test("provider-normalized equivalent evidence produces equivalent domain behavior", () => {
  const base: Omit<ReleaseRecord, "id" | "name"> = {
    version: "v1",
    risk: "LOW",
    updatedAt: "2026-01-01T00:00:00.000Z",
    branch: "main",
    commitSha: "aaaa",
    evidence: {
      ci: { status: "PASS", workflow: "provider", totalJobs: 1, passedJobs: 1, failedJobs: 0, durationSeconds: 0 },
      tests: { status: "NOT_AVAILABLE", total: 0, passed: 0, failed: 0, flaky: 0, coveragePercent: null },
      security: { status: "NOT_AVAILABLE", critical: 0, high: 0, medium: 0, low: 0 },
      changeRisk: { level: "LOW", filesChanged: 1, linesAdded: 1, linesDeleted: 0, changedComponents: ["web"], reasons: ["same"] },
    },
  };

  const github = analyzeReleaseRecord({ ...base, id: "github:example%2Fproject:v1", name: "GitHub" }).data;
  const gitlab = analyzeReleaseRecord({ ...base, id: "gitlab:example%2Fproject:v1", name: "GitLab" }).data;

  assert.equal(github.decision, gitlab.decision);
  assert.equal(github.decision, "CONDITIONAL_GO");
  assert.deepEqual(github.warnings.map((warning) => warning.code), gitlab.warnings.map((warning) => warning.code));
  assert.deepEqual(github.requiredActions.map((action) => action.code), gitlab.requiredActions.map((action) => action.code));
});

test("safe provenance URLs allow only repository-facing GitHub and GitLab HTTPS links", () => {
  assert.equal(safeProviderExternalUrl("https://github.com/example/project/actions/runs/1"), "https://github.com/example/project/actions/runs/1");
  assert.equal(safeProviderExternalUrl("https://gitlab.com/example/project/-/pipelines/1"), "https://gitlab.com/example/project/-/pipelines/1");
  assert.equal(safeProviderExternalUrl("http://github.com/example/project"), undefined);
  assert.equal(safeProviderExternalUrl("javascript:alert(1)"), undefined);
  assert.equal(safeProviderExternalUrl("https://example.com/example/project"), undefined);
  assert.equal(safeProviderExternalUrl("https://user:pass@github.com/example/project"), undefined);
  assert.equal(safeProviderExternalUrl("https://127.0.0.1/example/project"), undefined);
});

test("invalid provenance external URL is omitted", () => {
  const provenance = createEvidenceProvenance({
    provider: "github",
    repository: "example/project",
    sourceType: "workflow",
    label: "GitHub Actions",
    externalUrl: "https://evil.example/run",
  });

  assert.equal(provenance.externalUrl, undefined);
});
