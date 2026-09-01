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

function AgentPromptCard({ prompt, title }: { prompt: string; title: string }) {
  const [copied, setCopied] = useState(false);

  async function copyPrompt() {
    await navigator.clipboard.writeText(prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/45 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 className="text-sm font-semibold text-white">{title}</h3>
        <button className="rounded-full border border-cyan-300/30 px-3 py-1.5 text-xs font-semibold text-cyan-100 transition hover:border-cyan-200 hover:bg-cyan-300/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" onClick={copyPrompt} type="button">{copied ? "Copied" : "Copy"}</button>
      </div>
      <p className="mt-3 line-clamp-4 whitespace-pre-line text-xs leading-5 text-slate-400">{prompt}</p>
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
      pending: Object.values(finalDecisions).filter((decision) => decision === "PENDING").length,
    };
  }, [finalDecisions, state]);

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
    >
      <div className="flex flex-col gap-6">
        <Hero
          eyebrow={state.mode === "LIVE" ? "Live release command center" : "Release command center"}
          title="Release Gate"
          subtitle="Agent-native software release decisions with human control. Engineering evidence is evaluated into a system recommendation; humans retain final release authority."
        >
          <div className="rounded-2xl border border-slate-700 bg-slate-950/55 p-4">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">
              {state.mode === "LIVE" ? "LIVE" : "DEMO"}
            </p>
            <p className="mt-2 text-sm font-semibold text-slate-100">
              {state.mode === "LIVE" && state.status !== "loading" && state.repository
                ? `${state.repository.provider === "github" ? "GitHub" : "GitLab"} · ${state.repository.fullPath}`
                : state.mode === "LIVE"
                  ? "Public repository"
                  : "Deterministic Safety Scenarios"}
            </p>
            {state.status === "ready" && state.source ? (
              <p className="mt-1 text-xs text-slate-400">
                {state.source.workflow?.name ?? "Public provider"} · {state.source.branch}{state.source.commitSha ? ` @ ${shortSha(state.source.commitSha)}` : ""}{state.source.generatedAt ? ` · Generated ${formatDateTime(state.source.generatedAt)}` : ""}
              </p>
            ) : null}
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
          {state.mode === "LIVE" && (state.status === "ready" || state.status === "error") && state.repository ? (
            <p className="mt-3 text-sm text-slate-300">
              LIVE · {state.repository.provider === "github" ? "GitHub" : "GitLab"} · <span className="font-mono">{state.repository.fullPath}</span>
            </p>
          ) : null}
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
            <section aria-label="Release summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <MetricCard label={summary.hasOpenCandidates ? "Open candidates" : state.mode === "LIVE" ? "Release/tag candidates" : "Releases"} value={summary.releases} />
              <MetricCard label="GO" tone="go" value={summary.go} />
              <MetricCard label="Conditional" tone="conditional" value={summary.conditional} />
              <MetricCard label="Blocked" tone="blocked" value={summary.blocked} />
              <MetricCard label="Pending human decisions" tone="pending" value={summary.pending} />
            </section>

            <div className="grid items-start gap-6 min-[1400px]:grid-cols-[minmax(0,1fr)_340px]">
              <Panel className="overflow-hidden">
                <SectionHeader
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
                                  className="mt-1 inline-flex max-w-full truncate font-semibold text-white underline-offset-4 hover:text-cyan-100 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                                  href={releaseDetailHref(release.id)}
                                >
                                  {state.mode === "LIVE" ? candidateLabel(release) : release.version}
                                </Link>
                                <p className="mt-1 truncate text-xs leading-5 text-slate-500">{release.name}</p>
                              </div>
                              <Link
                                className="inline-flex rounded-full border border-cyan-300/30 px-3 py-1.5 text-sm font-semibold text-cyan-100 transition hover:border-cyan-200 hover:bg-cyan-300/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                                href={releaseDetailHref(release.id)}
                              >
                                View
                              </Link>
                            </div>
                            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                              <div>
                                <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Target</dt>
                                <dd className="mt-1 truncate font-mono text-xs text-slate-300">{candidateTarget(release)}</dd>
                              </div>
                              <div>
                                <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Risk</dt>
                                <dd className="mt-1"><Badge tone={riskTone(release.risk)}>{release.risk}</Badge></dd>
                              </div>
                              <div>
                                <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">System Recommendation</dt>
                                <dd className="mt-1"><Badge tone={decisionTone(release.decision)}>{formatDecisionLabel(release.decision)}</Badge></dd>
                              </div>
                              <div>
                                <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Human Decision</dt>
                                <dd className="mt-1"><Badge tone={decisionTone(finalDecision)}>{formatDecisionLabel(finalDecision)}</Badge></dd>
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

                    <div className="hidden xl:block">
                      <div className="grid grid-cols-[minmax(7rem,0.95fr)_minmax(0,0.85fr)_auto_auto_auto_minmax(5rem,0.75fr)_auto] items-center gap-x-3 bg-slate-950/70 px-4 py-3 text-left text-xs uppercase tracking-[0.12em] text-slate-500">
                        <div className="font-semibold">Candidate</div>
                        <div className="font-semibold">Target</div>
                        <div className="font-semibold">Risk</div>
                        <div className="max-w-36 font-semibold leading-5">System Recommendation</div>
                        <div className="max-w-32 font-semibold leading-5">Human Decision</div>
                        <div className="font-semibold">Updated</div>
                        <div className="font-semibold">Action</div>
                      </div>
                      <div className="divide-y divide-slate-800">
                        {state.releases.map((release) => {
                          const finalDecision = finalDecisions[release.id] ?? "PENDING";

                          return (
                            <div className="grid grid-cols-[minmax(7rem,0.95fr)_minmax(0,0.85fr)_auto_auto_auto_minmax(5rem,0.75fr)_auto] items-center gap-x-3 px-4 py-4 text-sm transition hover:bg-slate-800/45" key={release.id}>
                              <div className="min-w-0">
                                <Link
                                  className="inline-block max-w-full truncate font-semibold text-white underline-offset-4 hover:text-cyan-100 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                                  href={releaseDetailHref(release.id)}
                                >
                                  {state.mode === "LIVE" ? candidateLabel(release) : release.version}
                                </Link>
                                <div className="mt-1 truncate text-xs text-slate-500">{release.name}</div>
                              </div>
                              <div className="min-w-0 truncate font-mono text-xs text-slate-300">{candidateTarget(release)}</div>
                              <div>
                                <Badge tone={riskTone(release.risk)}>{release.risk}</Badge>
                              </div>
                              <div>
                                <Badge tone={decisionTone(release.decision)}>
                                  {formatDecisionLabel(release.decision)}
                                </Badge>
                              </div>
                              <div>
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
                <SectionHeader
                  title="Agent Interface"
                  subtitle="The same 11 WebMCP tools operate against the currently active repository or demo mode."
                />
                <div className="space-y-5 p-5 sm:p-6">
                  <div className="grid grid-cols-3 gap-3">
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
                  <div className="space-y-4">
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
                  <div className="rounded-2xl border border-slate-800 bg-slate-900/60 p-4">
                    <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Try with your agent</p>
                    <p className="mt-2 text-sm text-slate-300">Agents investigate. Humans decide.</p>
                    <div className="mt-4 grid gap-3">
                      {agentPlaybookPrompts.map((item) => (
                        <AgentPromptCard key={item.title} prompt={item.prompt} title={item.title} />
                      ))}
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
