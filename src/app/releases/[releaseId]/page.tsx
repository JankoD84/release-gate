"use client";

import Link from "next/link";
import { useParams } from "next/navigation";

import { analyzeRelease } from "@/lib/decision/engine";
import type { DecisionAnalysis, DecisionEvidenceItem } from "@/lib/decision/types";
import { getReleaseRecordById } from "@/lib/releases/fixtures";
import type { ReleaseRecord } from "@/lib/releases/types";

const decisionStyles = {
  GO: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  CONDITIONAL_GO: "bg-amber-50 text-amber-800 ring-amber-600/20",
  NO_GO: "bg-rose-50 text-rose-700 ring-rose-600/20",
} as const;

const riskStyles = {
  LOW: "bg-slate-100 text-slate-700 ring-slate-600/20",
  MEDIUM: "bg-orange-50 text-orange-700 ring-orange-600/20",
  HIGH: "bg-red-50 text-red-700 ring-red-600/20",
} as const;

const gateStyles = {
  PASS: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  WARNING: "bg-amber-50 text-amber-800 ring-amber-600/20",
  FAIL: "bg-rose-50 text-rose-700 ring-rose-600/20",
} as const;

function Badge({ children, className }: { children: string; className: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${className}`}
    >
      {children}
    </span>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </p>
      <p className="mt-2 text-2xl font-semibold text-slate-950">{value}</p>
    </div>
  );
}

function EvidenceList({ items }: { items: readonly DecisionEvidenceItem[] }) {
  if (items.length === 0) {
    return <p className="text-sm text-slate-500">None</p>;
  }

  return (
    <ul className="space-y-2 text-sm leading-6 text-slate-600">
      {items.map((item) => (
        <li key={item.code}>
          <span className="font-semibold text-slate-800">{item.category}:</span>{" "}
          {item.message}
        </li>
      ))}
    </ul>
  );
}

function ConditionsList({ conditions }: { conditions: readonly string[] }) {
  if (conditions.length === 0) {
    return <p className="text-sm text-slate-500">None</p>;
  }

  return (
    <ul className="list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">
      {conditions.map((condition) => (
        <li key={condition}>{condition}</li>
      ))}
    </ul>
  );
}

function EvidenceSection({
  children,
  title,
}: {
  children: React.ReactNode;
  title: string;
}) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-6 text-slate-950 shadow-xl shadow-black/10">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-5">{children}</div>
    </section>
  );
}

function ReleaseDetail({
  analysis,
  release,
}: {
  analysis: DecisionAnalysis;
  release: ReleaseRecord;
}) {
  const { evidence } = release;

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100 sm:px-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-6">
        <Link
          className="w-fit font-semibold text-cyan-200 underline-offset-4 hover:underline"
          href="/"
        >
          ← Back to releases
        </Link>

        <header className="rounded-3xl border border-white/10 bg-white/3 p-8 shadow-2xl shadow-black/20">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">
            Release evidence
          </p>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                {release.name}
              </h1>
              <dl className="mt-5 grid gap-3 text-sm text-slate-300 sm:grid-cols-2">
                <div>
                  <dt className="text-slate-500">Version</dt>
                  <dd className="font-mono text-slate-100">{release.version}</dd>
                </div>
                <div>
                  <dt className="text-slate-500">Branch</dt>
                  <dd className="font-mono text-slate-100">{release.branch}</dd>
                </div>
                <div className="sm:col-span-2">
                  <dt className="text-slate-500">Commit SHA</dt>
                  <dd className="break-all font-mono text-slate-100">
                    {release.commitSha}
                  </dd>
                </div>
              </dl>
            </div>
            <div className="flex flex-wrap gap-3 rounded-2xl border border-white/10 bg-slate-900/80 p-4">
              <Badge className={decisionStyles[analysis.decision]}>
                {analysis.decision}
              </Badge>
              <Badge className={riskStyles[release.risk]}>{release.risk}</Badge>
            </div>
          </div>
        </header>

        <EvidenceSection title="Decision Analysis">
          <div className="mb-5 flex flex-wrap gap-3">
            <Badge className={decisionStyles[analysis.decision]}>
              {analysis.decision}
            </Badge>
            <Badge className={riskStyles[analysis.confidence]}>
              {analysis.confidence}
            </Badge>
          </div>
          <p className="text-sm leading-6 text-slate-600">{analysis.summary}</p>
          <div className="mt-6 grid gap-5 lg:grid-cols-3">
            <div>
              <h3 className="font-semibold">Blocking evidence</h3>
              <div className="mt-3">
                <EvidenceList items={analysis.blockingEvidence} />
              </div>
            </div>
            <div>
              <h3 className="font-semibold">Warnings</h3>
              <div className="mt-3">
                <EvidenceList items={analysis.warnings} />
              </div>
            </div>
            <div>
              <h3 className="font-semibold">Conditions</h3>
              <div className="mt-3">
                <ConditionsList conditions={analysis.conditions} />
              </div>
            </div>
          </div>
        </EvidenceSection>

        <EvidenceSection title="CI">
          <div className="mb-5">
            <Badge className={gateStyles[evidence.ci.status]}>
              {evidence.ci.status}
            </Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Workflow" value={evidence.ci.workflow} />
            <Stat label="Total jobs" value={evidence.ci.totalJobs} />
            <Stat label="Passed jobs" value={evidence.ci.passedJobs} />
            <Stat label="Failed jobs" value={evidence.ci.failedJobs} />
            <Stat label="Duration" value={`${evidence.ci.durationSeconds}s`} />
          </div>
        </EvidenceSection>

        <EvidenceSection title="Tests">
          <div className="mb-5">
            <Badge className={gateStyles[evidence.tests.status]}>
              {evidence.tests.status}
            </Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
            <Stat label="Total" value={evidence.tests.total} />
            <Stat label="Passed" value={evidence.tests.passed} />
            <Stat label="Failed" value={evidence.tests.failed} />
            <Stat label="Flaky" value={evidence.tests.flaky} />
            <Stat label="Coverage" value={`${evidence.tests.coveragePercent}%`} />
          </div>
        </EvidenceSection>

        <EvidenceSection title="Security">
          <div className="mb-5">
            <Badge className={gateStyles[evidence.security.status]}>
              {evidence.security.status}
            </Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Critical" value={evidence.security.critical} />
            <Stat label="High" value={evidence.security.high} />
            <Stat label="Medium" value={evidence.security.medium} />
            <Stat label="Low" value={evidence.security.low} />
          </div>
        </EvidenceSection>

        <EvidenceSection title="Change Risk">
          <div className="mb-5">
            <Badge className={riskStyles[evidence.changeRisk.level]}>
              {evidence.changeRisk.level}
            </Badge>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label="Files changed" value={evidence.changeRisk.filesChanged} />
            <Stat label="Lines added" value={evidence.changeRisk.linesAdded} />
            <Stat label="Lines deleted" value={evidence.changeRisk.linesDeleted} />
            <Stat
              label="Components"
              value={evidence.changeRisk.changedComponents.length}
            />
          </div>
          <div className="mt-6 grid gap-5 lg:grid-cols-2">
            <div>
              <h3 className="font-semibold">Changed components</h3>
              <ul className="mt-3 flex flex-wrap gap-2">
                {evidence.changeRisk.changedComponents.map((component) => (
                  <li
                    className="rounded-full bg-slate-100 px-3 py-1 text-sm font-medium text-slate-700"
                    key={component}
                  >
                    {component}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-semibold">Reasons</h3>
              <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-600">
                {evidence.changeRisk.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </div>
          </div>
        </EvidenceSection>
      </div>
    </main>
  );
}

export default function ReleaseDetailPage() {
  const params = useParams<{ releaseId: string }>();
  const releaseResult = getReleaseRecordById(params.releaseId);
  const analysisResult = analyzeRelease(params.releaseId);

  if (!releaseResult.ok) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100 sm:px-10">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          <Link
            className="w-fit font-semibold text-cyan-200 underline-offset-4 hover:underline"
            href="/"
          >
            ← Back to releases
          </Link>
          <section className="rounded-3xl border border-rose-400/30 bg-rose-950/30 p-8">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-rose-200">
              {releaseResult.error.code}
            </p>
            <h1 className="mt-3 text-3xl font-semibold text-white">
              Release not found
            </h1>
            <p className="mt-4 text-slate-300">{releaseResult.error.message}</p>
          </section>
        </div>
      </main>
    );
  }

  if (!analysisResult.ok) {
    return (
      <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100 sm:px-10">
        <div className="mx-auto flex w-full max-w-3xl flex-col gap-6">
          <Link
            className="w-fit font-semibold text-cyan-200 underline-offset-4 hover:underline"
            href="/"
          >
            ← Back to releases
          </Link>
          <section className="rounded-3xl border border-rose-400/30 bg-rose-950/30 p-8">
            <p className="text-sm font-semibold uppercase tracking-[0.24em] text-rose-200">
              {analysisResult.error.code}
            </p>
            <h1 className="mt-3 text-3xl font-semibold text-white">
              Release analysis unavailable
            </h1>
            <p className="mt-4 text-slate-300">{analysisResult.error.message}</p>
          </section>
        </div>
      </main>
    );
  }

  return <ReleaseDetail analysis={analysisResult.data} release={releaseResult.data} />;
}
