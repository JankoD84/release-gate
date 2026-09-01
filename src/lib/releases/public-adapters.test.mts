import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { analyzeReleaseRecord } from "../decision/engine.ts";
import { GitHubPublicRepositoryAdapter, GitLabPublicRepositoryAdapter, mapProviderResponseError, resetGitHubProviderCacheForTests } from "./public-adapters.ts";
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

afterEach(() => {
  delete process.env.GITHUB_TOKEN;
});

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

test("GitHub adapter discovers open pull requests as primary candidates", async () => {
  const reference = ref("https://github.com/example/project");
  const calls: string[] = [];
  const fetcher = async (input: string, init?: RequestInit): Promise<Response> => {
    assert.notEqual(init?.method, "POST");
    assert.notEqual(init?.method, "PATCH");
    calls.push(input);
    return fetchMap({
      "https://api.github.com/repos/example/project": response({ default_branch: "main", description: "Example" }),
      "https://api.github.com/repos/example/project/pulls?state=open&per_page=20": response([
        { number: 42, title: "Payment refactor", base: { ref: "main" }, head: { ref: "feature/payments", sha: "bbbb" }, html_url: "https://github.com/example/project/pull/42", updated_at: "2026-03-01T00:00:00.000Z" },
        { number: 43, title: "Docs update", base: { ref: "main" }, head: { ref: "docs/readme", sha: "cccc" }, html_url: "https://github.com/example/project/pull/43", updated_at: "2026-03-02T00:00:00.000Z" },
      ]),
      "https://api.github.com/repos/example/project/pulls/42": response({ number: 42, title: "Payment refactor", base: { ref: "main" }, head: { ref: "feature/payments", sha: "bbbb" }, html_url: "https://github.com/example/project/pull/42", changed_files: 2, additions: 12, deletions: 3, updated_at: "2026-03-01T00:00:00.000Z" }),
      "https://api.github.com/repos/example/project/pulls/42/files?per_page=100": response([{ filename: "src/app/payments/page.tsx", additions: 10, deletions: 2 }, { filename: "src/lib/decision/engine.ts", additions: 2, deletions: 1 }]),
      "https://api.github.com/repos/example/project/pulls/43": response({ number: 43, title: "Docs update", base: { ref: "main" }, head: { ref: "docs/readme", sha: "cccc" }, html_url: "https://github.com/example/project/pull/43", changed_files: 1, additions: 4, deletions: 0, updated_at: "2026-03-02T00:00:00.000Z" }),
      "https://api.github.com/repos/example/project/pulls/43/files?per_page=100": response([{ filename: "README.md", additions: 4, deletions: 0 }]),
      "https://api.github.com/repos/example/project/actions/runs?head_sha=bbbb&per_page=20": response({ workflow_runs: [{ conclusion: "success", name: "PR CI", html_url: "https://github.com/example/project/actions/runs/42", updated_at: "2026-03-01T00:05:00.000Z" }] }),
      "https://api.github.com/repos/example/project/actions/runs?head_sha=cccc&per_page=20": response({ workflow_runs: [{ conclusion: "failure", name: "PR CI", html_url: "https://github.com/example/project/actions/runs/43", updated_at: "2026-03-02T00:05:00.000Z" }] }),
    } as Record<string, Response>)(input);
  };
  const result = await new GitHubPublicRepositoryAdapter(fetcher).getSnapshot(reference);

  assert.equal(result.ok, true);
  assert.equal(result.snapshot.releases.length, 2);
  assert.equal(result.snapshot.releases[0].id, "github:example/project:pr:42");
  assert.equal(result.snapshot.releases[0].version, "PR #42");
  assert.equal(result.snapshot.releases[0].name, "Payment refactor");
  assert.equal(result.snapshot.releases[0].branch, "main");
  assert.equal(result.snapshot.releases[0].commitSha, "bbbb");
  assert.equal(result.snapshot.releases[0].candidate?.candidateType, "PULL_REQUEST");
  assert.equal(result.snapshot.releases[0].candidate?.candidateNumber, 42);
  assert.equal(result.snapshot.releases[0].candidate?.baseBranch, "main");
  assert.equal(result.snapshot.releases[0].candidate?.headBranch, "feature/payments");
  assert.equal(result.snapshot.releases[0].candidate?.headSha, "bbbb");
  assert.equal(result.snapshot.releases[0].candidate?.publicUrl, "https://github.com/example/project/pull/42");
  assert.equal(result.snapshot.releases[0].evidence.ci.status, "PASS");
  assert.equal(result.snapshot.releases[1].evidence.ci.status, "FAIL");
  assert.equal(result.snapshot.releases[0].evidence.changeRisk.filesChanged, 2);
  assert.equal(result.snapshot.releases[0].evidence.changeRisk.linesAdded, 12);
  assert.equal(result.snapshot.releases[0].evidence.changeRisk.linesDeleted, 3);
  assert.deepEqual(result.snapshot.releases[0].evidence.changeRisk.changedComponents, ["release-orchestration", "web"]);
  assert.equal(result.snapshot.releases[0].provenance?.label, "GitHub Pull Request");
  assert.equal(result.snapshot.releases[0].evidence.ci.provenance?.label, "PR CI");
  assert.equal(result.snapshot.releases[0].evidence.changeRisk.provenance?.label, "GitHub Pull Request changes");
  assert.ok(!calls.some((call) => call.includes("/releases?per_page=20")), "open PRs should prevent release fallback calls");
});

test("GitHub pull request CI remains NOT_AVAILABLE when public checks are unavailable", async () => {
  const reference = ref("https://github.com/example/project");
  const adapter = new GitHubPublicRepositoryAdapter(fetchMap({
    "https://api.github.com/repos/example/project": response({ default_branch: "main" }),
    "https://api.github.com/repos/example/project/pulls?state=open&per_page=20": response([{ number: 44, title: "No CI", base: { ref: "main" }, head: { ref: "feature/no-ci", sha: "dddd" }, html_url: "https://github.com/example/project/pull/44" }]),
    "https://api.github.com/repos/example/project/pulls/44": response({ number: 44, title: "No CI", base: { ref: "main" }, head: { ref: "feature/no-ci", sha: "dddd" }, changed_files: 1, additions: 1, deletions: 0, html_url: "https://github.com/example/project/pull/44" }),
    "https://api.github.com/repos/example/project/pulls/44/files?per_page=100": response([{ filename: "src/app/page.tsx", additions: 1, deletions: 0 }]),
    "https://api.github.com/repos/example/project/actions/runs?head_sha=dddd&per_page=20": response({ workflow_runs: [] }),
  }));

  const result = await adapter.getSnapshot(reference);
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.releases[0].evidence.ci.status, "NOT_AVAILABLE");
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

  const rateLimited = mapProviderResponseError("github", response({ message: "limit" }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1893456000" }));
  assert.equal(rateLimited.code, "PROVIDER_RATE_LIMITED");
  assert.equal(rateLimited.rateLimitResetAt, "2030-01-01T00:00:00.000Z");
  assert.match(rateLimited.message, /Try again after 2030-01-01T00:00:00\.000Z/);
});

test("GitHub adapter sends authenticated server header only when GITHUB_TOKEN exists", async () => {
  const reference = ref("https://github.com/example/project");
  const seenAuthHeaders: Array<string | undefined> = [];
  const routes = {
    "https://api.github.com/repos/example/project": response({ default_branch: "main" }),
    "https://api.github.com/repos/example/project/pulls?state=open&per_page=20": response([]),
    "https://api.github.com/repos/example/project/releases?per_page=20": response([]),
    "https://api.github.com/repos/example/project/tags?per_page=20": response([]),
  };
  const fetcher = async (input: string, init?: RequestInit): Promise<Response> => {
    seenAuthHeaders.push(new Headers(init?.headers).get("authorization") ?? undefined);
    return fetchMap(routes)(input);
  };

  await new GitHubPublicRepositoryAdapter(fetcher).getSnapshot(reference);
  assert.ok(seenAuthHeaders.every((header) => header === undefined));

  resetGitHubProviderCacheForTests(fetcher);
  seenAuthHeaders.length = 0;
  process.env.GITHUB_TOKEN = "test-token-never-print";

  await new GitHubPublicRepositoryAdapter(fetcher).getSnapshot(reference);
  assert.ok(seenAuthHeaders.every((header) => header === "Bearer test-token-never-print"));
});

test("GitHub token does not expand LIVE mode to private repository evidence", async () => {
  process.env.GITHUB_TOKEN = "test-token-never-print";
  const reference = ref("https://github.com/example/private-project");
  const calls: string[] = [];
  const fetcher = async (input: string): Promise<Response> => {
    calls.push(input);
    return fetchMap({
      "https://api.github.com/repos/example/private-project": response({ default_branch: "main", private: true }),
    })(input);
  };

  const result = await new GitHubPublicRepositoryAdapter(fetcher).getSnapshot(reference);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "REPOSITORY_NOT_FOUND");
  assert.deepEqual(calls, ["https://api.github.com/repos/example/private-project"]);
});

test("GitHub adapter never exposes token in normalized outputs or typed errors", async () => {
  const secret = "test-token-never-print";
  process.env.GITHUB_TOKEN = secret;
  const reference = ref("https://github.com/example/project");
  const routes = {
    "https://api.github.com/repos/example/project": response({ default_branch: "main", description: "Example" }),
    "https://api.github.com/repos/example/project/pulls?state=open&per_page=20": response([]),
    "https://api.github.com/repos/example/project/releases?per_page=20": response([]),
    "https://api.github.com/repos/example/project/tags?per_page=20": response([{ name: "v1", commit: { sha: "aaaa" } }]),
    "https://api.github.com/repos/example/project/actions/runs?head_sha=aaaa&per_page=20": response({ workflow_runs: [] }),
  };
  const snapshot = await new GitHubPublicRepositoryAdapter(fetchMap(routes)).getSnapshot(reference);
  assert.equal(snapshot.ok, true);
  assert.doesNotMatch(JSON.stringify(snapshot), new RegExp(secret));

  const rateLimited = mapProviderResponseError("github", response({ message: "limit" }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1893456000" }));
  assert.doesNotMatch(JSON.stringify(rateLimited), new RegExp(secret));
});

test("GitHub adapter deduplicates cached identical requests including in-flight analyses", async () => {
  const reference = ref("https://github.com/example/project");
  const calls = new Map<string, number>();
  const routes = {
    "https://api.github.com/repos/example/project": response({ default_branch: "main" }),
    "https://api.github.com/repos/example/project/pulls?state=open&per_page=20": response([]),
    "https://api.github.com/repos/example/project/releases?per_page=20": response([]),
    "https://api.github.com/repos/example/project/tags?per_page=20": response([{ name: "v1", commit: { sha: "aaaa" } }]),
    "https://api.github.com/repos/example/project/actions/runs?head_sha=aaaa&per_page=20": response({ workflow_runs: [] }),
  };
  const fetcher = async (input: string): Promise<Response> => {
    calls.set(input, (calls.get(input) ?? 0) + 1);
    await Promise.resolve();
    return fetchMap(routes)(input);
  };
  const adapter = new GitHubPublicRepositoryAdapter(fetcher);

  const [first, second] = await Promise.all([adapter.getSnapshot(reference), adapter.getSnapshot(reference)]);
  assert.equal(first.ok, true);
  assert.equal(second.ok, true);
  assert.equal(calls.get("https://api.github.com/repos/example/project"), 1);

  await adapter.getSnapshot(reference);
  assert.equal(calls.get("https://api.github.com/repos/example/project"), 1);
});

test("GitHub provider cache keys isolate repositories and PR candidates", async () => {
  const one = ref("https://github.com/example/one");
  const two = ref("https://github.com/example/two");
  const calls: string[] = [];
  const routes = {
    "https://api.github.com/repos/example/one": response({ default_branch: "main" }),
    "https://api.github.com/repos/example/one/pulls?state=open&per_page=20": response([
      { number: 1, title: "One", base: { ref: "main" }, head: { ref: "a", sha: "aaaa" }, html_url: "https://github.com/example/one/pull/1" },
      { number: 2, title: "Two", base: { ref: "main" }, head: { ref: "b", sha: "bbbb" }, html_url: "https://github.com/example/one/pull/2" },
    ]),
    "https://api.github.com/repos/example/one/pulls/1": response({ number: 1, base: { ref: "main" }, head: { sha: "aaaa" }, changed_files: 0, additions: 0, deletions: 0 }),
    "https://api.github.com/repos/example/one/pulls/1/files?per_page=100": response([]),
    "https://api.github.com/repos/example/one/pulls/2": response({ number: 2, base: { ref: "main" }, head: { sha: "bbbb" }, changed_files: 0, additions: 0, deletions: 0 }),
    "https://api.github.com/repos/example/one/pulls/2/files?per_page=100": response([]),
    "https://api.github.com/repos/example/one/actions/runs?head_sha=aaaa&per_page=20": response({ workflow_runs: [] }),
    "https://api.github.com/repos/example/one/actions/runs?head_sha=bbbb&per_page=20": response({ workflow_runs: [] }),
    "https://api.github.com/repos/example/two": response({ default_branch: "main" }),
    "https://api.github.com/repos/example/two/pulls?state=open&per_page=20": response([]),
    "https://api.github.com/repos/example/two/releases?per_page=20": response([]),
    "https://api.github.com/repos/example/two/tags?per_page=20": response([]),
  };
  const fetcher = async (input: string): Promise<Response> => {
    calls.push(input);
    return fetchMap(routes)(input);
  };
  const adapter = new GitHubPublicRepositoryAdapter(fetcher);

  const oneResult = await adapter.getSnapshot(one);
  const twoResult = await adapter.getSnapshot(two);
  assert.equal(oneResult.ok, true);
  assert.equal(twoResult.ok, true);
  assert.ok(calls.includes("https://api.github.com/repos/example/one"));
  assert.ok(calls.includes("https://api.github.com/repos/example/two"));
  assert.ok(calls.includes("https://api.github.com/repos/example/one/pulls/1"));
  assert.ok(calls.includes("https://api.github.com/repos/example/one/pulls/2"));
});

test("GitHub rate limit remains typed without uncontrolled retries", async () => {
  const reference = ref("https://github.com/example/limited");
  let callCount = 0;
  const fetcher = async (): Promise<Response> => {
    callCount += 1;
    return response({ message: "limit" }, 403, { "x-ratelimit-remaining": "0", "x-ratelimit-reset": "1893456000" });
  };

  const result = await new GitHubPublicRepositoryAdapter(fetcher).getSnapshot(reference);
  assert.equal(result.ok, false);
  assert.equal(result.error.code, "PROVIDER_RATE_LIMITED");
  assert.equal(result.error.rateLimitResetAt, "2030-01-01T00:00:00.000Z");
  assert.equal(callCount, 1);
});

test("GitLab adapter discovers open merge requests as primary candidates", async () => {
  const reference = ref("https://gitlab.com/example/subgroup/project");
  const path = "example%2Fsubgroup%2Fproject";
  const calls: string[] = [];
  const fetcher = async (input: string, init?: RequestInit): Promise<Response> => {
    assert.notEqual(init?.method, "POST");
    assert.notEqual(init?.method, "PUT");
    calls.push(input);
    return fetchMap({
      [`https://gitlab.com/api/v4/projects/${path}`]: response({ default_branch: "main", description: "GitLab project" }),
      [`https://gitlab.com/api/v4/projects/${path}/merge_requests?state=opened&per_page=20`]: response([
        { iid: 17, title: "Payment refactor", target_branch: "main", source_branch: "feature/payments", sha: "bbbb", web_url: "https://gitlab.com/example/subgroup/project/-/merge_requests/17", updated_at: "2026-03-01T00:00:00.000Z" },
        { iid: 18, title: "Failing change", target_branch: "main", source_branch: "feature/fail", sha: "cccc", web_url: "https://gitlab.com/example/subgroup/project/-/merge_requests/18", updated_at: "2026-03-02T00:00:00.000Z" },
      ]),
      [`https://gitlab.com/api/v4/projects/${path}/merge_requests/17/changes`]: response({ iid: 17, title: "Payment refactor", target_branch: "main", source_branch: "feature/payments", sha: "bbbb", web_url: "https://gitlab.com/example/subgroup/project/-/merge_requests/17", changes: [{ new_path: "src/app/payments/page.tsx", diff: "@@\n+added\n-old" }] }),
      [`https://gitlab.com/api/v4/projects/${path}/merge_requests/18/changes`]: response({ iid: 18, title: "Failing change", target_branch: "main", source_branch: "feature/fail", sha: "cccc", web_url: "https://gitlab.com/example/subgroup/project/-/merge_requests/18", changes: [{ new_path: "src/lib/webmcp/register-tools.ts", diff: "@@\n+added" }] }),
      [`https://gitlab.com/api/v4/projects/${path}/merge_requests/17/pipelines?per_page=20`]: response([{ status: "success", web_url: "https://gitlab.com/example/subgroup/project/-/pipelines/17", updated_at: "2026-03-01T00:05:00.000Z" }]),
      [`https://gitlab.com/api/v4/projects/${path}/merge_requests/18/pipelines?per_page=20`]: response([{ status: "failed", web_url: "https://gitlab.com/example/subgroup/project/-/pipelines/18", updated_at: "2026-03-02T00:05:00.000Z" }]),
    } as Record<string, Response>)(input);
  };
  const result = await new GitLabPublicRepositoryAdapter(fetcher).getSnapshot(reference);

  assert.equal(result.ok, true);
  assert.equal(result.snapshot.repository.namespace, "example/subgroup");
  assert.equal(result.snapshot.releases.length, 2);
  assert.equal(result.snapshot.releases[0].id, "gitlab:example/subgroup/project:mr:17");
  assert.equal(result.snapshot.releases[0].version, "MR !17");
  assert.equal(result.snapshot.releases[0].candidate?.candidateType, "MERGE_REQUEST");
  assert.equal(result.snapshot.releases[0].candidate?.candidateNumber, 17);
  assert.equal(result.snapshot.releases[0].candidate?.baseBranch, "main");
  assert.equal(result.snapshot.releases[0].candidate?.headBranch, "feature/payments");
  assert.equal(result.snapshot.releases[0].candidate?.headSha, "bbbb");
  assert.equal(result.snapshot.releases[0].candidate?.publicUrl, "https://gitlab.com/example/subgroup/project/-/merge_requests/17");
  assert.equal(result.snapshot.releases[0].evidence.ci.status, "PASS");
  assert.equal(result.snapshot.releases[1].evidence.ci.status, "FAIL");
  assert.equal(result.snapshot.releases[0].evidence.changeRisk.filesChanged, 1);
  assert.equal(result.snapshot.releases[0].evidence.changeRisk.linesAdded, 1);
  assert.equal(result.snapshot.releases[0].evidence.changeRisk.linesDeleted, 1);
  assert.equal(result.snapshot.releases[0].provenance?.label, "GitLab Merge Request");
  assert.equal(result.snapshot.releases[0].evidence.ci.provenance?.label, "GitLab Merge Request pipelines");
  assert.equal(result.snapshot.releases[0].evidence.changeRisk.provenance?.label, "GitLab Merge Request changes");
  assert.ok(!calls.some((call) => call.includes("/releases?per_page=20")), "open MRs should prevent release fallback calls");
});

test("GitLab merge request pipeline remains NOT_AVAILABLE when public pipeline evidence is unavailable", async () => {
  const reference = ref("https://gitlab.com/group/project");
  const path = "group%2Fproject";
  const adapter = new GitLabPublicRepositoryAdapter(fetchMap({
    [`https://gitlab.com/api/v4/projects/${path}`]: response({ default_branch: "main" }),
    [`https://gitlab.com/api/v4/projects/${path}/merge_requests?state=opened&per_page=20`]: response([{ iid: 19, title: "No pipeline", target_branch: "main", source_branch: "feature/no-pipeline", sha: "dddd", web_url: "https://gitlab.com/group/project/-/merge_requests/19" }]),
    [`https://gitlab.com/api/v4/projects/${path}/merge_requests/19/changes`]: response({ iid: 19, title: "No pipeline", target_branch: "main", source_branch: "feature/no-pipeline", sha: "dddd", web_url: "https://gitlab.com/group/project/-/merge_requests/19", changes: [{ new_path: "src/app/page.tsx", diff: "@@\n+added" }] }),
    [`https://gitlab.com/api/v4/projects/${path}/merge_requests/19/pipelines?per_page=20`]: response([]),
    [`https://gitlab.com/api/v4/projects/${path}/pipelines?sha=dddd&per_page=20`]: response([]),
  }));

  const result = await adapter.getSnapshot(reference);
  assert.equal(result.ok, true);
  assert.equal(result.snapshot.releases[0].evidence.ci.status, "NOT_AVAILABLE");
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

test("no open candidate and no release or tag returns intentional empty state", async () => {
  const githubReference = ref("https://github.com/example/empty");
  const github = await new GitHubPublicRepositoryAdapter(fetchMap({
    "https://api.github.com/repos/example/empty": response({ default_branch: "main" }),
    "https://api.github.com/repos/example/empty/pulls?state=open&per_page=20": response([]),
    "https://api.github.com/repos/example/empty/releases?per_page=20": response([]),
    "https://api.github.com/repos/example/empty/tags?per_page=20": response([]),
  })).getSnapshot(githubReference);

  assert.equal(github.ok, true);
  assert.equal(github.snapshot.releases.length, 0);

  const gitlabReference = ref("https://gitlab.com/example/empty");
  const path = "example%2Fempty";
  const gitlab = await new GitLabPublicRepositoryAdapter(fetchMap({
    [`https://gitlab.com/api/v4/projects/${path}`]: response({ default_branch: "main" }),
    [`https://gitlab.com/api/v4/projects/${path}/merge_requests?state=opened&per_page=20`]: response([]),
    [`https://gitlab.com/api/v4/projects/${path}/releases?per_page=20`]: response([]),
    [`https://gitlab.com/api/v4/projects/${path}/repository/tags?per_page=20`]: response([]),
  })).getSnapshot(gitlabReference);

  assert.equal(gitlab.ok, true);
  assert.equal(gitlab.snapshot.releases.length, 0);
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

  const github = analyzeReleaseRecord({ ...base, id: "github:example/project:pr:1", name: "GitHub", candidate: { candidateType: "PULL_REQUEST", candidateNumber: 1, title: "Clean", baseBranch: "main", headBranch: "feature", headSha: "aaaa", state: "OPEN" } }).data;
  const gitlab = analyzeReleaseRecord({ ...base, id: "gitlab:example/project:mr:1", name: "GitLab", candidate: { candidateType: "MERGE_REQUEST", candidateNumber: 1, title: "Clean", baseBranch: "main", headBranch: "feature", headSha: "aaaa", state: "OPEN" } }).data;
  const release = analyzeReleaseRecord({ ...base, id: "github:example/project:release:v1", name: "Release", candidate: { candidateType: "RELEASE", title: "Clean", baseBranch: "main", headSha: "aaaa", state: "RELEASED" } }).data;

  assert.equal(github.decision, gitlab.decision);
  assert.equal(github.decision, release.decision);
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
