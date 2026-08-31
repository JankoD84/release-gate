"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import {
  getActivityLog,
  subscribeToActivityLogChanges,
} from "@/lib/decisions/activity-store";
import { resetDemoState } from "@/lib/decisions/demo-state";
import type { ActivityRecord } from "@/lib/decisions/activity-types";

const activityStyles = {
  ANALYSIS: "bg-cyan-50 text-cyan-700 ring-cyan-600/20",
  APPROVAL: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  REJECTION: "bg-rose-50 text-rose-700 ring-rose-600/20",
} as const;

function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat("en", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(new Date(timestamp));
}

function Badge({ children, className }: { children: string; className: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${className}`}
    >
      {children}
    </span>
  );
}

export default function ActivityPage() {
  const [activities, setActivities] = useState<readonly ActivityRecord[]>([]);

  useEffect(() => {
    const refreshActivities = () => setActivities(getActivityLog().activities);

    refreshActivities();

    return subscribeToActivityLogChanges(refreshActivities);
  }, []);

  function handleResetDemoState() {
    if (window.confirm("Reset demo state? This clears final decisions and activity.")) {
      resetDemoState();
    }
  }

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
            Activity audit trail
          </p>
          <h1 className="text-4xl font-semibold tracking-tight text-white sm:text-5xl">
            Release Gate Activity
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-slate-300">
            Chronological analysis and human decision events recorded in the current demo session.
          </p>
          <button
            className="mt-6 rounded-full border border-cyan-300/40 px-4 py-2 text-sm font-semibold text-cyan-100 hover:border-cyan-200 hover:bg-cyan-300/10"
            onClick={handleResetDemoState}
            type="button"
          >
            Reset demo state
          </button>
        </header>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white text-slate-950 shadow-xl shadow-black/10">
          <div className="border-b border-slate-200 px-6 py-5">
            <h2 className="text-xl font-semibold">Recent activity</h2>
            <p className="mt-1 text-sm text-slate-500">
              No fake static entries are shown; this list is populated only by tool and UI activity.
            </p>
          </div>

          {activities.length === 0 ? (
            <p className="px-6 py-8 text-sm text-slate-500">
              No activity recorded yet. Analyze, approve, or reject a release to create audit entries.
            </p>
          ) : (
            <ol className="divide-y divide-slate-100">
              {activities.map((activity) => (
                <li
                  className="grid gap-4 px-6 py-5 md:grid-cols-[100px_130px_1fr] md:items-center"
                  key={activity.id}
                >
                  <time className="font-mono text-sm text-slate-500">
                    {formatTime(activity.timestamp)}
                  </time>
                  <Badge className={activityStyles[activity.type]}>
                    {activity.type}
                  </Badge>
                  <div>
                    <p className="font-semibold text-slate-950">
                      {activity.releaseId}
                      {activity.recommendation ? ` · ${activity.recommendation}` : ""}
                    </p>
                    <p className="mt-1 text-sm leading-6 text-slate-600">
                      {activity.summary}
                    </p>
                    <p className="mt-1 font-mono text-xs text-slate-400">
                      {activity.toolName} · {activity.outcome}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </section>
      </div>
    </main>
  );
}
