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
import type { ActivityRecord } from "@/lib/decisions/activity-types";
import { webMcpToolCatalog } from "@/lib/webmcp/register-tools";

export default function ActivityPage() {
  const webMcpStatus = useWebMcpStatus();
  const [activities, setActivities] = useState<readonly ActivityRecord[]>([]);
  const [resetMessage, setResetMessage] = useState<string | null>(null);

  useEffect(() => {
    const refreshActivities = () => setActivities(getActivityLog().activities);

    refreshActivities();

    return subscribeToActivityLogChanges(refreshActivities);
  }, []);

  function handleResetDemoState() {
    if (window.confirm("Reset demo state? This clears final decisions and activity.")) {
      resetDemoState();
      setResetMessage("Demo state reset.");
      window.setTimeout(() => setResetMessage(null), 2400);
    }
  }

  return (
    <AppShell
      current="activity"
      onReset={handleResetDemoState}
      resetMessage={resetMessage}
      status={webMcpStatus}
      toolCount={webMcpToolCatalog.length}
    >
      <div className="flex flex-col gap-6">
        <Hero
          eyebrow="Audit trail"
          title="Activity"
          subtitle="Auditable human release decisions and blocked approval attempts."
        />

        <Panel className="overflow-hidden">
          <SectionHeader
            title="Recent activity"
            subtitle="Each record identifies the release, activity type, WebMCP tool, outcome, and summary."
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
              {activities.map((activity) => (
                <li className="grid gap-4 p-5 sm:p-6 lg:grid-cols-[190px_190px_minmax(0,1fr)]" key={activity.id}>
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Timestamp</p>
                    <time className="mt-2 block text-sm text-slate-200" dateTime={activity.timestamp}>
                      {formatDateTime(activity.timestamp)}
                    </time>
                  </div>
                  <div className="space-y-3">
                    <ActivityTypeBadge activity={activity} />
                    <div>
                      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">Release</p>
                      <p className="mt-1 font-mono text-sm text-slate-100">{activity.releaseId}</p>
                    </div>
                  </div>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={activity.outcome === "SUCCESS" ? "pass" : "blocked"}>
                        {formatDecisionLabel(activity.outcome)}
                      </Badge>
                      {activity.recommendation ? (
                        <Badge tone="neutral">
                          Recommendation {formatDecisionLabel(activity.recommendation)}
                        </Badge>
                      ) : null}
                    </div>
                    <p className="mt-3 text-sm leading-6 text-slate-300">{activity.summary}</p>
                    <p className="mt-3 font-mono text-xs text-slate-500">Tool: {activity.toolName}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </Panel>
      </div>
    </AppShell>
  );
}
