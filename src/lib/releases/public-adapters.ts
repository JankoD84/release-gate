import { analyzeReleaseRecord } from "../decision/engine.ts";
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
} from "./live-evidence.ts";
import { createEvidenceProvenance } from "./provenance.ts";
import type {
  ChangeRiskEvidence,
  CiEvidence,
  EvidenceProvenance,
  PublicRepositoryError,
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

const githubHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": "release-gate-public-repository",
};

const gitlabHeaders = {
  Accept: "application/json",
  "User-Agent": "release-gate-public-repository",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function providerError(code: PublicRepositoryError["code"], message: string, status?: number): PublicRepositoryError {
  return { code, message, ...(status ? { status } : {}) };
}

export function mapProviderResponseError(provider: RepositoryProvider, response: Response, evidenceEndpoint = false): PublicRepositoryError {
  if (response.status === 404) {
    return providerError("REPOSITORY_NOT_FOUND", "Public repository was not found or is not visible anonymously.", response.status);
  }

  if (response.status === 401 || response.status === 403) {
    const rateRemaining = response.headers.get(provider === "github" ? "x-ratelimit-remaining" : "ratelimit-remaining");
    const reset = response.headers.get(provider === "github" ? "x-ratelimit-reset" : "ratelimit-reset");
    if (response.status === 403 && rateRemaining === "0") {
      return providerError("PROVIDER_RATE_LIMITED", reset ? `Public ${provider} API rate limit exceeded. Try again after reset ${reset}.` : `Public ${provider} API rate limit exceeded. Try again later.`, response.status);
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
    return providerError("PROVIDER_RATE_LIMITED", `Public ${provider} API rate limit exceeded. Try again later.`, response.status);
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

function makeReleaseId(reference: RepositoryReference, label: string): string {
  return `${reference.provider}:${encodeURIComponent(reference.fullPath)}:${encodeURIComponent(label)}`;
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

async function fetchJson(fetcher: FetchLike, url: string, init: RequestInit, provider: RepositoryProvider, evidenceEndpoint = false): Promise<{ ok: true; data: unknown } | { ok: false; error: PublicRepositoryError }> {
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

function parseIsoDate(value: unknown): string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value)) ? value : new Date(0).toISOString();
}

function parseCommitSha(value: unknown): string {
  return typeof value === "string" && value.length > 0 ? value : "unknown";
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
        provenance: createEvidenceProvenance({
          provider: "github",
          repository: referenceFullPath,
          sourceType: "release",
          label: "GitHub Release",
          externalUrl: `https://github.com/${referenceFullPath}/releases/tag/${encodeURIComponent(validation.document.release.version)}`,
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
    if (reference.url === DEFAULT_PUBLIC_REPOSITORY_URL) {
      try {
        const defaultEvidence = await fetchDefaultLiveEvidence(this.fetcher);
        if (defaultEvidence) return { ok: true, snapshot: defaultEvidence };
      } catch {
        // Fall back to generic public repository evidence for the default GitHub repo.
      }
    }

    const repoResult = await fetchJson(this.fetcher, `https://api.github.com/repos/${reference.fullPath}`, { headers: githubHeaders, next: { revalidate: 45 } }, this.provider);
    if (!repoResult.ok) return repoResult;
    if (!isRecord(repoResult.data)) return { ok: false, error: providerError("PROVIDER_UNAVAILABLE", "GitHub repository metadata was malformed.") };

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

    const releaseCandidates = await this.listReleaseCandidates(reference);
    if (!releaseCandidates.ok) return releaseCandidates;

    const releases = await Promise.all(releaseCandidates.candidates.map((candidate, index) => this.toReleaseRecord(reference, repository.defaultBranch, candidate, releaseCandidates.candidates[index + 1])));

    return { ok: true, snapshot: { repository, releases } };
  }

  private async listReleaseCandidates(reference: RepositoryReference): Promise<{ ok: true; candidates: Array<{ label: string; name: string; publishedAt: string; commitSha: string; provenance: EvidenceProvenance }> } | { ok: false; error: PublicRepositoryError }> {
    const releases = await fetchJson(this.fetcher, `https://api.github.com/repos/${reference.fullPath}/releases?per_page=20`, { headers: githubHeaders, next: { revalidate: 45 } }, this.provider, true);
    if (!releases.ok && releases.error.code !== "EVIDENCE_NOT_AVAILABLE") return releases;

    if (releases.ok && Array.isArray(releases.data) && releases.data.length > 0) {
      return {
        ok: true,
        candidates: releases.data.filter(isRecord).map((release) => ({
          label: typeof release.tag_name === "string" ? release.tag_name : String(release.id ?? "release"),
          name: typeof release.name === "string" && release.name ? release.name : releaseNameFromTag(typeof release.tag_name === "string" ? release.tag_name : "release"),
          publishedAt: parseIsoDate(release.published_at ?? release.created_at),
          commitSha: parseCommitSha(isRecord(release.target_commitish) ? undefined : release.target_commitish),
          provenance: createEvidenceProvenance({
            provider: "github",
            repository: reference.fullPath,
            sourceType: "release",
            label: "GitHub Release",
            externalUrl: release.html_url,
            observedAt: release.published_at ?? release.created_at,
          }),
        })),
      };
    }

    const tags = await fetchJson(this.fetcher, `https://api.github.com/repos/${reference.fullPath}/tags?per_page=20`, { headers: githubHeaders, next: { revalidate: 45 } }, this.provider, true);
    if (!tags.ok) return tags.error.code === "EVIDENCE_NOT_AVAILABLE" ? { ok: true, candidates: [] } : tags;

    return {
      ok: true,
      candidates: Array.isArray(tags.data) ? tags.data.filter(isRecord).map((tag) => ({
        label: typeof tag.name === "string" ? tag.name : "tag",
        name: releaseNameFromTag(typeof tag.name === "string" ? tag.name : "tag"),
        publishedAt: new Date(0).toISOString(),
        commitSha: parseCommitSha(isRecord(tag.commit) ? tag.commit.sha : undefined),
        provenance: createEvidenceProvenance({
          provider: "github",
          repository: reference.fullPath,
          sourceType: "tag",
          label: "GitHub Tag",
          externalUrl: `https://github.com/${reference.fullPath}/releases/tag/${encodeURIComponent(typeof tag.name === "string" ? tag.name : "tag")}`,
        }),
      })) : [],
    };
  }

  private async getCi(reference: RepositoryReference, commitSha: string): Promise<CiEvidence> {
    if (commitSha === "unknown") return notAvailableCi(this.provider);

    const runs = await fetchJson(this.fetcher, `https://api.github.com/repos/${reference.fullPath}/actions/runs?head_sha=${encodeURIComponent(commitSha)}&per_page=20`, { headers: githubHeaders, next: { revalidate: 45 } }, this.provider, true);
    if (!runs.ok || !isRecord(runs.data) || !Array.isArray(runs.data.workflow_runs) || runs.data.workflow_runs.length === 0) return notAvailableCi(this.provider);

    const workflowRuns = runs.data.workflow_runs.filter(isRecord);
    const failed = workflowRuns.filter((run) => run.conclusion && run.conclusion !== "success" && run.conclusion !== "skipped").length;
    const passed = workflowRuns.filter((run) => run.conclusion === "success" || run.conclusion === "skipped").length;

    const primaryRun = workflowRuns.find((run) => typeof run.html_url === "string") ?? workflowRuns[0];

    return {
      status: failed > 0 ? "FAIL" : "PASS",
      workflow: "GitHub Actions workflow runs",
      totalJobs: workflowRuns.length,
      passedJobs: passed,
      failedJobs: failed,
      durationSeconds: 0,
      provenance: createEvidenceProvenance({
        provider: "github",
        repository: reference.fullPath,
        sourceType: "workflow",
        label: typeof primaryRun.name === "string" ? primaryRun.name : "GitHub Actions",
        externalUrl: primaryRun.html_url,
        observedAt: primaryRun.updated_at ?? primaryRun.created_at,
      }),
    };
  }

  private async getChangeRisk(reference: RepositoryReference, current: string, previous?: string): Promise<ChangeRiskEvidence> {
    if (!previous || current === "unknown" || previous === "unknown") return notAvailableChangeRisk(this.provider);

    const compare = await fetchJson(this.fetcher, `https://api.github.com/repos/${reference.fullPath}/compare/${encodeURIComponent(previous)}...${encodeURIComponent(current)}`, { headers: githubHeaders, next: { revalidate: 45 } }, this.provider, true);
    if (!compare.ok || !isRecord(compare.data)) return notAvailableChangeRisk(this.provider);

    return {
      ...normalizeGitChangeRisk({
        filesChanged: typeof compare.data.files === "number" ? compare.data.files : Array.isArray(compare.data.files) ? compare.data.files.length : 0,
        linesAdded: typeof compare.data.ahead_by === "number" ? 0 : Array.isArray(compare.data.files) ? compare.data.files.filter(isRecord).reduce((sum, file) => sum + (typeof file.additions === "number" ? file.additions : 0), 0) : 0,
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

  private async toReleaseRecord(reference: RepositoryReference, defaultBranch: string, candidate: { label: string; name: string; publishedAt: string; commitSha: string; provenance: EvidenceProvenance }, previous?: { commitSha: string }): Promise<ReleaseRecord> {
    const ci = await this.getCi(reference, candidate.commitSha);
    const changeRisk = await this.getChangeRisk(reference, candidate.commitSha, previous?.commitSha);

    return {
      id: makeReleaseId(reference, candidate.label),
      version: candidate.label,
      name: candidate.name,
      risk: riskFromChangeRisk(changeRisk.level),
      updatedAt: candidate.publishedAt,
      branch: defaultBranch,
      commitSha: candidate.commitSha,
      provenance: candidate.provenance,
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

    const candidates = await this.listReleaseCandidates(reference);
    if (!candidates.ok) return candidates;

    const releases = await Promise.all(candidates.candidates.map((candidate, index) => this.toReleaseRecord(reference, defaultBranch, candidate, candidates.candidates[index + 1])));
    return { ok: true, snapshot: { repository, releases } };
  }

  private async listReleaseCandidates(reference: RepositoryReference): Promise<{ ok: true; candidates: Array<{ label: string; name: string; publishedAt: string; commitSha: string; provenance: EvidenceProvenance }> } | { ok: false; error: PublicRepositoryError }> {
    const path = encodeURIComponent(reference.fullPath);
    const releases = await fetchJson(this.fetcher, `https://gitlab.com/api/v4/projects/${path}/releases?per_page=20`, { headers: gitlabHeaders, next: { revalidate: 45 } }, this.provider, true);

    if (releases.ok && Array.isArray(releases.data) && releases.data.length > 0) {
      return {
        ok: true,
        candidates: releases.data.filter(isRecord).map((release) => ({
          label: typeof release.tag_name === "string" ? release.tag_name : "release",
          name: typeof release.name === "string" && release.name ? release.name : releaseNameFromTag(typeof release.tag_name === "string" ? release.tag_name : "release"),
          publishedAt: parseIsoDate(release.released_at ?? release.created_at),
          commitSha: parseCommitSha(isRecord(release.commit) ? release.commit.id : undefined),
          provenance: createEvidenceProvenance({
            provider: "gitlab",
            repository: reference.fullPath,
            sourceType: "release",
            label: "GitLab Release",
            externalUrl: `https://gitlab.com/${reference.fullPath}/-/releases/${encodeURIComponent(typeof release.tag_name === "string" ? release.tag_name : "release")}`,
            observedAt: release.released_at ?? release.created_at,
          }),
        })),
      };
    }

    const tags = await fetchJson(this.fetcher, `https://gitlab.com/api/v4/projects/${path}/repository/tags?per_page=20`, { headers: gitlabHeaders, next: { revalidate: 45 } }, this.provider, true);
    if (!tags.ok) {
      if (tags.error.code === "EVIDENCE_NOT_AVAILABLE" || releases.ok || (!releases.ok && releases.error.code === "EVIDENCE_NOT_AVAILABLE")) return { ok: true, candidates: [] };
      return tags;
    }

    return {
      ok: true,
      candidates: Array.isArray(tags.data) ? tags.data.filter(isRecord).map((tag) => ({
        label: typeof tag.name === "string" ? tag.name : "tag",
        name: releaseNameFromTag(typeof tag.name === "string" ? tag.name : "tag"),
        publishedAt: parseIsoDate(tag.created_at),
        commitSha: parseCommitSha(isRecord(tag.commit) ? tag.commit.id : undefined),
        provenance: createEvidenceProvenance({
          provider: "gitlab",
          repository: reference.fullPath,
          sourceType: "tag",
          label: "GitLab Tag",
          externalUrl: `https://gitlab.com/${reference.fullPath}/-/tags/${encodeURIComponent(typeof tag.name === "string" ? tag.name : "tag")}`,
          observedAt: tag.created_at,
        }),
      })) : [],
    };
  }

  private async getCi(reference: RepositoryReference, ref: string): Promise<CiEvidence> {
    if (ref === "unknown") return notAvailableCi(this.provider);

    const pipelines = await fetchJson(this.fetcher, `https://gitlab.com/api/v4/projects/${encodeURIComponent(reference.fullPath)}/pipelines?sha=${encodeURIComponent(ref)}&per_page=20`, { headers: gitlabHeaders, next: { revalidate: 45 } }, this.provider, true);
    if (!pipelines.ok || !Array.isArray(pipelines.data) || pipelines.data.length === 0) return notAvailableCi(this.provider);

    const rows = pipelines.data.filter(isRecord);
    const failed = rows.filter((pipeline) => pipeline.status === "failed" || pipeline.status === "canceled").length;
    const passed = rows.filter((pipeline) => pipeline.status === "success" || pipeline.status === "skipped").length;

    const primaryPipeline = rows.find((pipeline) => typeof pipeline.web_url === "string") ?? rows[0];

    return {
      status: failed > 0 ? "FAIL" : "PASS",
      workflow: "GitLab pipelines",
      totalJobs: rows.length,
      passedJobs: passed,
      failedJobs: failed,
      durationSeconds: 0,
      provenance: createEvidenceProvenance({
        provider: "gitlab",
        repository: reference.fullPath,
        sourceType: "pipeline",
        label: "GitLab Pipeline",
        externalUrl: primaryPipeline.web_url,
        observedAt: primaryPipeline.updated_at ?? primaryPipeline.created_at,
      }),
    };
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

  private async toReleaseRecord(reference: RepositoryReference, defaultBranch: string, candidate: { label: string; name: string; publishedAt: string; commitSha: string; provenance: EvidenceProvenance }, previous?: { commitSha: string }): Promise<ReleaseRecord> {
    const ci = await this.getCi(reference, candidate.commitSha);
    const changeRisk = await this.getChangeRisk(reference, candidate.commitSha, previous?.commitSha);

    return {
      id: makeReleaseId(reference, candidate.label),
      version: candidate.label,
      name: candidate.name,
      risk: riskFromChangeRisk(changeRisk.level),
      updatedAt: candidate.publishedAt,
      branch: defaultBranch,
      commitSha: candidate.commitSha,
      provenance: candidate.provenance,
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
