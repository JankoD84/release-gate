"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { useWebMcpStatus } from "@/components/webmcp/webmcp-provider";
import { analyzeRelease } from "@/lib/decision/engine";
import type { ReleaseDecision } from "@/lib/decision/types";
import { resetDemoState } from "@/lib/decisions/demo-state";
import {
  getFinalDecision,
  subscribeToFinalDecisionChanges,
} from "@/lib/decisions/final-decision-store";
import { RELEASES } from "@/lib/releases/fixtures";
import { webMcpToolCatalog } from "@/lib/webmcp/register-tools";

const statusLabels = {
  unsupported: "UNSUPPORTED",
  registering: "REGISTERING",
  ready: "READY",
  error: "ERROR",
} as const;

const decisionStyles = {
  GO: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  CONDITIONAL_GO: "bg-amber-50 text-amber-800 ring-amber-600/20",
  NO_GO: "bg-rose-50 text-rose-700 ring-rose-600/20",
  PENDING: "bg-slate-100 text-slate-700 ring-slate-600/20",
} as const;

type HumanDecisionLabel = ReleaseDecision | "PENDING";

const releasesWithAnalysis = RELEASES.map((release) => {
  const analysis = analyzeRelease(release.id);

  return {
    release,
    analysis: analysis.ok ? analysis.data : null,
  };
});

const riskStyles = {
  LOW: "bg-slate-100 text-slate-700 ring-slate-600/20",
  MEDIUM: "bg-orange-50 text-orange-700 ring-orange-600/20",
  HIGH: "bg-red-50 text-red-700 ring-red-600/20",
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

export default function Home() {
  const webMcpStatus = useWebMcpStatus();
  const [finalDecisions, setFinalDecisions] = useState<Record<string, HumanDecisionLabel>>({});

  useEffect(() => {
    const refreshFinalDecisions = () => {
      setFinalDecisions(
        Object.fromEntries(
          RELEASES.map((release) => {
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
  }, []);

  function handleResetDemoState() {
    if (window.confirm("Reset demo state? This clears final decisions and activity.")) {
      resetDemoState();
    }
  }

  return (
    <main className="min-h-screen bg-slate-950 px-6 py-10 text-slate-100 sm:px-10">
      <div className="mx-auto flex w-full max-w-5xl flex-col gap-8">
        <section className="rounded-3xl border border-white/10 bg-white/3 p-8 shadow-2xl shadow-black/20">
          <p className="mb-3 text-sm font-semibold uppercase tracking-[0.24em] text-cyan-300">
            Phase 2 Release Evidence Surface
          </p>
          <div className="flex flex-col gap-6 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
                WebMCP Release Gate
              </h1>
              <p className="mt-4 max-w-2xl text-lg text-slate-300">
                Agent-native software release evidence with human control.
              </p>
            </div>
            <div className="rounded-2xl border border-white/10 bg-slate-900/80 p-4">
              <p className="text-sm text-slate-400">WebMCP status</p>
              <p className="mt-1 text-2xl font-semibold text-cyan-200">
                {statusLabels[webMcpStatus]}
              </p>
            </div>
          </div>
        </section>

        <section className="grid gap-4 md:grid-cols-[1fr_320px]">
          <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white text-slate-950 shadow-xl shadow-black/10">
            <div className="border-b border-slate-200 px-6 py-5">
              <h2 className="text-xl font-semibold">Synthetic releases</h2>
              <p className="mt-1 text-sm text-slate-500">
                Deterministic demo data returned by the WebMCP release tools.
              </p>
              <Link
                className="mt-3 inline-flex font-semibold text-cyan-700 underline-offset-4 hover:underline"
                href="/activity"
              >
                View activity audit trail
              </Link>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-6 py-3 font-semibold">Version</th>
                    <th className="px-6 py-3 font-semibold">System recommendation</th>
                    <th className="px-6 py-3 font-semibold">Human final decision</th>
                    <th className="px-6 py-3 font-semibold">Risk</th>
                    <th className="px-6 py-3 font-semibold">Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {releasesWithAnalysis.map(({ analysis, release }) => {
                    const finalDecision = finalDecisions[release.id] ?? "PENDING";

                    return (
                    <tr key={release.id}>
                      <td className="px-6 py-4">
                        <div className="font-semibold">{release.version}</div>
                        <div className="text-xs text-slate-500">{release.name}</div>
                      </td>
                      <td className="px-6 py-4">
                        {analysis ? (
                          <Badge className={decisionStyles[analysis.decision]}>
                            {analysis.decision}
                          </Badge>
                        ) : (
                          <span className="text-sm text-slate-500">Unavailable</span>
                        )}
                      </td>
                      <td className="px-6 py-4">
                        <Badge className={decisionStyles[finalDecision]}>
                          {finalDecision}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <Badge className={riskStyles[release.risk]}>
                          {release.risk}
                        </Badge>
                      </td>
                      <td className="px-6 py-4">
                        <Link
                          className="font-semibold text-cyan-700 underline-offset-4 hover:underline"
                          href={`/releases/${release.id}`}
                        >
                          View evidence
                        </Link>
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          <aside className="rounded-3xl border border-white/10 bg-white/4 p-6 text-slate-100">
            <p className="text-sm text-slate-400">Available WebMCP tools</p>
            <p className="mt-2 text-4xl font-semibold">
              {webMcpToolCatalog.length}
            </p>
            <div className="mt-5 flex flex-col gap-3">
              <button
                className="rounded-full border border-cyan-300/40 px-4 py-2 text-sm font-semibold text-cyan-100 hover:border-cyan-200 hover:bg-cyan-300/10"
                onClick={handleResetDemoState}
                type="button"
              >
                Reset demo state
              </button>
              {webMcpToolCatalog.map((tool) => (
                <div
                  className="rounded-2xl bg-slate-900 p-4 ring-1 ring-white/10"
                  key={tool.name}
                >
                  <p className="font-mono text-sm text-cyan-200">{tool.name}</p>
                  <p className="mt-2 text-sm leading-6 text-slate-400">
                    {tool.description}
                  </p>
                </div>
              ))}
            </div>
          </aside>
        </section>
      </div>
    </main>
  );
}
