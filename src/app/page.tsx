"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

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
import { resetDemoState } from "@/lib/decisions/demo-state";
import {
  getFinalDecision,
  subscribeToFinalDecisionChanges,
} from "@/lib/decisions/final-decision-store";
import { getActiveReleaseMode, subscribeToReleaseModeChanges, type ReleaseMode } from "@/lib/mode";
import type { LiveEvidenceDocument, LiveEvidenceError } from "@/lib/releases/live-evidence";
import { getReleaseProvider, type ReleaseWithDecision } from "@/lib/releases/providers";
import { webMcpToolCatalog } from "@/lib/webmcp/register-tools";

type HumanDecisionLabel = ReleaseDecision | "PENDING";

type ToolGroup = {
  heading: string;
  tools: readonly string[];
};

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
      source?: LiveEvidenceDocument;
    }
  | { status: "error"; mode: ReleaseMode; error: LiveEvidenceError | { code: string; message: string } };

function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

export default function Home() {
  const webMcpStatus = useWebMcpStatus();
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [finalDecisions, setFinalDecisions] = useState<Record<string, HumanDecisionLabel>>({});
  const [state, setState] = useState<DashboardState>({ status: "loading", mode: "LIVE" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const mode = getActiveReleaseMode();
      setState({ status: "loading", mode });
      const result = await getReleaseProvider(mode).listReleases();

      if (cancelled) return;

      if (!result.ok) {
        setState({ status: "error", mode, error: result.error });
        return;
      }

      setState({ status: "ready", mode, releases: result.releases, source: result.source });
    }

    load();
    const unsubscribeMode = subscribeToReleaseModeChanges(load);
    return () => {
      cancelled = true;
      unsubscribeMode();
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
              {state.mode === "LIVE" ? "JankoD84/release-gate · main" : "Deterministic Safety Scenarios"}
            </p>
            {state.status === "ready" && state.source ? (
              <p className="mt-1 text-xs text-slate-400">
                GitHub Actions · main @ {shortSha(state.source.commitSha)} · Generated {formatDateTime(state.source.generatedAt)}
              </p>
            ) : null}
          </div>
        </Hero>

        {state.status === "error" ? (
          <ErrorState
            body={`${state.error.message} Switch to Demo to explore deterministic safety scenarios.`}
            code={state.error.code}
            title="Live evidence is currently unavailable"
          />
        ) : (
          <>
            <section aria-label="Release summary" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <MetricCard label={state.mode === "LIVE" ? "Current release" : "Releases"} value={summary.releases} />
              <MetricCard label="GO" tone="go" value={summary.go} />
              <MetricCard label="Conditional" tone="conditional" value={summary.conditional} />
              <MetricCard label="Blocked" tone="blocked" value={summary.blocked} />
              <MetricCard label="Pending human decisions" tone="pending" value={summary.pending} />
            </section>

            <div className="grid gap-6 min-[1400px]:grid-cols-[minmax(0,1fr)_340px]">
              <Panel className="overflow-hidden">
                <SectionHeader
                  title={state.mode === "LIVE" ? "Live repository" : "Releases"}
                  subtitle={state.mode === "LIVE"
                    ? "Real evidence from JankoD84/release-gate main, generated by GitHub Actions."
                    : "Deterministic Safety Scenarios: controlled scenarios for demonstrating GO, CONDITIONAL GO, NO GO, and human-governance behavior."}
                />
                {state.status === "loading" ? (
                  <p className="p-6 text-sm text-slate-300">Loading release evidence…</p>
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
                                  Release
                                </p>
                                <Link
                                  className="mt-1 inline-flex max-w-full font-semibold text-white underline-offset-4 hover:text-cyan-100 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                                  href={`/releases/${release.id}`}
                                >
                                  {state.mode === "LIVE" ? shortSha(release.commitSha) : release.version}
                                </Link>
                                <p className="mt-1 truncate text-xs leading-5 text-slate-500">{release.name}</p>
                              </div>
                              <Link
                                className="inline-flex rounded-full border border-cyan-300/30 px-3 py-1.5 text-sm font-semibold text-cyan-100 transition hover:border-cyan-200 hover:bg-cyan-300/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                                href={`/releases/${release.id}`}
                              >
                                View
                              </Link>
                            </div>
                            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
                              <div>
                                <dt className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Branch</dt>
                                <dd className="mt-1 truncate font-mono text-xs text-slate-300">{release.branch}</dd>
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
                      <div className="grid grid-cols-[minmax(5.5rem,0.9fr)_minmax(0,0.8fr)_auto_auto_auto_minmax(5rem,0.75fr)_auto] items-center gap-x-3 bg-slate-950/70 px-4 py-3 text-left text-xs uppercase tracking-[0.12em] text-slate-500">
                        <div className="font-semibold">Release</div>
                        <div className="font-semibold">Branch</div>
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
                            <div className="grid grid-cols-[minmax(5.5rem,0.9fr)_minmax(0,0.8fr)_auto_auto_auto_minmax(5rem,0.75fr)_auto] items-center gap-x-3 px-4 py-4 text-sm transition hover:bg-slate-800/45" key={release.id}>
                              <div className="min-w-0">
                                <Link
                                  className="inline-block max-w-full truncate font-semibold text-white underline-offset-4 hover:text-cyan-100 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
                                  href={`/releases/${release.id}`}
                                >
                                  {state.mode === "LIVE" ? shortSha(release.commitSha) : release.version}
                                </Link>
                                <div className="mt-1 truncate text-xs text-slate-500">{release.name}</div>
                              </div>
                              <div className="min-w-0 truncate font-mono text-xs text-slate-300">{release.branch}</div>
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
                                  href={`/releases/${release.id}`}
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
                  subtitle="The same 11 WebMCP tools operate against the currently active mode."
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
                </div>
              </Panel>
            </div>
          </>
        )}
      </div>
    </AppShell>
  );
}
