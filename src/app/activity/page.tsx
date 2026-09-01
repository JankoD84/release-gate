"use client";

import { useEffect, useState } from "react";

import {
  ActivityTypeBadge,
  AppShell,
  Badge,
  EmptyState,
  formatDateTime,
  formatDecisionLabel,
  Hero,
  Panel,
  SectionHeader,
} from "@/components/release-gate/ui";
import { useWebMcpStatus } from "@/components/webmcp/webmcp-provider";
import {
  getActivityLog,
  subscribeToActivityLogChanges,
} from "@/lib/decisions/activity-store";
import { resetDemoState } from "@/lib/decisions/demo-state";
import { getActiveReleaseMode, subscribeToReleaseModeChanges } from "@/lib/mode";
import type { ActivityRecord } from "@/lib/decisions/activity-types";
import { getReleaseProvider, type ReleaseWithDecision } from "@/lib/releases/providers";
import { subscribeToRepositoryChanges } from "@/lib/releases/repository";
import { webMcpToolCatalog } from "@/lib/webmcp/register-tools";

type ActivityCandidateDisplay = {
  primary: string;
  secondary?: string;
};

function fallbackCandidateDisplay(releaseId: string): ActivityCandidateDisplay {
  if (releaseId.startsWith("live-")) return { primary: `Live candidate ${releaseId.slice(5, 12)}` };

  const canonicalParts = releaseId.split(":");
  const kind = canonicalParts.at(-2);
  const value = canonicalParts.at(-1);

  if (kind === "pr" && value) return { primary: `PR #${value}` };
  if (kind === "mr" && value) return { primary: `MR !${value}` };
  if (kind === "tag" && value) return { primary: `Tag ${value}` };
  if (kind === "release" && value) return { primary: `Release ${value}` };

  return { primary: releaseId };
}

function candidateLabel(release: ReleaseWithDecision): string {
  if (release.candidate?.candidateType === "PULL_REQUEST" && release.candidate.candidateNumber !== undefined) return `PR #${release.candidate.candidateNumber}`;
  if (release.candidate?.candidateType === "MERGE_REQUEST" && release.candidate.candidateNumber !== undefined) return `MR !${release.candidate.candidateNumber}`;
  if (release.candidate?.candidateType === "TAG") return `Tag ${release.version}`;
  return release.candidate?.candidateType === "RELEASE" ? `Release ${release.version}` : release.version;
}

function candidateBranchFlow(release: ReleaseWithDecision): string | undefined {
  const base = release.candidate?.baseBranch ?? release.branch;
  const head = release.candidate?.headBranch;

  return head ? `${head} → ${base}` : base;
}

function candidateDisplay(release: ReleaseWithDecision): ActivityCandidateDisplay {
  const secondary = candidateBranchFlow(release);

  return {
    primary: candidateLabel(release),
    ...(secondary ? { secondary } : {}),
  };
}

export default function ActivityPage() {
  const webMcpStatus = useWebMcpStatus();
  const [activities, setActivities] = useState<readonly ActivityRecord[]>([]);
  const [candidateDisplays, setCandidateDisplays] = useState<Record<string, ActivityCandidateDisplay>>({});
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  useEffect(() => {
    const refreshActivities = () => setActivities(getActivityLog(undefined, getActiveReleaseMode()).activities);

    refreshActivities();

    const unsubscribeActivity = subscribeToActivityLogChanges(refreshActivities);
    const unsubscribeMode = subscribeToReleaseModeChanges(refreshActivities);

    return () => {
      unsubscribeActivity();
      unsubscribeMode();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function refreshCandidateDisplays() {
      const result = await getReleaseProvider(getActiveReleaseMode()).listReleases();

      if (cancelled) return;

      if (!result.ok) {
        setCandidateDisplays({});
        return;
      }

      setCandidateDisplays(Object.fromEntries(result.releases.map((release) => [release.id, candidateDisplay(release)])));
    }

    refreshCandidateDisplays();
    const unsubscribeMode = subscribeToReleaseModeChanges(refreshCandidateDisplays);
    const unsubscribeRepository = subscribeToRepositoryChanges(refreshCandidateDisplays);

    return () => {
      cancelled = true;
      unsubscribeMode();
      unsubscribeRepository();
    };
  }, []);

  function handleResetDemoState() {
    if (window.confirm("Reset local decisions? This clears browser-local final decisions and activity only.")) {
      resetDemoState();
      setResetMessage("Local decisions reset.");
      window.setTimeout(() => setResetMessage(null), 2400);
    }
  }

  return (
    <AppShell
      current="activity"
      resetAction={handleResetDemoState}
      resetMessage={resetMessage}
      status={webMcpStatus}
      toolCount={webMcpToolCatalog.length}
    >
      <div className="flex flex-col gap-6">
        <Hero
          eyebrow="Audit trail"
          title="Activity"
          subtitle="Auditable human decisions and blocked authorization attempts."
        />

        <Panel className="overflow-hidden">
          <SectionHeader
            title="Recent activity"
            subtitle="Each record captures the candidate, action, outcome, recommendation, and audit summary."
          />

          {activities.length === 0 ? (
            <div className="p-6">
              <EmptyState
                title="No human decision activity recorded yet"
                body="Approve, reject, or attempt a blocked approval to populate this audit trail."
              />
            </div>
          ) : (
            <ol className="divide-y divide-slate-800">
              {activities.map((activity) => {
                const display = candidateDisplays[activity.releaseId] ?? fallbackCandidateDisplay(activity.releaseId);

                return (
                  <li className="min-w-0 p-5 sm:p-6" key={activity.id}>
                    <div className="flex min-w-0 flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Timestamp</p>
                        <time className="mt-2 block text-sm text-slate-200" dateTime={activity.timestamp}>
                          {formatDateTime(activity.timestamp)}
                        </time>
                      </div>
                      <div className="flex min-w-0 flex-wrap items-center gap-2 lg:justify-end">
                        <ActivityTypeBadge activity={activity} />
                        <Badge tone={activity.outcome === "SUCCESS" ? "pass" : "blocked"}>
                          {formatDecisionLabel(activity.outcome)}
                        </Badge>
                        {activity.recommendation ? (
                          <Badge tone="neutral">
                            System · {formatDecisionLabel(activity.recommendation)}
                          </Badge>
                        ) : null}
                        {activity.mode ? <Badge tone={activity.mode === "LIVE" ? "read" : "neutral"}>{activity.mode}</Badge> : null}
                      </div>
                    </div>

                    <div className="mt-4 grid min-w-0 gap-4 lg:grid-cols-[minmax(13rem,0.42fr)_minmax(0,1fr)] lg:items-start">
                      <div className="min-w-0 rounded-2xl border border-slate-800 bg-slate-950/35 p-4">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Candidate</p>
                        <p className="mt-2 wrap-break-word text-base font-semibold leading-6 text-slate-100">{display.primary}</p>
                        {display.secondary ? (
                          <p className="mt-1 wrap-break-word font-mono text-xs leading-5 text-slate-400">{display.secondary}</p>
                        ) : null}
                        <p className="mt-3 break-all font-mono text-[0.68rem] leading-5 text-slate-600">Internal: {activity.releaseId}</p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Audit summary</p>
                        <p className="mt-2 wrap-break-word text-sm leading-6 text-slate-300">{activity.summary}</p>
                        <p className="mt-3 wrap-break-word font-mono text-xs leading-5 text-slate-500">Tool: {activity.toolName}</p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
