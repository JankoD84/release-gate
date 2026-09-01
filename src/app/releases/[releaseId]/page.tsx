"use client";

import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import {
  AppShell,
  Badge,
  decisionTone,
  EmptyState,
  ErrorState,
  evidenceTone,
  formatDate,
  formatDateTime,
  formatDecisionLabel,
  formatDuration,
  Hero,
  Panel,
  riskTone,
  SectionHeader,
} from "@/components/release-gate/ui";
import { useWebMcpStatus } from "@/components/webmcp/webmcp-provider";
import { createReleaseDecisionPacket, createReleaseDecisionPacketMarkdown } from "@/lib/decision/packet";
import type { DecisionAnalysis, DecisionEvidenceItem, RequiredAction } from "@/lib/decision/types";
import { resetDemoState } from "@/lib/decisions/demo-state";
import { getActivityLog } from "@/lib/decisions/activity-store";
import {
  getFinalDecision,
  subscribeToFinalDecisionChanges,
} from "@/lib/decisions/final-decision-store";
import type { FinalDecisionState } from "@/lib/decisions/final-decision-types";
import { getActiveReleaseMode, subscribeToReleaseModeChanges, type ReleaseMode } from "@/lib/mode";
import type { PublicRepositorySnapshot } from "@/lib/releases/public-adapters";
import { normalizeReleaseIdRouteParam } from "@/lib/releases/release-id";
import { getActiveRepositoryReference, subscribeToRepositoryChanges, type RepositoryReference } from "@/lib/releases/repository";
import { getReleaseProvider, type ReleaseProviderError } from "@/lib/releases/providers";
import type { EvidenceProvenance, ReleaseRecord } from "@/lib/releases/types";
import { webMcpToolCatalog } from "@/lib/webmcp/register-tools";

function EvidenceList({ items, dominant = false }: { items: readonly DecisionEvidenceItem[]; dominant?: boolean }) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-400">None</p>;
  }

  return (
    <ul className="space-y-3">
      {items.map((item) => (
        <li
          className={`rounded-2xl border p-4 ${
            dominant ? "border-rose-400/25 bg-rose-950/30" : "border-slate-800 bg-slate-950/45"
          }`}
          key={item.code}
        >
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={dominant ? "blocked" : "warning"}>{item.severity}</Badge>
            <span className="font-semibold text-slate-100">{item.category}</span>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-300">{item.message}</p>
        </li>
      ))}
    </ul>
  );
}

function ConditionsList({ conditions }: { conditions: readonly string[] }) {
  if (conditions.length === 0) {
    return <p className="text-sm text-slate-400">None</p>;
  }

  return (
    <ul className="space-y-3">
      {conditions.map((condition) => (
        <li className="rounded-2xl border border-amber-400/25 bg-amber-950/20 p-4 text-sm leading-6 text-amber-50" key={condition}>
          {condition}
        </li>
      ))}
    </ul>
  );
}

function RequiredActionsList({ actions, decision }: { actions: readonly RequiredAction[]; decision: DecisionAnalysis["decision"] }) {
  if (actions.length === 0) {
    return <p className="rounded-2xl border border-emerald-400/20 bg-emerald-950/15 p-4 text-sm leading-6 text-emerald-50">None — current evidence does not require remediation.</p>;
  }

  return (
    <ul className="space-y-3">
      {actions.map((action) => (
        <li className={`rounded-2xl border p-4 ${decision === "NO_GO" && action.priority === "BLOCKER" ? "border-rose-400/30 bg-rose-950/30" : "border-amber-400/25 bg-amber-950/20"}`} key={action.code}>
          <div className="flex flex-wrap items-center gap-2">
            <Badge tone={action.priority === "BLOCKER" ? "blocked" : action.priority === "REQUIRED" ? "warning" : "neutral"}>{action.priority}</Badge>
            <span className="font-semibold text-slate-100">{action.category}</span>
            <code className="text-xs text-slate-500">{action.code}</code>
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-300">{action.message}</p>
        </li>
      ))}
    </ul>
  );
}

function EvidenceSource({ provenance }: { provenance?: EvidenceProvenance }) {
  if (!provenance) {
    return null;
  }

  return (
    <div className="mt-4 rounded-2xl border border-slate-800 bg-slate-950/40 p-3 text-sm">
      <p className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-slate-500">Source</p>
      <p className="mt-1 text-slate-200">{provenance.label}</p>
      {provenance.externalUrl ? (
        <a className="mt-1 inline-block max-w-full truncate text-cyan-100 underline-offset-4 hover:underline" href={provenance.externalUrl} rel="noreferrer" target="_blank">View source →</a>
      ) : null}
    </div>
  );
}

function candidateLabel(release: ReleaseRecord): string {
  if (release.candidate?.candidateType === "PULL_REQUEST" && release.candidate.candidateNumber !== undefined) return `PR #${release.candidate.candidateNumber}`;
  if (release.candidate?.candidateType === "MERGE_REQUEST" && release.candidate.candidateNumber !== undefined) return `MR !${release.candidate.candidateNumber}`;
  if (release.candidate?.candidateType === "TAG") return `Tag ${release.version}`;
  return release.candidate?.candidateType === "RELEASE" ? `Release ${release.version}` : release.version;
}

function candidateKind(release: ReleaseRecord): string {
  if (release.candidate?.candidateType === "PULL_REQUEST") return "Pull Request";
  if (release.candidate?.candidateType === "MERGE_REQUEST") return "Merge Request";
  if (release.candidate?.candidateType === "TAG") return "Tag";
  return "Release";
}

function candidateBranchFlow(release: ReleaseRecord): string {
  const base = release.candidate?.baseBranch ?? release.branch;
  const head = release.candidate?.headBranch;

  return head ? `${head} → ${base}` : base;
}

function EvidenceCard({
  detail,
  metrics,
  provenance,
  status,
  title,
  tone,
}: {
  detail: string;
  metrics: readonly { label: string; value: string | number }[];
  provenance?: EvidenceProvenance;
  status: string;
  title: string;
  tone: ReturnType<typeof evidenceTone> | ReturnType<typeof riskTone>;
}) {
  return (
    <article className="rounded-3xl border border-slate-800 bg-slate-900/80 p-5 shadow-xl shadow-black/10">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">{title}</h3>
          <p className="mt-1 text-sm text-slate-400">{detail}</p>
        </div>
        <Badge tone={tone}>{status}</Badge>
      </div>
      <dl className="mt-5 grid grid-cols-2 gap-3">
        {metrics.map((metric) => (
          <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-3" key={metric.label}>
            <dt className="text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-slate-500">
              {metric.label}
            </dt>
            <dd className="mt-1 wrap-break-word text-lg font-semibold text-slate-100">{metric.value}</dd>
          </div>
        ))}
      </dl>
      <EvidenceSource provenance={provenance} />
    </article>
  );
}

function DecisionPacketPanel({ analysis, decisionState, mode, release, repository }: { analysis: DecisionAnalysis; decisionState: FinalDecisionState; mode: ReleaseMode; release: ReleaseRecord; repository?: RepositoryReference }) {
  const [copyMessage, setCopyMessage] = useState<string | null>(null);

  function createPacket() {
    return createReleaseDecisionPacket({
      mode,
      repository,
      release,
      analysis,
      humanDecision: decisionState,
      activities: getActivityLog(release.id, mode).activities,
    });
  }

  async function copyMarkdown() {
    const markdown = createReleaseDecisionPacketMarkdown(createPacket());
    await navigator.clipboard.writeText(markdown);
    setCopyMessage("Copied.");
    window.setTimeout(() => setCopyMessage(null), 1800);
  }

  function downloadJson() {
    const packet = createPacket();
    const blob = new Blob([JSON.stringify(packet, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `release-gate-decision-packet-${release.version.replace(/[^a-zA-Z0-9._-]/g, "-")}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <Panel className="overflow-hidden">
      <SectionHeader title="Decision Packet" subtitle="Portable release-governance artifact for handoff. It does not merge code or trigger deployment." />
      <div className="flex flex-wrap items-center gap-3 p-6">
        <button className="rounded-full border border-cyan-300/35 px-4 py-2 text-sm font-semibold text-cyan-100 transition hover:border-cyan-200 hover:bg-cyan-300/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200" onClick={copyMarkdown} type="button">Copy Markdown</button>
        <button className="rounded-full border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-slate-400 hover:bg-slate-800/60 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-300" onClick={downloadJson} type="button">Download JSON</button>
        {copyMessage ? <span className="text-sm text-cyan-100" role="status">{copyMessage}</span> : null}
      </div>
    </Panel>
  );
}

function DecisionGate({ analysis, decisionState, release }: { analysis: DecisionAnalysis; decisionState: FinalDecisionState; release: ReleaseRecord }) {
  const finalDecision = decisionState.status === "DECIDED" ? decisionState.decision.finalDecision : "PENDING";
  const isMergeCandidate = release.candidate?.candidateType === "PULL_REQUEST" || release.candidate?.candidateType === "MERGE_REQUEST";

  return (
    <Panel className="overflow-hidden">
      <SectionHeader title="Decision Gate" subtitle={isMergeCandidate ? "Merge-readiness analysis informs the recommendation; human authority records final authorization." : "System analysis informs the decision; human authority records the final release state."} />
      <div className="grid gap-0 lg:grid-cols-[1fr_auto_1fr]">
        <div className="p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">System Recommendation</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Badge tone={decisionTone(analysis.decision)}>{formatDecisionLabel(analysis.decision)}</Badge>
            <Badge tone={riskTone(analysis.confidence)}>Confidence {analysis.confidence}</Badge>
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-300">{analysis.summary}</p>
          {isMergeCandidate ? (
            <dl className="mt-5 grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
              <div><dt className="text-slate-500">Candidate</dt><dd className="font-semibold text-slate-100">{candidateLabel(release)}</dd></div>
              <div><dt className="text-slate-500">Target</dt><dd className="font-mono text-slate-100">{release.candidate?.baseBranch ?? release.branch}</dd></div>
            </dl>
          ) : null}
        </div>
        <div className="hidden items-center border-x border-slate-800 px-5 text-slate-500 lg:flex" aria-hidden="true">→</div>
        <div className="border-t border-slate-800 p-6 lg:border-t-0">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">Human Final Decision</p>
          <div className="mt-4"><Badge tone={decisionTone(finalDecision)}>{formatDecisionLabel(finalDecision)}</Badge></div>
          {decisionState.status === "DECIDED" ? (
            <dl className="mt-5 grid gap-3 text-sm text-slate-300">
              <div><dt className="text-slate-500">Status</dt><dd className="font-semibold text-slate-100">Decision recorded</dd></div>
              <div><dt className="text-slate-500">System Recommendation</dt><dd className="font-semibold text-slate-100">{formatDecisionLabel(analysis.decision)}</dd></div>
              <div><dt className="text-slate-500">Human Final Decision</dt><dd className="font-semibold text-slate-100">{formatDecisionLabel(decisionState.decision.finalDecision)}</dd></div>
              <div><dt className="text-slate-500">Actor</dt><dd className="capitalize">{decisionState.decision.actor}</dd></div>
              <div><dt className="text-slate-500">Timestamp</dt><dd>{formatDateTime(decisionState.decision.decidedAt)}</dd></div>
            </dl>
          ) : (
            <p className="mt-4 text-sm leading-6 text-slate-300">Pending human approval or rejection. The recommendation is not a final decision.</p>
          )}
        </div>
      </div>
    </Panel>
  );
}

function HumanDecisionPanel({
  acknowledgement,
  actionMessage,
  analysis,
  decisionState,
  onApprove,
  onReject,
  setAcknowledgement,
}: {
  acknowledgement: boolean;
  actionMessage: string | null;
  analysis: DecisionAnalysis;
  decisionState: FinalDecisionState;
  onApprove: () => void;
  onReject: () => void;
  setAcknowledgement: (value: boolean) => void;
}) {
  const canApprove = analysis.decision !== "NO_GO" && acknowledgement;
  const approveButtonLabel = analysis.decision === "NO_GO" ? "Approval blocked" : `Approve ${formatDecisionLabel(analysis.decision)}`;

  return (
    <Panel className="overflow-hidden">
      <SectionHeader title="Human Decision" subtitle="Approval and rejection are explicit human-controlled write actions. Release Gate records authorization only; it does not merge source code or deploy." />
      <div className="p-6">
        {decisionState.status === "DECIDED" ? (
          <div className="rounded-2xl border border-emerald-400/25 bg-emerald-950/20 p-5">
            <Badge tone={decisionTone(decisionState.decision.finalDecision)}>{formatDecisionLabel(decisionState.decision.finalDecision)}</Badge>
            <h3 className="mt-4 text-lg font-semibold text-white">Decision recorded</h3>
            <p className="mt-2 text-sm leading-6 text-slate-300">Decision recorded. Release Gate authorization does not perform an external merge or deployment.</p>
            <dl className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
              <div><dt className="text-slate-500">System Recommendation</dt><dd className="font-semibold text-slate-100">{formatDecisionLabel(analysis.decision)}</dd></div>
              <div><dt className="text-slate-500">Human Final Decision</dt><dd className="font-semibold text-slate-100">{formatDecisionLabel(decisionState.decision.finalDecision)}</dd></div>
              <div><dt className="text-slate-500">Actor</dt><dd className="capitalize">{decisionState.decision.actor}</dd></div>
              <div className="sm:col-span-2"><dt className="text-slate-500">Reason</dt><dd>{decisionState.decision.reason}</dd></div>
              <div><dt className="text-slate-500">Timestamp</dt><dd>{formatDateTime(decisionState.decision.decidedAt)}</dd></div>
            </dl>
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div>
              <label className="flex gap-3 rounded-2xl border border-slate-800 bg-slate-950/45 p-4 text-sm leading-6 text-slate-300">
                <input checked={acknowledgement} className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-950 text-cyan-500 focus:ring-cyan-300" onChange={(event) => setAcknowledgement(event.target.checked)} type="checkbox" />
                <span>I acknowledge the displayed system recommendation and evidence before recording authorization.</span>
              </label>
              {analysis.decision === "NO_GO" ? <p className="mt-3 rounded-2xl border border-rose-400/25 bg-rose-950/25 p-4 text-sm font-semibold text-rose-100">This candidate is hard-blocked and cannot be approved.</p> : null}
              {actionMessage ? <p className="mt-4 text-sm leading-6 text-slate-300" role="status">{actionMessage}</p> : null}
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <button className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200" disabled={!canApprove} onClick={onApprove} type="button">{approveButtonLabel}</button>
              <button className="rounded-full border border-rose-300/35 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:border-rose-200 hover:bg-rose-400/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-200" onClick={onReject} type="button">Reject Candidate</button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

type DetailState =
  | { status: "loading"; mode: ReleaseMode }
  | { status: "ready"; mode: ReleaseMode; release: ReleaseRecord; analysis: DecisionAnalysis; repository?: RepositoryReference; source?: PublicRepositorySnapshot["source"] }
  | { status: "error"; mode: ReleaseMode; error: ReleaseProviderError };

function coverageLabel(value: number | null): string {
  return value === null ? "N/A" : `${value}%`;
}

export default function ReleaseDetailPage() {
  const params = useParams<{ releaseId: string }>();
  const routeReleaseId = useMemo(() => normalizeReleaseIdRouteParam(params.releaseId), [params.releaseId]);
  const releaseId = routeReleaseId.ok ? routeReleaseId.releaseId : "";
  const webMcpStatus = useWebMcpStatus();
  const [acknowledgement, setAcknowledgement] = useState(false);
  const [decisionState, setDecisionState] = useState<FinalDecisionState>({ releaseId, status: "PENDING" });
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const [state, setState] = useState<DetailState>({ status: "loading", mode: "LIVE" });

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const mode = getActiveReleaseMode();
      const provider = getReleaseProvider(mode);
      const repository = mode === "LIVE" ? getActiveRepositoryReference() : undefined;
      setState({ status: "loading", mode });

      if (!routeReleaseId.ok) {
        if (!cancelled) setState({ status: "error", mode, error: routeReleaseId.error });
        return;
      }

      const release = await provider.getReleaseRecord(routeReleaseId.releaseId);

      if (!release.ok) {
        if (!cancelled) setState({ status: "error", mode, error: release.error });
        return;
      }

      const analysis = await provider.analyzeRelease(routeReleaseId.releaseId);
      const list = mode === "LIVE" ? await provider.listReleases() : undefined;

      if (cancelled) return;
      if (!analysis.ok) {
        setState({ status: "error", mode, error: analysis.error });
        return;
      }

      setState({ status: "ready", mode, release: release.data, analysis: analysis.data, repository: list?.ok ? list.repository : repository, source: list?.ok ? list.source : undefined });
    }

    load();
    const unsubscribeMode = subscribeToReleaseModeChanges(load);
    const unsubscribeRepository = subscribeToRepositoryChanges(load);
    return () => {
      cancelled = true;
      unsubscribeMode();
      unsubscribeRepository();
    };
  }, [routeReleaseId]);

  useEffect(() => {
    const refreshDecision = () => setDecisionState(routeReleaseId.ok ? getFinalDecision(routeReleaseId.releaseId) : { releaseId, status: "PENDING" });

    refreshDecision();
    return subscribeToFinalDecisionChanges(refreshDecision);
  }, [releaseId, routeReleaseId]);

  function handleResetDemoState() {
    if (window.confirm("Reset local decisions? This clears browser-local final decisions and activity only.")) {
      resetDemoState();
      setActionMessage(null);
      setAcknowledgement(false);
      setResetMessage("Local decisions reset.");
      window.setTimeout(() => setResetMessage(null), 2400);
    }
  }

  async function handleApprove() {
    if (state.status !== "ready") return;
    const result = await getReleaseProvider(state.mode).approveRelease(state.release.id, acknowledgement);

    if (result.ok) {
      setDecisionState(getFinalDecision(state.release.id));
      setActionMessage(`Human final decision recorded: ${formatDecisionLabel(result.decision.finalDecision)}.`);
      return;
    }

    setActionMessage(result.error.message);
  }

  async function handleReject() {
    if (state.status !== "ready") return;
    const result = await getReleaseProvider(state.mode).rejectRelease(state.release.id, "Human rejected from release detail UI.");

    if (result.ok) {
      setDecisionState(getFinalDecision(state.release.id));
      setActionMessage("Human final decision recorded: NO GO.");
      return;
    }

    setActionMessage(result.error.message);
  }

  if (state.status !== "ready") {
    return (
      <AppShell current="releases" resetAction={handleResetDemoState} resetMessage={resetMessage} status={webMcpStatus} toolCount={webMcpToolCatalog.length}>
        {state.status === "loading" ? (
          <Panel className="p-8"><p className="text-sm text-slate-300">Loading release evidence…</p></Panel>
        ) : (
          <ErrorState body={`${state.error.message}${state.mode === "LIVE" ? " Switch to Demo to explore deterministic safety scenarios." : ""}`} code={state.error.code} title="Release evidence unavailable" />
        )}
      </AppShell>
    );
  }

  const { analysis, release, repository, source } = state;
  const { evidence } = release;

  return (
    <AppShell current="releases" resetAction={handleResetDemoState} resetMessage={resetMessage} status={webMcpStatus} toolCount={webMcpToolCatalog.length}>
      <div className="flex flex-col gap-6">
        <Hero eyebrow={release.candidate?.candidateType === "PULL_REQUEST" || release.candidate?.candidateType === "MERGE_REQUEST" ? "Merge readiness" : "Release evidence"} title={state.mode === "LIVE" ? `${candidateKind(release)} ${candidateLabel(release).replace(/^(PR|MR) /, "")}` : `Release ${release.version}`} subtitle={`${release.name}${release.candidate?.headBranch ? ` · ${candidateBranchFlow(release)}` : ""}. Evidence, system recommendation, and human final decision are separated for controlled authority.`}>
          <div className="flex flex-wrap gap-3 rounded-2xl border border-slate-700 bg-slate-950/55 p-4">
            <Badge tone={state.mode === "LIVE" ? "read" : "neutral"}>{state.mode}</Badge>
            <Badge tone={riskTone(release.risk)}>Risk {release.risk}</Badge>
            <Badge tone={decisionTone(analysis.decision)}>System {formatDecisionLabel(analysis.decision)}</Badge>
          </div>
        </Hero>

        <Panel className="p-6">
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div><dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Source</dt><dd className="mt-2 text-slate-100">{state.mode === "LIVE" ? `LIVE ${repository?.provider === "gitlab" ? "GitLab" : "GitHub"}` : "DEMO fixtures"}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Repository</dt><dd className="mt-2 font-mono text-slate-100">{state.mode === "LIVE" ? repository?.fullPath ?? "Public repository" : "Deterministic scenarios"}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Target</dt><dd className="mt-2 min-w-0 truncate font-mono text-slate-100">{release.candidate?.baseBranch ?? release.branch}</dd></div>
            <div><dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Updated</dt><dd className="mt-2 text-slate-100">{formatDate(release.updatedAt)}</dd></div>
            {release.candidate?.headBranch ? <div><dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Source branch</dt><dd className="mt-2 min-w-0 truncate font-mono text-slate-100">{release.candidate.headBranch}</dd></div> : null}
            {release.candidate?.publicUrl ? <div><dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Provider URL</dt><dd className="mt-2 min-w-0"><a className="inline-block max-w-full truncate text-cyan-100 underline-offset-4 hover:underline" href={release.candidate.publicUrl} rel="noreferrer" target="_blank">{candidateLabel(release)}</a></dd></div> : null}
            <div className="sm:col-span-2"><dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Commit SHA</dt><dd className="mt-2 break-all font-mono text-slate-100">{release.commitSha}</dd></div>
            {source?.generatedAt ? <div><dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Generated</dt><dd className="mt-2 text-slate-100">{formatDateTime(source.generatedAt)}</dd></div> : null}
            {source?.workflow?.runUrl ? <div><dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Workflow run</dt><dd className="mt-2"><a className="text-cyan-100 underline-offset-4 hover:underline" href={source.workflow.runUrl} rel="noreferrer" target="_blank">{source.workflow.name}</a></dd></div> : null}
          </dl>
        </Panel>

        <DecisionGate analysis={analysis} decisionState={decisionState} release={release} />

        <Panel className="overflow-hidden">
          <SectionHeader title="Decision Analysis" subtitle="No raw JSON. Only release-relevant blockers, warnings, and conditions are shown." />
          <div className="grid gap-6 p-6 xl:grid-cols-[1fr_1fr_1fr]">
            <div className="xl:col-span-3"><h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Summary</h3><p className="mt-3 rounded-2xl border border-slate-800 bg-slate-950/45 p-4 text-sm leading-6 text-slate-300">{analysis.summary}</p></div>
            <div className={analysis.decision === "NO_GO" ? "xl:col-span-2" : ""}><h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Blocking Evidence</h3><EvidenceList dominant={analysis.decision === "NO_GO"} items={analysis.blockingEvidence} /></div>
            <div><h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Warnings</h3><EvidenceList items={analysis.warnings} /></div>
            <div><h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Conditions</h3><ConditionsList conditions={analysis.conditions} /></div>
          </div>
        </Panel>

        <Panel className="overflow-hidden">
          <SectionHeader title="Required Actions" subtitle="Deterministic next steps derived from the current blockers and warnings. These actions do not alter the recommendation." />
          <div className="p-6">
            <RequiredActionsList actions={analysis.requiredActions} decision={analysis.decision} />
          </div>
        </Panel>

        <section aria-labelledby="release-evidence-title">
          <div className="mb-4"><h2 className="text-lg font-semibold text-white" id="release-evidence-title">Release Evidence</h2><p className="mt-1 text-sm text-slate-400">Four deterministic evidence surfaces drive the system recommendation.</p></div>
          <div className="grid gap-4 lg:grid-cols-2">
            <EvidenceCard detail={`${evidence.ci.passedJobs} / ${evidence.ci.totalJobs} jobs passed`} metrics={[{ label: "Workflow", value: evidence.ci.workflow }, { label: "Duration", value: formatDuration(evidence.ci.durationSeconds) }, { label: "Passed", value: evidence.ci.passedJobs }, { label: "Failed", value: evidence.ci.failedJobs }]} provenance={evidence.ci.provenance} status={evidence.ci.status} title="CI" tone={evidenceTone(evidence.ci.status)} />
            <EvidenceCard detail={evidence.tests.status === "NOT_AVAILABLE" ? "No public test evidence available." : `${evidence.tests.passed} / ${evidence.tests.total} passed · ${evidence.tests.flaky} flaky`} metrics={[{ label: "Total", value: evidence.tests.total }, { label: "Passed", value: evidence.tests.passed }, { label: "Failed", value: evidence.tests.failed }, { label: "Coverage", value: coverageLabel(evidence.tests.coveragePercent) }]} provenance={evidence.tests.provenance} status={evidence.tests.status} title="Tests" tone={evidenceTone(evidence.tests.status)} />
            <EvidenceCard detail={evidence.security.status === "NOT_AVAILABLE" ? "No public security evidence available." : `${evidence.security.critical} critical · ${evidence.security.high} high · ${evidence.security.medium} medium`} metrics={[{ label: "Critical", value: evidence.security.critical }, { label: "High", value: evidence.security.high }, { label: "Medium", value: evidence.security.medium }, { label: "Low", value: evidence.security.low }]} provenance={evidence.security.provenance} status={evidence.security.status} title="Security" tone={evidenceTone(evidence.security.status)} />
            <EvidenceCard detail={`${evidence.changeRisk.filesChanged} files changed · ${evidence.changeRisk.changedComponents.join(", ")}`} metrics={[{ label: "Files", value: evidence.changeRisk.filesChanged }, { label: "Added", value: evidence.changeRisk.linesAdded }, { label: "Deleted", value: evidence.changeRisk.linesDeleted }, { label: "Components", value: evidence.changeRisk.changedComponents.length }]} provenance={evidence.changeRisk.provenance} status={evidence.changeRisk.level} title="Change Risk" tone={riskTone(evidence.changeRisk.level)} />
          </div>
        </section>

        <HumanDecisionPanel acknowledgement={acknowledgement} actionMessage={actionMessage} analysis={analysis} decisionState={decisionState} onApprove={handleApprove} onReject={handleReject} setAcknowledgement={setAcknowledgement} />

        <DecisionPacketPanel analysis={analysis} decisionState={decisionState} mode={state.mode} release={release} repository={repository} />

        {decisionState.status === "PENDING" ? <EmptyState title="No final decision recorded" body="The candidate remains pending until a human approves the recommendation or rejects the candidate." /> : null}
      </div>
    </AppShell>
  );
}
