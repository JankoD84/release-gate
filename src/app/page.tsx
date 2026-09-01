"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { useWebMcpStatus } from "@/components/webmcp/webmcp-provider";
import {
  AppShell,
  Badge,
  decisionTone,
  ErrorState,
  formatDate,
  formatDateTime,
  formatDecisionLabel,
  Hero,
  MetricCard,
  Panel,
  riskTone,
  SectionHeader,
} from "@/components/release-gate/ui";
import type { ReleaseDecision } from "@/lib/decision/types";
import {
  getFinalDecision,
  subscribeToFinalDecisionChanges,
} from "@/lib/decisions/final-decision-store";
import { getActiveReleaseMode, setActiveReleaseMode, subscribeToReleaseModeChanges, type ReleaseMode } from "@/lib/mode";
import { resetDemoState } from "@/lib/decisions/demo-state";
import { getActiveRepositoryReference, parsePublicRepositoryUrl, setActiveRepositoryReference, subscribeToRepositoryChanges, type RepositoryReference } from "@/lib/releases/repository";
import type { PublicRepositorySnapshot } from "@/lib/releases/public-adapters";
import { releaseDetailHref } from "@/lib/releases/release-id";
import { getReleaseProvider, type ReleaseProviderError, type ReleaseWithDecision } from "@/lib/releases/providers";
import { webMcpToolCatalog } from "@/lib/webmcp/register-tools";

type HumanDecisionLabel = ReleaseDecision | "PENDING";

const candidateTableGrid = "grid-cols-[minmax(240px,1.6fr)_minmax(160px,1fr)_100px_200px_170px_130px_90px]";

type ToolGroup = {
  heading: string;
  tools: readonly string[];
};

const agentPlaybookPrompts = [
  {
    title: "Merge-readiness review",
    prompt: "Review this open change for merge.\nInspect all available evidence, explain the system recommendation and required actions, and cite the evidence sources where available.\nDo not approve or reject anything.",
  },
  {
    title: "Compare candidates",
    prompt: "Review the available release candidates and tell me which is safest to proceed.\nCompare the evidence, risks, missing evidence and required actions.\nDo not make any human decision for me.",
  },
  {
    title: "Governed authorization",
    prompt: "Review the current candidate first.\nExplain the evidence, risks and required actions.\nIf the candidate is eligible, wait for my explicit approval before recording any final decision.",
  },
  {
    title: "Investigate blockers",
    prompt: "Explain exactly why the current candidate is blocked.\nShow the blocking evidence, evidence sources and required actions before this candidate can become eligible for approval.",
  },
] as const;

const toolGroups: readonly ToolGroup[] = [
  { heading: "Discovery", tools: ["list_releases", "get_release"] },
  {
    heading: "Evidence",
    tools: [
      "get_ci_status",
      "get_test_results",
      "get_security_findings",
      "get_change_risk",
    ],
  },
  { heading: "Intelligence", tools: ["analyze_release"] },
  {
    heading: "Human Decision",
    tools: ["approve_release", "reject_release", "get_final_decision"],
  },
  { heading: "Audit", tools: ["get_activity_log"] },
];

type DashboardState =
  | { status: "loading"; mode: ReleaseMode }
  | {
      status: "ready";
      mode: ReleaseMode;
      releases: readonly ReleaseWithDecision[];
      repository?: RepositoryReference;
      source?: PublicRepositorySnapshot["source"];
    }
  | { status: "error"; mode: ReleaseMode; error: ReleaseProviderError | { code: string; message: string }; repository?: RepositoryReference };

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

function isOpenChangeCandidate(release: ReleaseWithDecision): boolean {
  return release.candidate?.candidateType === "PULL_REQUEST" || release.candidate?.candidateType === "MERGE_REQUEST";
}

function candidateLabel(release: ReleaseWithDecision): string {
  if (release.candidate?.candidateType === "PULL_REQUEST" && release.candidate.candidateNumber !== undefined) return `PR #${release.candidate.candidateNumber}`;
  if (release.candidate?.candidateType === "MERGE_REQUEST" && release.candidate.candidateNumber !== undefined) return `MR !${release.candidate.candidateNumber}`;
  if (release.candidate?.candidateType === "TAG") return `Tag ${release.version}`;
  return release.candidate?.candidateType === "RELEASE" ? `Release ${release.version}` : release.version;
}

function candidateTarget(release: ReleaseWithDecision): string {
  const base = release.candidate?.baseBranch ?? release.branch;
  const head = release.candidate?.headBranch;

  return head ? `${base} ← ${head}` : base;
}

function candidateDisplay(release: ReleaseWithDecision, mode: ReleaseMode): { primary: string; secondary: string } {
  if (mode === "LIVE" && !isOpenChangeCandidate(release) && release.version.includes("@")) {
    return {
      primary: `Release ${release.branch}`,
      secondary: `${release.name} · ${release.version}`,
    };
  }

  return {
    primary: mode === "LIVE" ? candidateLabel(release) : release.version,
    secondary: release.name,
  };
}

function AgentPromptCard({ prompt, title }: { prompt: string; title: string }) {
  const [copied, setCopied] = useState(false);

  async function copyPrompt() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/45 p-3.5 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <button className="rounded-full border border-cyan-300/30 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:border-cyan-200 hover:bg-cyan-300/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" onClick={copyPrompt} type="button">{copied ? "Copied" : "Copy"}</button>
      </div>
      <p className="mt-3 line-clamp-3 whitespace-pre-line text-xs leading-5 text-slate-400">{prompt}</p>
    </div>
  );
}

export default function Home() {
  const webMcpStatus = useWebMcpStatus();
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [finalDecisions, setFinalDecisions] = useState<Record<string, HumanDecisionLabel>>({});
  const [repositoryUrl, setRepositoryUrl] = useState(() => getActiveRepositoryReference().url);
  const [repositoryMessage, setRepositoryMessage] = useState<string | null>(null);
  const [repositoryError, setRepositoryError] = useState<string | null>(null);
  const [state, setState] = useState<DashboardState>({ status: "loading", mode: "LIVE" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const mode = getActiveReleaseMode();
      const repository = getActiveRepositoryReference();
      setRepositoryUrl(repository.url);
      setState({ status: "loading", mode });
      const result = await getReleaseProvider(mode).listReleases();

      if (cancelled) return;

      if (!result.ok) {
        setState({ status: "error", mode, error: result.error, repository });
        return;
      }

      setState({ status: "ready", mode, releases: result.releases, repository: result.repository, source: result.source });
    }

    load();
    const unsubscribeMode = subscribeToReleaseModeChanges(load);
    const unsubscribeRepository = subscribeToRepositoryChanges(load);
    return () => {
      cancelled = true;
      unsubscribeMode();
      unsubscribeRepository();
    };
  }, []);

  useEffect(() => {
    const refreshFinalDecisions = () => {
      if (state.status !== "ready") return;
      setFinalDecisions(
        Object.fromEntries(
          state.releases.map((release) => {
            const finalDecisionState = getFinalDecision(release.id);

            return [
              release.id,
              finalDecisionState.status === "DECIDED"
                ? finalDecisionState.decision.finalDecision
                : "PENDING",
            ];
          }),
        ),
      );
    };

    refreshFinalDecisions();

    return subscribeToFinalDecisionChanges(refreshFinalDecisions);
  }, [state]);

  const summary = useMemo(() => {
    const releases = state.status === "ready" ? state.releases : [];
    const decisions = releases.map((release) => release.decision);

    return {
      releases: releases.length,
      hasOpenCandidates: state.mode === "LIVE" && releases.some(isOpenChangeCandidate),
      go: decisions.filter((decision) => decision === "GO").length,
      conditional: decisions.filter((decision) => decision === "CONDITIONAL_GO").length,
      blocked: decisions.filter((decision) => decision === "NO_GO").length,
    };
  }, [state]);

  function handleResetDemoState() {
    if (window.confirm("Reset local decisions? This clears browser-local final decisions and activity only.")) {
      resetDemoState();
      setResetMessage("Local decisions reset.");
      window.setTimeout(() => setResetMessage(null), 2400);
    }
  }

  function handleAnalyzeRepository(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const parsed = parsePublicRepositoryUrl(repositoryUrl);

    if (!parsed.ok) {
      setRepositoryError(`${parsed.error.code}: ${parsed.error.message}`);
      return;
    }

    setRepositoryError(null);
    setActiveReleaseMode("LIVE");
    setActiveRepositoryReference(parsed.reference);
    resetDemoState();
    setRepositoryMessage("Repository switched. Local decisions and activity were cleared to avoid mixing release evidence.");
    window.setTimeout(() => setRepositoryMessage(null), 3600);
  }

  return (
    <AppShell
      current="releases"
      resetAction={handleResetDemoState}
      resetMessage={resetMessage}
      status={webMcpStatus}
      toolCount={webMcpToolCatalog.length}
      contentClassName="max-w-[1520px]"
    >
      <div className="flex flex-col gap-6">
        <Hero
          eyebrow={state.mode === "LIVE" ? "Live release command center" : "Release command center"}
          title="Release Gate"
          subtitle="Agent-native software release decisions with human control. Engineering evidence is evaluated into a system recommendation; humans retain final release authority."
        >
          <div className="flex min-h-32 w-full flex-col items-start justify-start rounded-2xl border border-slate-700 bg-slate-950/55 p-4 lg:w-96">
            <p className="min-h-4 text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {state.mode === "LIVE" ? "LIVE" : "DEMO"}
            </p>
            <p className="mt-2 min-h-5 text-sm font-semibold leading-5 text-slate-100">
              {state.mode === "LIVE" && state.status !== "loading" && state.repository
                ? `${state.repository.provider === "github" ? "GitHub" : "GitLab"} · ${state.repository.fullPath}`
                : state.mode === "LIVE"
                  ? "Public repository"
                  : "Deterministic Safety Scenarios"}
            </p>
            <p className="mt-1 min-h-10 text-xs leading-5 text-slate-400">
              {state.status === "ready" && state.source
                ? `${state.source.workflow?.name ?? "Public provider"} · ${state.source.branch}${state.source.commitSha ? ` @ ${shortSha(state.source.commitSha)}` : ""}${state.source.generatedAt ? ` · Generated ${formatDateTime(state.source.generatedAt)}` : ""}`
                : ""}
            </p>
          </div>
        </Hero>

        <Panel className="p-4 sm:p-5">
          <form className="grid gap-3 lg:grid-cols-[1fr_auto]" onSubmit={handleAnalyzeRepository}>
            <label className="min-w-0">
              <span className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Public repository</span>
              <input
                className="mt-2 w-full rounded-2xl border border-slate-700 bg-slate-950 px-4 py-3 font-mono text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-300 focus:ring-2 focus:ring-cyan-300/20"
                onChange={(event) => setRepositoryUrl(event.target.value)}
                placeholder="https://github.com/org/project"
                type="url"
                value={repositoryUrl}
              />
            </label>
            <button className="self-end rounded-2xl border border-cyan-300/40 px-5 py-3 text-sm font-semibold text-cyan-100 transition hover:border-cyan-200 hover:bg-cyan-300/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" type="submit">
              Analyze repository
            </button>
          </form>
          <p className="mt-3 flex min-h-5 items-center gap-2 text-sm leading-5 text-slate-300">
            {state.mode === "LIVE" && (state.status === "ready" || state.status === "error") && state.repository ? (
              <>
                <span className="h-2 w-2 shrink-0 rounded-full bg-emerald-300" aria-hidden="true" />
                <span>
                  <span className="sr-only">Live status active. </span>LIVE · {state.repository.provider === "github" ? "GitHub" : "GitLab"} · <span className="font-mono">{state.repository.fullPath}</span>
                </span>
              </>
            ) : null}
          </p>
          {repositoryMessage ? <p className="mt-3 text-sm text-cyan-100">{repositoryMessage}</p> : null}
          {repositoryError ? <p className="mt-3 text-sm text-rose-200">{repositoryError}</p> : null}
        </Panel>

        {state.status === "error" ? (
          <ErrorState
            body={state.error.message}
            code={state.error.code}
            title="Public repository evidence is currently unavailable"
          />
        ) : (
          <>
            <section aria-label="Release summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <MetricCard label="Releases" value={summary.releases} />
              <MetricCard label="GO" tone="go" value={summary.go} />
              <MetricCard label="Conditional" tone="conditional" value={summary.conditional} />
              <MetricCard label="Blocked" tone="blocked" value={summary.blocked} />
            </section>

            <div className="grid items-start gap-6">
              <Panel className="overflow-hidden">
                <SectionHeader
                  className="min-h-34"
                  title={summary.hasOpenCandidates ? "Open candidates" : state.mode === "LIVE" ? "Live repository" : "Releases"}
                  subtitle={state.mode === "LIVE"
                    ? summary.hasOpenCandidates
                      ? "Real public GitHub Pull Requests or GitLab Merge Requests analyzed before merge. Release Gate records authorization only; it does not merge code."
                      : "No open PR/MR candidate was found, so LIVE mode is inspecting public releases or tags where available."
                    : "Deterministic Safety Scenarios: controlled scenarios for demonstrating GO, CONDITIONAL GO, NO GO, and human-governance behavior."}
                />
                {state.status === "loading" ? (
                  <p className="p-6 text-sm text-slate-300">Loading public repository…</p>
                ) : (
                  <>
                    <div className="grid gap-3 p-4 xl:hidden">
                      {state.releases.map((release) => {
                        const finalDecision = finalDecisions[release.id] ?? "PENDING";

                        return (
                          <article className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950/45 p-4" key={release.id}>
                            <div className="flex flex-wrap items-start justify-between gap-3">
                              <div className="min-w-0">
                                <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
                                  Candidate
                                </p>
                                <Link
                                  className="mt-1 inline-flex max-w-full font-semibold leading-6 text-white underline-offset-4 hover:text-cyan-100 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                                  href={releaseDetailHref(release.id)}
                                >
                                  {candidateDisplay(release, state.mode).primary}
                                </Link>
                                <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{candidateDisplay(release, state.mode).secondary}</p>
                              </div>
                              <Link
                                className="inline-flex rounded-full border border-cyan-300/30 px-3 py-1.5 text-sm font-semibold text-cyan-100 transition hover:border-cyan-200 hover:bg-cyan-300/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                                href={releaseDetailHref(release.id)}
                              >
                                View
                              </Link>
                            </div>
                            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                              <div className="sm:col-span-2">
                                <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Recommendation</dt>
                                <dd className="mt-1"><Badge tone={decisionTone(release.decision)}>{formatDecisionLabel(release.decision)}</Badge></dd>
                              </div>
                              <div>
                                <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Human Decision</dt>
                                <dd className="mt-1"><Badge tone={decisionTone(finalDecision)}>{formatDecisionLabel(finalDecision)}</Badge></dd>
                              </div>
                              <div>
                                <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Risk</dt>
                                <dd className="mt-1"><Badge tone={riskTone(release.risk)}>{release.risk}</Badge></dd>
                              </div>
                              <div>
                                <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Target</dt>
                                <dd className="mt-1 wrap-break-word font-mono text-xs text-slate-300">{candidateTarget(release)}</dd>
                              </div>
                              <div>
                                <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Updated</dt>
                                <dd className="mt-1 text-slate-300">{formatDate(release.updatedAt)}</dd>
                              </div>
                            </dl>
                          </article>
                        );
                      })}
                    </div>

                    <div className="hidden overflow-x-auto xl:block">
                      <div className={`grid min-w-305 ${candidateTableGrid} items-center gap-x-5 bg-slate-950/70 px-5 py-3 text-left text-[0.7rem] uppercase tracking-[0.12em] text-slate-500`}>
                        <div className="font-semibold">Candidate</div>
                        <div className="font-semibold">Target</div>
                        <div className="font-semibold">Risk</div>
                        <div className="whitespace-nowrap font-semibold">System Recommendation</div>
                        <div className="whitespace-nowrap font-semibold">Human Decision</div>
                        <div className="font-semibold">Updated</div>
                        <div className="font-semibold">Action</div>
                      </div>
                      <div className="divide-y divide-slate-800">
                        {state.releases.map((release) => {
                          const finalDecision = finalDecisions[release.id] ?? "PENDING";

                          return (
                            <div className={`grid min-w-305 ${candidateTableGrid} items-center gap-x-5 px-5 py-4 text-left text-sm transition hover:bg-slate-800/45`} key={release.id}>
                              <div className="min-w-0">
                                <Link
                                  className="inline-block max-w-full font-semibold leading-6 text-white underline-offset-4 hover:text-cyan-100 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                                  href={releaseDetailHref(release.id)}
                                >
                                  {candidateDisplay(release, state.mode).primary}
                                </Link>
                                <div className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{candidateDisplay(release, state.mode).secondary}</div>
                              </div>
                              <div className="min-w-0 wrap-break-word font-mono text-xs leading-5 text-slate-300">{candidateTarget(release)}</div>
                              <div className="flex items-center">
                                <Badge tone={riskTone(release.risk)}>{release.risk}</Badge>
                              </div>
                              <div className="flex items-center">
                                <Badge tone={decisionTone(release.decision)}>
                                  {formatDecisionLabel(release.decision)}
                                </Badge>
                              </div>
                              <div className="flex items-center">
                                <Badge tone={decisionTone(finalDecision)}>
                                  {formatDecisionLabel(finalDecision)}
                                </Badge>
                              </div>
                              <div className="text-slate-300">{formatDate(release.updatedAt)}</div>
                              <div>
                                <Link
                                  className="inline-flex rounded-full border border-cyan-300/30 px-3 py-1.5 text-sm font-semibold text-cyan-100 transition hover:border-cyan-200 hover:bg-cyan-300/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                                  href={releaseDetailHref(release.id)}
                                >
                                  View
                                </Link>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </>
                )}
              </Panel>

              <Panel className="overflow-hidden">
                <div className="flex flex-col gap-3 border-b border-slate-800 px-5 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between">
                  <div>
                    <h2 className="text-lg font-semibold text-white">Agent Interface</h2>
                    <p className="mt-1 text-sm leading-6 text-slate-400">
                      The same 11 WebMCP tools operate against the currently active repository or demo mode.
                    </p>
                  </div>
                  <div className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-emerald-100">
                    WebMCP Ready <span className="text-emerald-300/60">·</span> {webMcpToolCatalog.length} tools
                  </div>
                </div>
                <div className="space-y-5 p-5 sm:p-6">
                  <div className="grid gap-3 sm:grid-cols-3">
                    <MetricCard label="Tools" value={webMcpToolCatalog.length} />
                    <MetricCard
                      label="Read"
                      tone="read"
                      value={webMcpToolCatalog.filter((tool) => tool.annotations.readOnlyHint).length}
                    />
                    <MetricCard
                      label="Write"
                      tone="write"
                      value={webMcpToolCatalog.filter((tool) => !tool.annotations.readOnlyHint).length}
                    />
                  </div>
                  <div className="grid gap-5 xl:grid-cols-[minmax(0,3fr)_minmax(320px,2fr)]">
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                      <div className="flex flex-wrap items-end justify-between gap-3">
                        <div>
                          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">WebMCP Tool Catalog</p>
                          <p className="mt-2 text-sm text-slate-300">Capability surface exposed to compatible agents.</p>
                        </div>
                        <Badge tone="neutral">11 / 9 / 2</Badge>
                      </div>
                      <div className="mt-4 grid gap-3 md:grid-cols-2">
                        {toolGroups.map((group) => (
                          <div className="rounded-2xl border border-slate-800 bg-slate-950/45 p-4" key={group.heading}>
                            <h3 className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">
                              {group.heading}
                            </h3>
                            <ul className="mt-3 space-y-2">
                              {group.tools.map((toolName) => {
                                const tool = webMcpToolCatalog.find((item) => item.name === toolName);

                                if (!tool) return null;

                                return (
                                  <li className="flex items-center justify-between gap-3" key={tool.name}>
                                    <code className="text-xs font-semibold text-cyan-100 sm:text-sm">{tool.name}</code>
                                    <Badge tone={tool.annotations.readOnlyHint ? "read" : "write"}>
                                      {tool.annotations.readOnlyHint ? "Read" : "Write"}
                                    </Badge>
                                  </li>
                                );
                              })}
                            </ul>
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Try with your agent</p>
                      <p className="mt-2 text-sm text-slate-300">Agents investigate. Humans decide.</p>
                      <div className="mt-4 grid gap-3 sm:grid-cols-2">
                        {agentPlaybookPrompts.map((item) => (
                          <AgentPromptCard key={item.title} prompt={item.prompt} title={item.title} />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              </Panel>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
