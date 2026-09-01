import { analyzeReleaseRecord } from "../decision/engine.ts";
import { createCanonicalReleaseId } from "./release-id.ts";
import type { RepositoryProvider, RepositoryReference } from "./repository.ts";
import { DEFAULT_PUBLIC_REPOSITORY_URL } from "./repository.ts";
import {
  LIVE_BRANCH,
  LIVE_EVIDENCE_ASSET_NAME,
  LIVE_EVIDENCE_RELEASE_TAG,
  LIVE_REPOSITORY,
  normalizeGitChangeRisk,
  riskFromChangeRisk,
  validateLiveEvidenceDocument,
  type GitChangeStats,
} from "./live-evidence.ts";
import { createEvidenceProvenance } from "./provenance.ts";
import type {
  ChangeRiskEvidence,
  CiEvidence,
  EvidenceProvenance,
  PublicRepositoryError,
  ReleaseCandidateType,
  ReleaseRecord,
  SecurityEvidence,
  TestEvidence,
} from "./types.ts";

export type NormalizedRepository = {
  provider: RepositoryProvider;
  host: string;
  namespace: string;
  repository: string;
  fullPath: string;
  url: string;
  defaultBranch: string;
  description: string | null;
};

export type PublicRepositorySnapshot = {
  repository: NormalizedRepository;
  releases: readonly ReleaseRecord[];
  source?: {
    repository: string;
    branch: string;
    commitSha?: string;
    generatedAt?: string;
    workflow?: { name: string; runUrl: string };
  };
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;
type FetchJsonResult = { ok: true; data: unknown } | { ok: false; error: PublicRepositoryError };
type CachedFetchJsonResult = {
  expiresAt: number;
  promise: Promise<FetchJsonResult>;
};

type NormalizedCandidate = {
  type: ReleaseCandidateType;
  number?: number;
  label: string;
  name: string;
  publishedAt: string;
  commitSha: string;
  branch: string;
  baseBranch?: string;
  headBranch?: string;
  state: "OPEN" | "RELEASED";
  publicUrl?: string;
  provenance: EvidenceProvenance;
  changeStats?: GitChangeStats;
  changeProvenance?: EvidenceProvenance;
};

const githubHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": "release-gate-public-repository",
};

const GITHUB_PROVIDER_CACHE_TTL_MS = 45_000;
const githubProviderCaches = new WeakMap<FetchLike, Map<string, CachedFetchJsonResult>>();

function getServerGithubToken(): string | null {
  const token = typeof process !== "undefined" ? process.env.GITHUB_TOKEN?.trim() : undefined;
  return token ? token : null;
}

function githubRequestInit(): RequestInit {
  const token = getServerGithubToken();

  return {
    headers: {
      ...githubHeaders,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    next: { revalidate: 45 },
  };
}

function githubCacheKey(url: string): string {
  return `${getServerGithubToken() ? "github-auth" : "github-anon"}:${url}`;
}

const gitlabHeaders = {
  Accept: "application/json",
  "User-Agent": "release-gate-public-repository",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function providerError(
  code: PublicRepositoryError["code"],
  message: string,
  status?: number,
  metadata: Pick<PublicRepositoryError, "rateLimitResetAt" | "retryAfterSeconds"> = {},
): PublicRepositoryError {
  return { code, message, ...(status ? { status } : {}), ...metadata };
}

function parseRateLimitReset(reset: string | null): Pick<PublicRepositoryError, "rateLimitResetAt" | "retryAfterSeconds"> {
  if (!reset) return {};

  const seconds = Number.parseInt(reset, 10);
  if (!Number.isFinite(seconds) || seconds <= 0) return {};

  const resetAtMs = seconds * 1000;
  return {
    rateLimitResetAt: new Date(resetAtMs).toISOString(),
    retryAfterSeconds: Math.max(0, Math.ceil((resetAtMs - Date.now()) / 1000)),
  };
}

function formatRateLimitMessage(provider: RepositoryProvider, metadata: Pick<PublicRepositoryError, "rateLimitResetAt">): string {
  return metadata.rateLimitResetAt
    ? `Public ${provider} API rate limit exceeded. Try again after ${metadata.rateLimitResetAt}.`
    : `Public ${provider} API rate limit exceeded. Try again later.`;
}

export function mapProviderResponseError(provider: RepositoryProvider, response: Response, evidenceEndpoint = false): PublicRepositoryError {
  if (response.status === 404) {
    return providerError(
      evidenceEndpoint ? "EVIDENCE_NOT_AVAILABLE" : "REPOSITORY_NOT_FOUND",
      evidenceEndpoint
        ? `This ${provider} evidence endpoint is not available anonymously for the selected public repository.`
        : "Public repository was not found or is not visible anonymously.",
      response.status,
    );
  }

  if (response.status === 401 || response.status === 403) {
    const rateRemaining = response.headers.get(provider === "github" ? "x-ratelimit-remaining" : "ratelimit-remaining");
    const reset = response.headers.get(provider === "github" ? "x-ratelimit-reset" : "ratelimit-reset");
    if (response.status === 403 && rateRemaining === "0") {
      const rateLimitMetadata = parseRateLimitReset(reset);
      return providerError("PROVIDER_RATE_LIMITED", formatRateLimitMessage(provider, rateLimitMetadata), response.status, rateLimitMetadata);
    }

    return providerError(
      evidenceEndpoint ? "EVIDENCE_NOT_AVAILABLE" : "PROVIDER_UNAVAILABLE",
      evidenceEndpoint
        ? `This ${provider} evidence endpoint is not available anonymously for the selected public repository.`
        : `Public ${provider} API access is unavailable for this repository without credentials.`,
      response.status,
    );
  }

  if (response.status === 429) {
    const retryAfter = response.headers.get("retry-after");
    const retryAfterSeconds = retryAfter ? Number.parseInt(retryAfter, 10) : undefined;
    return providerError(
      "PROVIDER_RATE_LIMITED",
      `Public ${provider} API rate limit exceeded. Try again later.`,
      response.status,
      Number.isFinite(retryAfterSeconds) && retryAfterSeconds !== undefined ? { retryAfterSeconds } : {},
    );
  }

  return providerError("PROVIDER_UNAVAILABLE", `Public ${provider} API request failed.`, response.status);
}

function notAvailableCi(provider: RepositoryProvider): CiEvidence {
  return {
    status: "NOT_AVAILABLE",
    workflow: `${provider} public CI evidence unavailable`,
    totalJobs: 0,
    passedJobs: 0,
    failedJobs: 0,
    durationSeconds: 0,
  };
}

function notAvailableTests(): TestEvidence {
  return {
    status: "NOT_AVAILABLE",
    total: 0,
    passed: 0,
    failed: 0,
    flaky: 0,
    coveragePercent: null,
  };
}

function notAvailableSecurity(): SecurityEvidence {
  return {
    status: "NOT_AVAILABLE",
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
  };
}

function notAvailableChangeRisk(provider: RepositoryProvider): ChangeRiskEvidence {
  return {
    level: "MEDIUM",
    filesChanged: 0,
    linesAdded: 0,
    linesDeleted: 0,
    changedComponents: [],
    reasons: [`${provider} public change evidence is unavailable for this release candidate.`],
  };
}

function releaseNameFromTag(tag: string): string {
  return tag.replace(/^refs\/tags\//, "");
}

async function jsonOrNull(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

async function fetchJson(fetcher: FetchLike, url: string, init: RequestInit, provider: RepositoryProvider, evidenceEndpoint = false): Promise<FetchJsonResult> {
  let response: Response;

  try {
    response = await fetcher(url, init);
  } catch {
    return { ok: false, error: providerError("PROVIDER_UNAVAILABLE", `Public ${provider} API is currently unavailable.`) };
  }

  if (!response.ok) {
    return { ok: false, error: mapProviderResponseError(provider, response, evidenceEndpoint) };
  }

  return { ok: true, data: await jsonOrNull(response) };
}

function getGithubCache(fetcher: FetchLike): Map<string, CachedFetchJsonResult> {
  const existing = githubProviderCaches.get(fetcher);
  if (existing) return existing;

  const cache = new Map<string, CachedFetchJsonResult>();
  githubProviderCaches.set(fetcher, cache);
  return cache;
}

async function fetchGithubJson(fetcher: FetchLike, url: string, evidenceEndpoint = false): Promise<FetchJsonResult> {
  const now = Date.now();
  const cache = getGithubCache(fetcher);
  const key = githubCacheKey(url);
  const cached = cache.get(key);

  if (cached && cached.expiresAt > now) {
    return cached.promise;
  }

  const promise = fetchJson(fetcher, url, githubRequestInit(), "github", evidenceEndpoint);
  cache.set(key, { expiresAt: now + GITHUB_PROVIDER_CACHE_TTL_MS, promise });

  try {
    return await promise;
  } catch (error) {
    cache.delete(key);
    throw error;
  }
}

export function resetGitHubProviderCacheForTests(fetcher?: FetchLike): void {
  if (fetcher) {
    githubProviderCaches.delete(fetcher);
    return;
  }

  githubProviderCaches.delete(fetch);
}

function parseIsoDate(value: unknown): string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : new Date(0).toISOString();
}

function parseCommitSha(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "unknown";
}

function nestedString(value: unknown, key: string): string | undefined {
  return isRecord(value) && typeof value[key] === "string" ? value[key] : undefined;
}

function sumNumber(records: readonly Record<string, unknown>[], key: string): number {
  return records.reduce((sum, record) => sum + (typeof record[key] === "number" ? record[key] : 0), 0);
}

function createCandidateMetadata(reference: RepositoryReference, candidate: NormalizedCandidate): ReleaseRecord["candidate"] {
  return {
    candidateType: candidate.type,
    ...(candidate.number !== undefined ? { candidateNumber: candidate.number } : {}),
    title: candidate.name,
    ...(candidate.baseBranch ? { baseBranch: candidate.baseBranch } : {}),
    ...(candidate.headBranch ? { headBranch: candidate.headBranch } : {}),
    headSha: candidate.commitSha,
    state: candidate.state,
    ...(candidate.publicUrl ? { publicUrl: candidate.publicUrl } : {}),
    repository: reference,
  };
}

function normalizeCandidateChangeRisk(provider: RepositoryProvider, candidate: NormalizedCandidate): ChangeRiskEvidence {
  if (!candidate.changeStats) return notAvailableChangeRisk(provider);

  return {
    ...normalizeGitChangeRisk(candidate.changeStats),
    ...(candidate.changeProvenance ? { provenance: candidate.changeProvenance } : {}),
  };
}

function ciFromRows(provider: RepositoryProvider, reference: RepositoryReference, rows: readonly Record<string, unknown>[], label: string, sourceType: "workflow" | "pipeline", urlKey: "html_url" | "web_url"): CiEvidence {
  if (rows.length === 0) return notAvailableCi(provider);

  const failed = rows.filter((row) => row.conclusion === "failure" || row.conclusion === "cancelled" || row.conclusion === "timed_out" || row.status === "failed" || row.status === "canceled").length;
  const passed = rows.filter((row) => row.conclusion === "success" || row.conclusion === "skipped" || row.status === "success" || row.status === "skipped").length;

  if (failed === 0 && passed === 0) return notAvailableCi(provider);

  const primary = rows.find((row) => typeof row[urlKey] === "string") ?? rows[0];

  return {
    status: failed > 0 ? "FAIL" : passed === rows.length ? "PASS" : "NOT_AVAILABLE",
    workflow: label,
    totalJobs: rows.length,
    passedJobs: passed,
    failedJobs: failed,
    durationSeconds: 0,
    provenance: createEvidenceProvenance({
      provider,
      repository: reference.fullPath,
      sourceType,
      label: typeof primary.name === "string" ? primary.name : label,
      externalUrl: primary[urlKey],
      observedAt: primary.updated_at ?? primary.created_at,
    }),
  };
}

async function fetchDefaultLiveEvidence(fetcher: FetchLike): Promise<PublicRepositorySnapshot | null> {
  const releaseUrl = `https://api.github.com/repos/${LIVE_REPOSITORY}/releases/tags/${LIVE_EVIDENCE_RELEASE_TAG}`;
  const releaseResponse = await fetcher(releaseUrl, { headers: githubHeaders, next: { revalidate: 45 } });
  if (!releaseResponse.ok) return null;

  const releaseMetadata = await jsonOrNull(releaseResponse);
  if (!isRecord(releaseMetadata) || !Array.isArray(releaseMetadata.assets)) return null;

  const asset = releaseMetadata.assets.find((candidate) => isRecord(candidate) && candidate.name === LIVE_EVIDENCE_ASSET_NAME && typeof candidate.browser_download_url === "string");
  if (!isRecord(asset) || typeof asset.browser_download_url !== "string") return null;

  const evidenceResponse = await fetcher(asset.browser_download_url, { headers: { Accept: "application/json", "User-Agent": "release-gate-live-evidence" }, next: { revalidate: 45 } });
  if (!evidenceResponse.ok) return null;

  const validation = validateLiveEvidenceDocument(await jsonOrNull(evidenceResponse));
  if (!validation.ok) return null;

  const referenceFullPath = LIVE_REPOSITORY;
  const releaseUrlForTag = `https://github.com/${referenceFullPath}/releases/tag/${encodeURIComponent(validation.document.release.version)}`;
  return {
    repository: {
      provider: "github",
      host: "github.com",
      namespace: "JankoD84",
      repository: "release-gate",
      fullPath: referenceFullPath,
      url: DEFAULT_PUBLIC_REPOSITORY_URL,
      defaultBranch: LIVE_BRANCH,
      description: "Release Gate live evidence repository",
    },
    releases: [
      {
        ...validation.document.release,
        candidate: {
          candidateType: "RELEASE",
          title: validation.document.release.name,
          baseBranch: validation.document.release.branch,
          headSha: validation.document.release.commitSha,
          state: "RELEASED",
          publicUrl: releaseUrlForTag,
        },
        provenance: createEvidenceProvenance({
          provider: "github",
          repository: referenceFullPath,
          sourceType: "release",
          label: "GitHub Release",
          externalUrl: releaseUrlForTag,
          observedAt: validation.document.release.updatedAt,
        }),
        evidence: {
          ...validation.document.release.evidence,
          ci: validation.document.release.evidence.ci.status === "NOT_AVAILABLE"
            ? validation.document.release.evidence.ci
            : {
                ...validation.document.release.evidence.ci,
                provenance: createEvidenceProvenance({
                  provider: "github",
                  repository: referenceFullPath,
                  sourceType: "workflow",
                  label: validation.document.workflow.name,
                  externalUrl: validation.document.workflow.runUrl,
                  observedAt: validation.document.generatedAt,
                }),
              },
        },
      },
    ],
    source: {
      repository: validation.document.repository,
      branch: validation.document.branch,
      commitSha: validation.document.commitSha,
      generatedAt: validation.document.generatedAt,
      workflow: {
        name: validation.document.workflow.name,
        runUrl: validation.document.workflow.runUrl,
      },
    },
  };
}

export class GitHubPublicRepositoryAdapter {
  readonly provider = "github" as const;
  private readonly fetcher: FetchLike;

  constructor(fetcher: FetchLike = fetch) {
    this.fetcher = fetcher;
  }

  async getSnapshot(reference: RepositoryReference): Promise<{ ok: true; snapshot: PublicRepositorySnapshot } | { ok: false; error: PublicRepositoryError }> {
    const repoResult = await fetchGithubJson(this.fetcher, `https://api.github.com/repos/${reference.fullPath}`);
    if (!repoResult.ok) return repoResult;
    if (!isRecord(repoResult.data)) return { ok: false, error: providerError("PROVIDER_UNAVAILABLE", "GitHub repository metadata was malformed.") };
    if (repoResult.data.private === true) {
      return { ok: false, error: providerError("REPOSITORY_NOT_FOUND", "Public repository was not found or is not visible anonymously.", 404) };
    }

    const defaultBranch = typeof repoResult.data.default_branch === "string" ? repoResult.data.default_branch : "main";
    const repository: NormalizedRepository = {
      provider: "github",
      host: reference.host,
      namespace: reference.namespace,
      repository: reference.repository,
      fullPath: reference.fullPath,
      url: reference.url,
      defaultBranch,
      description: typeof repoResult.data.description === "string" ? repoResult.data.description : null,
    };

    const pullRequests = await this.listPullRequestCandidates(reference);
    if (!pullRequests.ok && pullRequests.error.code !== "EVIDENCE_NOT_AVAILABLE") return pullRequests;
    if (pullRequests.ok && pullRequests.candidates.length > 0) {
      const releases = await Promise.all(pullRequests.candidates.map((candidate, index) => this.toReleaseRecord(reference, candidate, pullRequests.candidates[index + 1])));
      return { ok: true, snapshot: { repository, releases } };
    }

    if (reference.url === DEFAULT_PUBLIC_REPOSITORY_URL) {
      try {
        const defaultEvidence = await fetchDefaultLiveEvidence(this.fetcher);
        if (defaultEvidence) return { ok: true, snapshot: defaultEvidence };
      } catch {
        // Fall back to generic public repository release/tag evidence for the default GitHub repo.
      }
    }

    const candidates = await this.listReleaseCandidates(reference, defaultBranch);
    if (!candidates.ok) return candidates;

    const releases = await Promise.all(candidates.candidates.map((candidate, index) => this.toReleaseRecord(reference, candidate, candidates.candidates[index + 1])));

    return { ok: true, snapshot: { repository, releases } };
  }

  private async listPullRequestCandidates(reference: RepositoryReference): Promise<{ ok: true; candidates: NormalizedCandidate[] } | { ok: false; error: PublicRepositoryError }> {
    const pulls = await fetchGithubJson(this.fetcher, `https://api.github.com/repos/${reference.fullPath}/pulls?state=open&per_page=20`, true);
    if (!pulls.ok) return pulls.error.code === "EVIDENCE_NOT_AVAILABLE" ? { ok: true, candidates: [] } : pulls;
    if (!Array.isArray(pulls.data)) return { ok: true, candidates: [] };

    const candidates = await Promise.all(pulls.data.filter(isRecord).map(async (pull): Promise<NormalizedCandidate | null> => {
      const number = typeof pull.number === "number" ? pull.number : undefined;
      if (number === undefined) return null;

      const detail = await fetchGithubJson(this.fetcher, `https://api.github.com/repos/${reference.fullPath}/pulls/${number}`, true);
      const files = await fetchGithubJson(this.fetcher, `https://api.github.com/repos/${reference.fullPath}/pulls/${number}/files?per_page=100`, true);
      const record = detail.ok && isRecord(detail.data) ? detail.data : pull;
      const fileRows = files.ok && Array.isArray(files.data) ? files.data.filter(isRecord) : [];
      const baseBranch = nestedString(record.base, "ref") ?? nestedString(pull.base, "ref");
      const headBranch = nestedString(record.head, "ref") ?? nestedString(pull.head, "ref");
      const headSha = parseCommitSha(nestedString(record.head, "sha") ?? nestedString(pull.head, "sha"));
      const title = typeof record.title === "string" && record.title ? record.title : `Pull Request #${number}`;
      const htmlUrl = typeof record.html_url === "string" ? record.html_url : typeof pull.html_url === "string" ? pull.html_url : `https://github.com/${reference.fullPath}/pull/${number}`;
      const changedFiles = fileRows.map((file) => (typeof file.filename === "string" ? file.filename : "unknown"));

      return {
        type: "PULL_REQUEST",
        number,
        label: `PR #${number}`,
        name: title,
        publishedAt: parseIsoDate(record.updated_at ?? record.created_at ?? pull.updated_at ?? pull.created_at),
        commitSha: headSha,
        branch: baseBranch ?? "main",
        baseBranch,
        headBranch,
        state: "OPEN",
        publicUrl: htmlUrl,
        provenance: createEvidenceProvenance({
          provider: "github",
          repository: reference.fullPath,
          sourceType: "pull-request",
          label: "GitHub Pull Request",
          externalUrl: htmlUrl,
          observedAt: record.updated_at ?? record.created_at ?? pull.updated_at ?? pull.created_at,
        }),
        changeStats: {
          filesChanged: typeof record.changed_files === "number" ? record.changed_files : fileRows.length,
          linesAdded: typeof record.additions === "number" ? record.additions : sumNumber(fileRows, "additions"),
          linesDeleted: typeof record.deletions === "number" ? record.deletions : sumNumber(fileRows, "deletions"),
          changedFiles,
        },
        changeProvenance: createEvidenceProvenance({
          provider: "github",
          repository: reference.fullPath,
          sourceType: "compare",
          label: "GitHub Pull Request changes",
          externalUrl: htmlUrl,
          observedAt: record.updated_at ?? record.created_at ?? pull.updated_at ?? pull.created_at,
        }),
      };
    }));

    return { ok: true, candidates: candidates.filter((candidate): candidate is NormalizedCandidate => candidate !== null) };
  }

  private async listReleaseCandidates(reference: RepositoryReference, defaultBranch: string): Promise<{ ok: true; candidates: NormalizedCandidate[] } | { ok: false; error: PublicRepositoryError }> {
    const releases = await fetchGithubJson(this.fetcher, `https://api.github.com/repos/${reference.fullPath}/releases?per_page=20`, true);
    if (!releases.ok && releases.error.code !== "EVIDENCE_NOT_AVAILABLE") return releases;

    if (releases.ok && Array.isArray(releases.data) && releases.data.length > 0) {
      return {
        ok: true,
        candidates: releases.data.filter(isRecord).map((release) => {
          const tag = typeof release.tag_name === "string" ? release.tag_name : String(release.id ?? "release");
          const name = typeof release.name === "string" && release.name ? release.name : releaseNameFromTag(tag);
          const htmlUrl = typeof release.html_url === "string" ? release.html_url : undefined;

          return {
            type: "RELEASE",
            label: tag,
            name,
            publishedAt: parseIsoDate(release.published_at ?? release.created_at),
            commitSha: parseCommitSha(isRecord(release.target_commitish) ? undefined : release.target_commitish),
            branch: defaultBranch,
            baseBranch: defaultBranch,
            state: "RELEASED",
            publicUrl: htmlUrl,
            provenance: createEvidenceProvenance({
              provider: "github",
              repository: reference.fullPath,
              sourceType: "release",
              label: "GitHub Release",
              externalUrl: htmlUrl,
              observedAt: release.published_at ?? release.created_at,
            }),
          };
        }),
      };
    }

    const tags = await fetchGithubJson(this.fetcher, `https://api.github.com/repos/${reference.fullPath}/tags?per_page=20`, true);
    if (!tags.ok) return tags.error.code === "EVIDENCE_NOT_AVAILABLE" ? { ok: true, candidates: [] } : tags;

    return {
      ok: true,
      candidates: Array.isArray(tags.data) ? tags.data.filter(isRecord).map((tag) => {
        const label = typeof tag.name === "string" ? tag.name : "tag";
        const publicUrl = `https://github.com/${reference.fullPath}/releases/tag/${encodeURIComponent(label)}`;

        return {
          type: "TAG",
          label,
          name: releaseNameFromTag(label),
          publishedAt: new Date(0).toISOString(),
          commitSha: parseCommitSha(isRecord(tag.commit) ? tag.commit.sha : undefined),
          branch: defaultBranch,
          baseBranch: defaultBranch,
          state: "RELEASED",
          publicUrl,
          provenance: createEvidenceProvenance({
            provider: "github",
            repository: reference.fullPath,
            sourceType: "tag",
            label: "GitHub Tag",
            externalUrl: publicUrl,
          }),
        };
      }) : [],
    };
  }

  private async getCi(reference: RepositoryReference, commitSha: string): Promise<CiEvidence> {
    if (commitSha === "unknown") return notAvailableCi(this.provider);

    const runs = await fetchGithubJson(this.fetcher, `https://api.github.com/repos/${reference.fullPath}/actions/runs?head_sha=${encodeURIComponent(commitSha)}&per_page=20`, true);
    if (!runs.ok || !isRecord(runs.data) || !Array.isArray(runs.data.workflow_runs)) return notAvailableCi(this.provider);

    return ciFromRows(this.provider, reference, runs.data.workflow_runs.filter(isRecord), "GitHub Actions workflow runs", "workflow", "html_url");
  }

  private async getChangeRisk(reference: RepositoryReference, current: string, previous?: string): Promise<ChangeRiskEvidence> {
    if (!previous || current === "unknown" || previous === "unknown") return notAvailableChangeRisk(this.provider);

    const compare = await fetchGithubJson(this.fetcher, `https://api.github.com/repos/${reference.fullPath}/compare/${encodeURIComponent(previous)}...${encodeURIComponent(current)}`, true);
    if (!compare.ok || !isRecord(compare.data)) return notAvailableChangeRisk(this.provider);

    return {
      ...normalizeGitChangeRisk({
        filesChanged: Array.isArray(compare.data.files) ? compare.data.files.length : 0,
        linesAdded: Array.isArray(compare.data.files) ? compare.data.files.filter(isRecord).reduce((sum, file) => sum + (typeof file.additions === "number" ? file.additions : 0), 0) : 0,
        linesDeleted: Array.isArray(compare.data.files) ? compare.data.files.filter(isRecord).reduce((sum, file) => sum + (typeof file.deletions === "number" ? file.deletions : 0), 0) : 0,
        changedFiles: Array.isArray(compare.data.files) ? compare.data.files.filter(isRecord).map((file) => (typeof file.filename === "string" ? file.filename : "unknown")) : [],
      }),
      provenance: createEvidenceProvenance({
        provider: "github",
        repository: reference.fullPath,
        sourceType: "compare",
        label: "GitHub Compare",
        externalUrl: compare.data.html_url ?? `https://github.com/${reference.fullPath}/compare/${encodeURIComponent(previous)}...${encodeURIComponent(current)}`,
      }),
    };
  }

  private async toReleaseRecord(reference: RepositoryReference, candidate: NormalizedCandidate, previous?: NormalizedCandidate): Promise<ReleaseRecord> {
    const ci = await this.getCi(reference, candidate.commitSha);
    const changeRisk = candidate.changeStats ? normalizeCandidateChangeRisk(this.provider, candidate) : await this.getChangeRisk(reference, candidate.commitSha, previous?.commitSha);

    return {
      id: createCanonicalReleaseId(reference, candidate.type === "PULL_REQUEST" ? "pr" : candidate.type === "TAG" ? "tag" : "release", candidate.number ?? candidate.label),
      version: candidate.label,
      name: candidate.name,
      risk: riskFromChangeRisk(changeRisk.level),
      updatedAt: candidate.publishedAt,
      branch: candidate.branch,
      commitSha: candidate.commitSha,
      provenance: candidate.provenance,
      candidate: createCandidateMetadata(reference, candidate),
      evidence: {
        ci,
        tests: notAvailableTests(),
        security: notAvailableSecurity(),
        changeRisk,
      },
    };
  }
}

export class GitLabPublicRepositoryAdapter {
  readonly provider = "gitlab" as const;
  private readonly fetcher: FetchLike;

  constructor(fetcher: FetchLike = fetch) {
    this.fetcher = fetcher;
  }

  async getSnapshot(reference: RepositoryReference): Promise<{ ok: true; snapshot: PublicRepositorySnapshot } | { ok: false; error: PublicRepositoryError }> {
    const projectPath = encodeURIComponent(reference.fullPath);
    const project = await fetchJson(this.fetcher, `https://gitlab.com/api/v4/projects/${projectPath}`, { headers: gitlabHeaders, next: { revalidate: 45 } }, this.provider);
    if (!project.ok) return project;
    if (!isRecord(project.data)) return { ok: false, error: providerError("PROVIDER_UNAVAILABLE", "GitLab project metadata was malformed.") };

    const defaultBranch = typeof project.data.default_branch === "string" ? project.data.default_branch : "main";
    const repository: NormalizedRepository = {
      provider: "gitlab",
      host: reference.host,
      namespace: reference.namespace,
      repository: reference.repository,
      fullPath: reference.fullPath,
      url: reference.url,
      defaultBranch,
      description: typeof project.data.description === "string" ? project.data.description : null,
    };

    const candidates = await this.listCandidates(reference, defaultBranch);
    if (!candidates.ok) return candidates;

    const releases = await Promise.all(candidates.candidates.map((candidate, index) => this.toReleaseRecord(reference, candidate, candidates.candidates[index + 1])));
    return { ok: true, snapshot: { repository, releases } };
  }

  private async listCandidates(reference: RepositoryReference, defaultBranch: string): Promise<{ ok: true; candidates: NormalizedCandidate[] } | { ok: false; error: PublicRepositoryError }> {
    const mergeRequests = await this.listMergeRequestCandidates(reference);
    if (!mergeRequests.ok && mergeRequests.error.code !== "EVIDENCE_NOT_AVAILABLE") return mergeRequests;
    if (mergeRequests.ok && mergeRequests.candidates.length > 0) return mergeRequests;

    return this.listReleaseCandidates(reference, defaultBranch);
  }

  private async listMergeRequestCandidates(reference: RepositoryReference): Promise<{ ok: true; candidates: NormalizedCandidate[] } | { ok: false; error: PublicRepositoryError }> {
    const path = encodeURIComponent(reference.fullPath);
    const mergeRequests = await fetchJson(this.fetcher, `https://gitlab.com/api/v4/projects/${path}/merge_requests?state=opened&per_page=20`, { headers: gitlabHeaders, next: { revalidate: 45 } }, this.provider, true);
    if (!mergeRequests.ok) return mergeRequests.error.code === "EVIDENCE_NOT_AVAILABLE" ? { ok: true, candidates: [] } : mergeRequests;
    if (!Array.isArray(mergeRequests.data)) return { ok: true, candidates: [] };

    const candidates = await Promise.all(mergeRequests.data.filter(isRecord).map(async (mergeRequest): Promise<NormalizedCandidate | null> => {
      const number = typeof mergeRequest.iid === "number" ? mergeRequest.iid : undefined;
      if (number === undefined) return null;

      const changes = await fetchJson(this.fetcher, `https://gitlab.com/api/v4/projects/${path}/merge_requests/${number}/changes`, { headers: gitlabHeaders, next: { revalidate: 45 } }, this.provider, true);
      const record = changes.ok && isRecord(changes.data) ? changes.data : mergeRequest;
      const changeRows = Array.isArray(record.changes) ? record.changes.filter(isRecord) : [];
      const title = typeof record.title === "string" && record.title ? record.title : `Merge Request !${number}`;
      const targetBranch = typeof record.target_branch === "string" ? record.target_branch : typeof mergeRequest.target_branch === "string" ? mergeRequest.target_branch : undefined;
      const sourceBranch = typeof record.source_branch === "string" ? record.source_branch : typeof mergeRequest.source_branch === "string" ? mergeRequest.source_branch : undefined;
      const headSha = parseCommitSha(typeof record.sha === "string" ? record.sha : nestedString(record.diff_refs, "head_sha") ?? nestedString(mergeRequest.diff_refs, "head_sha"));
      const webUrl = typeof record.web_url === "string" ? record.web_url : typeof mergeRequest.web_url === "string" ? mergeRequest.web_url : `https://gitlab.com/${reference.fullPath}/-/merge_requests/${number}`;

      return {
        type: "MERGE_REQUEST",
        number,
        label: `MR !${number}`,
        name: title,
        publishedAt: parseIsoDate(record.updated_at ?? record.created_at ?? mergeRequest.updated_at ?? mergeRequest.created_at),
        commitSha: headSha,
        branch: targetBranch ?? "main",
        baseBranch: targetBranch,
        headBranch: sourceBranch,
        state: "OPEN",
        publicUrl: webUrl,
        provenance: createEvidenceProvenance({
          provider: "gitlab",
          repository: reference.fullPath,
          sourceType: "merge-request",
          label: "GitLab Merge Request",
          externalUrl: webUrl,
          observedAt: record.updated_at ?? record.created_at ?? mergeRequest.updated_at ?? mergeRequest.created_at,
        }),
        changeStats: {
          filesChanged: changeRows.length,
          linesAdded: changeRows.reduce((sum, change) => sum + countDiffLines(typeof change.diff === "string" ? change.diff : "", "+"), 0),
          linesDeleted: changeRows.reduce((sum, change) => sum + countDiffLines(typeof change.diff === "string" ? change.diff : "", "-"), 0),
          changedFiles: changeRows.map((change) => (typeof change.new_path === "string" ? change.new_path : "unknown")),
        },
        changeProvenance: createEvidenceProvenance({
          provider: "gitlab",
          repository: reference.fullPath,
          sourceType: "compare",
          label: "GitLab Merge Request changes",
          externalUrl: webUrl,
          observedAt: record.updated_at ?? record.created_at ?? mergeRequest.updated_at ?? mergeRequest.created_at,
        }),
      };
    }));

    return { ok: true, candidates: candidates.filter((candidate): candidate is NormalizedCandidate => candidate !== null) };
  }

  private async listReleaseCandidates(reference: RepositoryReference, defaultBranch: string): Promise<{ ok: true; candidates: NormalizedCandidate[] } | { ok: false; error: PublicRepositoryError }> {
    const path = encodeURIComponent(reference.fullPath);
    const releases = await fetchJson(this.fetcher, `https://gitlab.com/api/v4/projects/${path}/releases?per_page=20`, { headers: gitlabHeaders, next: { revalidate: 45 } }, this.provider, true);

    if (releases.ok && Array.isArray(releases.data) && releases.data.length > 0) {
      return {
        ok: true,
        candidates: releases.data.filter(isRecord).map((release) => {
          const label = typeof release.tag_name === "string" ? release.tag_name : "release";
          const publicUrl = `https://gitlab.com/${reference.fullPath}/-/releases/${encodeURIComponent(label)}`;

          return {
            type: "RELEASE",
            label,
            name: typeof release.name === "string" && release.name ? release.name : releaseNameFromTag(label),
            publishedAt: parseIsoDate(release.released_at ?? release.created_at),
            commitSha: parseCommitSha(isRecord(release.commit) ? release.commit.id : undefined),
            branch: defaultBranch,
            baseBranch: defaultBranch,
            state: "RELEASED",
            publicUrl,
            provenance: createEvidenceProvenance({
              provider: "gitlab",
              repository: reference.fullPath,
              sourceType: "release",
              label: "GitLab Release",
              externalUrl: publicUrl,
              observedAt: release.released_at ?? release.created_at,
            }),
          };
        }),
      };
    }

    const tags = await fetchJson(this.fetcher, `https://gitlab.com/api/v4/projects/${path}/repository/tags?per_page=20`, { headers: gitlabHeaders, next: { revalidate: 45 } }, this.provider, true);
    if (!tags.ok) {
      if (tags.error.code === "EVIDENCE_NOT_AVAILABLE" || releases.ok || (!releases.ok && releases.error.code === "EVIDENCE_NOT_AVAILABLE")) return { ok: true, candidates: [] };
      return tags;
    }

    return {
      ok: true,
      candidates: Array.isArray(tags.data) ? tags.data.filter(isRecord).map((tag) => {
        const label = typeof tag.name === "string" ? tag.name : "tag";
        const publicUrl = `https://gitlab.com/${reference.fullPath}/-/tags/${encodeURIComponent(label)}`;

        return {
          type: "TAG",
          label,
          name: releaseNameFromTag(label),
          publishedAt: parseIsoDate(tag.created_at),
          commitSha: parseCommitSha(isRecord(tag.commit) ? tag.commit.id : undefined),
          branch: defaultBranch,
          baseBranch: defaultBranch,
          state: "RELEASED",
          publicUrl,
          provenance: createEvidenceProvenance({
            provider: "gitlab",
            repository: reference.fullPath,
            sourceType: "tag",
            label: "GitLab Tag",
            externalUrl: publicUrl,
            observedAt: tag.created_at,
          }),
        };
      }) : [],
    };
  }

  private async getCi(reference: RepositoryReference, ref: string, mergeRequestNumber?: number): Promise<CiEvidence> {
    if (ref === "unknown") return notAvailableCi(this.provider);

    if (mergeRequestNumber !== undefined) {
      const mrPipelines = await fetchJson(this.fetcher, `https://gitlab.com/api/v4/projects/${encodeURIComponent(reference.fullPath)}/merge_requests/${mergeRequestNumber}/pipelines?per_page=20`, { headers: gitlabHeaders, next: { revalidate: 45 } }, this.provider, true);
      if (mrPipelines.ok && Array.isArray(mrPipelines.data) && mrPipelines.data.length > 0) {
        return ciFromRows(this.provider, reference, mrPipelines.data.filter(isRecord), "GitLab Merge Request pipelines", "pipeline", "web_url");
      }
    }

    const pipelines = await fetchJson(this.fetcher, `https://gitlab.com/api/v4/projects/${encodeURIComponent(reference.fullPath)}/pipelines?sha=${encodeURIComponent(ref)}&per_page=20`, { headers: gitlabHeaders, next: { revalidate: 45 } }, this.provider, true);
    if (!pipelines.ok || !Array.isArray(pipelines.data)) return notAvailableCi(this.provider);

    return ciFromRows(this.provider, reference, pipelines.data.filter(isRecord), "GitLab pipelines", "pipeline", "web_url");
  }

  private async getChangeRisk(reference: RepositoryReference, current: string, previous?: string): Promise<ChangeRiskEvidence> {
    if (!previous || current === "unknown" || previous === "unknown") return notAvailableChangeRisk(this.provider);

    const compare = await fetchJson(this.fetcher, `https://gitlab.com/api/v4/projects/${encodeURIComponent(reference.fullPath)}/repository/compare?from=${encodeURIComponent(previous)}&to=${encodeURIComponent(current)}`, { headers: gitlabHeaders, next: { revalidate: 45 } }, this.provider, true);
    if (!compare.ok || !isRecord(compare.data)) return notAvailableChangeRisk(this.provider);

    const diffs = Array.isArray(compare.data.diffs) ? compare.data.diffs.filter(isRecord) : [];

    return {
      ...normalizeGitChangeRisk({
        filesChanged: diffs.length,
        linesAdded: diffs.reduce((sum, diff) => sum + countDiffLines(typeof diff.diff === "string" ? diff.diff : "", "+"), 0),
        linesDeleted: diffs.reduce((sum, diff) => sum + countDiffLines(typeof diff.diff === "string" ? diff.diff : "", "-"), 0),
        changedFiles: diffs.map((diff) => (typeof diff.new_path === "string" ? diff.new_path : "unknown")),
      }),
      provenance: createEvidenceProvenance({
        provider: "gitlab",
        repository: reference.fullPath,
        sourceType: "compare",
        label: "GitLab Compare",
        externalUrl: compare.data.web_url ?? `https://gitlab.com/${reference.fullPath}/-/compare/${encodeURIComponent(previous)}...${encodeURIComponent(current)}`,
      }),
    };
  }

  private async toReleaseRecord(reference: RepositoryReference, candidate: NormalizedCandidate, previous?: NormalizedCandidate): Promise<ReleaseRecord> {
    const ci = await this.getCi(reference, candidate.commitSha, candidate.type === "MERGE_REQUEST" ? candidate.number : undefined);
    const changeRisk = candidate.changeStats ? normalizeCandidateChangeRisk(this.provider, candidate) : await this.getChangeRisk(reference, candidate.commitSha, previous?.commitSha);

    return {
      id: createCanonicalReleaseId(reference, candidate.type === "MERGE_REQUEST" ? "mr" : candidate.type === "TAG" ? "tag" : "release", candidate.number ?? candidate.label),
      version: candidate.label,
      name: candidate.name,
      risk: riskFromChangeRisk(changeRisk.level),
      updatedAt: candidate.publishedAt,
      branch: candidate.branch,
      commitSha: candidate.commitSha,
      provenance: candidate.provenance,
      candidate: createCandidateMetadata(reference, candidate),
      evidence: {
        ci,
        tests: notAvailableTests(),
        security: notAvailableSecurity(),
        changeRisk,
      },
    };
  }
}

function countDiffLines(diff: string, prefix: "+" | "-"): number {
  return diff.split("\n").filter((line) => line.startsWith(prefix) && !line.startsWith(`${prefix}${prefix}${prefix}`)).length;
}

export function analyzeSnapshotRelease(record: ReleaseRecord) {
  return analyzeReleaseRecord(record).data;
}

export function createPublicRepositoryAdapter(reference: RepositoryReference): GitHubPublicRepositoryAdapter | GitLabPublicRepositoryAdapter {
  return reference.provider === "github" ? new GitHubPublicRepositoryAdapter() : new GitLabPublicRepositoryAdapter();
}
