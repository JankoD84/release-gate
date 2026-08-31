"use client";

import { useParams } from "next/navigation";
import { useEffect, useState } from "react";

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
import { analyzeRelease } from "@/lib/decision/engine";
import type { DecisionAnalysis, DecisionEvidenceItem } from "@/lib/decision/types";
import { resetDemoState } from "@/lib/decisions/demo-state";
import {
  approveRelease,
  getFinalDecision,
  rejectRelease,
  subscribeToFinalDecisionChanges,
} from "@/lib/decisions/final-decision-store";
import type { FinalDecisionState } from "@/lib/decisions/final-decision-types";
import { getReleaseRecordById } from "@/lib/releases/fixtures";
import type { ReleaseRecord } from "@/lib/releases/types";
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
            dominant
              ? "border-rose-400/25 bg-rose-950/30"
              : "border-slate-800 bg-slate-950/45"
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

function EvidenceCard({
  detail,
  metrics,
  status,
  title,
  tone,
}: {
  detail: string;
  metrics: readonly { label: string; value: string | number }[];
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
    </article>
  );
}

function DecisionGate({
  analysis,
  decisionState,
}: {
  analysis: DecisionAnalysis;
  decisionState: FinalDecisionState;
}) {
  const finalDecision =
    decisionState.status === "DECIDED" ? decisionState.decision.finalDecision : "PENDING";

  return (
    <Panel className="overflow-hidden">
      <SectionHeader
        title="Decision Gate"
        subtitle="System analysis informs the decision; human authority records the final release state."
      />
      <div className="grid gap-0 lg:grid-cols-[1fr_auto_1fr]">
        <div className="p-6">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            System Recommendation
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <Badge tone={decisionTone(analysis.decision)}>
              {formatDecisionLabel(analysis.decision)}
            </Badge>
            <Badge tone={riskTone(analysis.confidence)}>Confidence {analysis.confidence}</Badge>
          </div>
          <p className="mt-4 text-sm leading-6 text-slate-300">{analysis.summary}</p>
        </div>
        <div className="hidden items-center border-x border-slate-800 px-5 text-slate-500 lg:flex" aria-hidden="true">
          →
        </div>
        <div className="border-t border-slate-800 p-6 lg:border-t-0">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-slate-500">
            Human Final Decision
          </p>
          <div className="mt-4">
            <Badge tone={decisionTone(finalDecision)}>{formatDecisionLabel(finalDecision)}</Badge>
          </div>
          {decisionState.status === "DECIDED" ? (
            <dl className="mt-5 grid gap-3 text-sm text-slate-300">
              <div>
                <dt className="text-slate-500">Status</dt>
                <dd className="font-semibold text-slate-100">Decision recorded</dd>
              </div>
              <div>
                <dt className="text-slate-500">Actor</dt>
                <dd className="capitalize">{decisionState.decision.actor}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Timestamp</dt>
                <dd>{formatDateTime(decisionState.decision.decidedAt)}</dd>
              </div>
            </dl>
          ) : (
            <p className="mt-4 text-sm leading-6 text-slate-300">
              Pending human approval or rejection. The recommendation is not a final decision.
            </p>
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

  return (
    <Panel className="overflow-hidden">
      <SectionHeader
        title="Human Decision"
        subtitle="Approval and rejection are explicit human-controlled write actions."
      />
      <div className="p-6">
        {decisionState.status === "DECIDED" ? (
          <div className="rounded-2xl border border-emerald-400/25 bg-emerald-950/20 p-5">
            <Badge tone={decisionTone(decisionState.decision.finalDecision)}>
              {formatDecisionLabel(decisionState.decision.finalDecision)}
            </Badge>
            <h3 className="mt-4 text-lg font-semibold text-white">Decision recorded</h3>
            <dl className="mt-4 grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
              <div>
                <dt className="text-slate-500">Human decision</dt>
                <dd className="font-semibold text-slate-100">
                  {formatDecisionLabel(decisionState.decision.finalDecision)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Actor</dt>
                <dd className="capitalize">{decisionState.decision.actor}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="text-slate-500">Reason</dt>
                <dd>{decisionState.decision.reason}</dd>
              </div>
              <div>
                <dt className="text-slate-500">Timestamp</dt>
                <dd>{formatDateTime(decisionState.decision.decidedAt)}</dd>
              </div>
            </dl>
          </div>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-start">
            <div>
              <label className="flex gap-3 rounded-2xl border border-slate-800 bg-slate-950/45 p-4 text-sm leading-6 text-slate-300">
                <input
                  checked={acknowledgement}
                  className="mt-1 h-4 w-4 rounded border-slate-600 bg-slate-950 text-cyan-500 focus:ring-cyan-300"
                  onChange={(event) => setAcknowledgement(event.target.checked)}
                  type="checkbox"
                />
                <span>
                  I acknowledge the displayed system recommendation and release evidence before approving.
                </span>
              </label>
              {analysis.decision === "NO_GO" ? (
                <p className="mt-3 rounded-2xl border border-rose-400/25 bg-rose-950/25 p-4 text-sm font-semibold text-rose-100">
                  This release is hard-blocked and cannot be approved.
                </p>
              ) : null}
              {actionMessage ? (
                <p className="mt-4 text-sm leading-6 text-slate-300" role="status">
                  {actionMessage}
                </p>
              ) : null}
            </div>
            <div className="flex flex-wrap gap-3 lg:justify-end">
              <button
                className="rounded-full bg-emerald-500 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-emerald-400 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-200"
                disabled={!canApprove}
                onClick={onApprove}
                type="button"
              >
                Approve {formatDecisionLabel(analysis.decision)}
              </button>
              <button
                className="rounded-full border border-rose-300/35 px-4 py-2 text-sm font-semibold text-rose-100 transition hover:border-rose-200 hover:bg-rose-400/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-200"
                onClick={onReject}
                type="button"
              >
                Reject Release
              </button>
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

function ReleaseDetail({ analysis, release }: { analysis: DecisionAnalysis; release: ReleaseRecord }) {
  const webMcpStatus = useWebMcpStatus();
  const { evidence } = release;
  const [acknowledgement, setAcknowledgement] = useState(false);
  const [decisionState, setDecisionState] = useState<FinalDecisionState>({
    releaseId: release.id,
    status: "PENDING",
  });
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  useEffect(() => {
    const refreshDecision = () => setDecisionState(getFinalDecision(release.id));

    refreshDecision();

    return subscribeToFinalDecisionChanges(refreshDecision);
  }, [release.id]);

  function handleApprove() {
    const result = approveRelease(release.id, acknowledgement);

    if (result.ok) {
      setDecisionState(getFinalDecision(release.id));
      setActionMessage(`Human final decision recorded: ${formatDecisionLabel(result.decision.finalDecision)}.`);
      return;
    }

    setActionMessage(result.error.message);
  }

  function handleReject() {
    const result = rejectRelease(release.id, "Human rejected from release detail UI.");

    if (result.ok) {
      setDecisionState(getFinalDecision(release.id));
      setActionMessage("Human final decision recorded: NO GO.");
      return;
    }

    setActionMessage(result.error.message);
  }

  function handleResetDemoState() {
    if (window.confirm("Reset demo state? This clears final decisions and activity.")) {
      resetDemoState();
      setActionMessage(null);
      setAcknowledgement(false);
      setResetMessage("Demo state reset.");
      window.setTimeout(() => setResetMessage(null), 2400);
    }
  }

  return (
    <AppShell
      current="releases"
      onReset={handleResetDemoState}
      resetMessage={resetMessage}
      status={webMcpStatus}
      toolCount={webMcpToolCatalog.length}
    >
      <div className="flex flex-col gap-6">
        <Hero
          eyebrow="Release evidence"
          title={`Release ${release.version}`}
          subtitle="Evidence, system recommendation, and human final decision are separated for controlled release authority."
        >
          <div className="flex flex-wrap gap-3 rounded-2xl border border-slate-700 bg-slate-950/55 p-4">
            <Badge tone={riskTone(release.risk)}>Risk {release.risk}</Badge>
            <Badge tone={decisionTone(analysis.decision)}>
              System {formatDecisionLabel(analysis.decision)}
            </Badge>
          </div>
        </Hero>

        <Panel className="p-6">
          <dl className="grid gap-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Branch</dt>
              <dd className="mt-2 font-mono text-slate-100">{release.branch}</dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Commit SHA</dt>
              <dd className="mt-2 break-all font-mono text-slate-100">{release.commitSha}</dd>
            </div>
            <div>
              <dt className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Updated</dt>
              <dd className="mt-2 text-slate-100">{formatDate(release.updatedAt)}</dd>
            </div>
          </dl>
        </Panel>

        <DecisionGate analysis={analysis} decisionState={decisionState} />

        <Panel className="overflow-hidden">
          <SectionHeader title="Decision Analysis" subtitle="No raw JSON. Only release-relevant blockers, warnings, and conditions are shown." />
          <div className="grid gap-6 p-6 xl:grid-cols-[1fr_1fr_1fr]">
            <div className="xl:col-span-3">
              <h3 className="text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Summary</h3>
              <p className="mt-3 rounded-2xl border border-slate-800 bg-slate-950/45 p-4 text-sm leading-6 text-slate-300">
                {analysis.summary}
              </p>
            </div>
            <div className={analysis.decision === "NO_GO" ? "xl:col-span-2" : ""}>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Blocking Evidence</h3>
              <EvidenceList dominant={analysis.decision === "NO_GO"} items={analysis.blockingEvidence} />
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Warnings</h3>
              <EvidenceList items={analysis.warnings} />
            </div>
            <div>
              <h3 className="mb-3 text-sm font-semibold uppercase tracking-[0.18em] text-slate-500">Conditions</h3>
              <ConditionsList conditions={analysis.conditions} />
            </div>
          </div>
        </Panel>

        <section aria-labelledby="release-evidence-title">
          <div className="mb-4">
            <h2 className="text-lg font-semibold text-white" id="release-evidence-title">Release Evidence</h2>
            <p className="mt-1 text-sm text-slate-400">Four deterministic evidence surfaces drive the system recommendation.</p>
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <EvidenceCard
              detail={`${evidence.ci.passedJobs} / ${evidence.ci.totalJobs} jobs passed`}
              metrics={[
                { label: "Workflow", value: evidence.ci.workflow },
                { label: "Duration", value: formatDuration(evidence.ci.durationSeconds) },
                { label: "Passed", value: evidence.ci.passedJobs },
                { label: "Failed", value: evidence.ci.failedJobs },
              ]}
              status={evidence.ci.status}
              title="CI"
              tone={evidenceTone(evidence.ci.status)}
            />
            <EvidenceCard
              detail={`${evidence.tests.passed} / ${evidence.tests.total} passed · ${evidence.tests.flaky} flaky`}
              metrics={[
                { label: "Total", value: evidence.tests.total },
                { label: "Passed", value: evidence.tests.passed },
                { label: "Failed", value: evidence.tests.failed },
                { label: "Coverage", value: `${evidence.tests.coveragePercent}%` },
              ]}
              status={evidence.tests.status}
              title="Tests"
              tone={evidenceTone(evidence.tests.status)}
            />
            <EvidenceCard
              detail={`${evidence.security.critical} critical · ${evidence.security.high} high · ${evidence.security.medium} medium`}
              metrics={[
                { label: "Critical", value: evidence.security.critical },
                { label: "High", value: evidence.security.high },
                { label: "Medium", value: evidence.security.medium },
                { label: "Low", value: evidence.security.low },
              ]}
              status={evidence.security.status}
              title="Security"
              tone={evidenceTone(evidence.security.status)}
            />
            <EvidenceCard
              detail={`${evidence.changeRisk.filesChanged} files changed · ${evidence.changeRisk.changedComponents.join(", ")}`}
              metrics={[
                { label: "Files", value: evidence.changeRisk.filesChanged },
                { label: "Added", value: evidence.changeRisk.linesAdded },
                { label: "Deleted", value: evidence.changeRisk.linesDeleted },
                { label: "Components", value: evidence.changeRisk.changedComponents.length },
              ]}
              status={evidence.changeRisk.level}
              title="Change Risk"
              tone={riskTone(evidence.changeRisk.level)}
            />
          </div>
        </section>

        <HumanDecisionPanel
          acknowledgement={acknowledgement}
          actionMessage={actionMessage}
          analysis={analysis}
          decisionState={decisionState}
          onApprove={handleApprove}
          onReject={handleReject}
          setAcknowledgement={setAcknowledgement}
        />

        {decisionState.status === "PENDING" ? (
          <EmptyState
            title="No final decision recorded"
            body="The release remains pending until a human approves the recommendation or rejects the release."
          />
        ) : null}
      </div>
    </AppShell>
  );
}

export default function ReleaseDetailPage() {
  const params = useParams<{ releaseId: string }>();
  const webMcpStatus = useWebMcpStatus();
  const [resetMessage, setResetMessage] = useState<string | null>(null);
  const releaseResult = getReleaseRecordById(params.releaseId);
  const analysisResult = analyzeRelease(params.releaseId);

  function handleResetDemoState() {
    if (window.confirm("Reset demo state? This clears final decisions and activity.")) {
      resetDemoState();
      setResetMessage("Demo state reset.");
      window.setTimeout(() => setResetMessage(null), 2400);
    }
  }

  if (!releaseResult.ok) {
    return (
      <AppShell
        current="releases"
        onReset={handleResetDemoState}
        resetMessage={resetMessage}
        status={webMcpStatus}
        toolCount={webMcpToolCatalog.length}
      >
        <ErrorState
          body={releaseResult.error.message}
          code={releaseResult.error.code}
          title="Release not found"
        />
      </AppShell>
    );
  }

  if (!analysisResult.ok) {
    return (
      <AppShell
        current="releases"
        onReset={handleResetDemoState}
        resetMessage={resetMessage}
        status={webMcpStatus}
        toolCount={webMcpToolCatalog.length}
      >
        <ErrorState
          body={analysisResult.error.message}
          code={analysisResult.error.code}
          title="Release analysis unavailable"
        />
      </AppShell>
    );
  }

  return <ReleaseDetail analysis={analysisResult.data} release={releaseResult.data} />;
}
