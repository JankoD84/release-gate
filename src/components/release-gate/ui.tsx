import Link from "next/link";
import type { ReactNode } from "react";

import type { ActivityRecord } from "@/lib/decisions/activity-types";
import type { WebMcpRegistrationStatus } from "@/lib/webmcp/types";

export type BadgeTone =
  | "go"
  | "conditional"
  | "blocked"
  | "pending"
  | "low"
  | "medium"
  | "high"
  | "pass"
  | "warning"
  | "fail"
  | "neutral"
  | "read"
  | "write";

const badgeToneClasses: Record<BadgeTone, string> = {
  go: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  conditional: "border-amber-400/35 bg-amber-400/10 text-amber-200",
  blocked: "border-rose-400/35 bg-rose-400/10 text-rose-200",
  pending: "border-slate-500/40 bg-slate-400/10 text-slate-200",
  low: "border-sky-400/30 bg-sky-400/10 text-sky-200",
  medium: "border-orange-400/35 bg-orange-400/10 text-orange-200",
  high: "border-red-400/35 bg-red-400/10 text-red-200",
  pass: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  warning: "border-amber-400/35 bg-amber-400/10 text-amber-200",
  fail: "border-rose-400/35 bg-rose-400/10 text-rose-200",
  neutral: "border-slate-600/60 bg-slate-800/70 text-slate-200",
  read: "border-cyan-400/30 bg-cyan-400/10 text-cyan-200",
  write: "border-violet-400/35 bg-violet-400/10 text-violet-200",
};

const statusCopy: Record<WebMcpRegistrationStatus, { label: string; tone: BadgeTone; dot: string }> = {
  ready: { label: "Ready", tone: "pass", dot: "bg-emerald-300" },
  registering: { label: "Registering", tone: "warning", dot: "bg-amber-300" },
  unsupported: { label: "Unsupported", tone: "neutral", dot: "bg-slate-400" },
  error: { label: "Error", tone: "fail", dot: "bg-rose-300" },
};

export function formatDecisionLabel(value: string): string {
  return value.replaceAll("_", " ");
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(new Date(value));
}

export function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

export function formatDuration(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}m ${seconds}s`;
}

export function decisionTone(value: "GO" | "CONDITIONAL_GO" | "NO_GO" | "PENDING"): BadgeTone {
  if (value === "GO") return "go";
  if (value === "CONDITIONAL_GO") return "conditional";
  if (value === "NO_GO") return "blocked";
  return "pending";
}

export function riskTone(value: "LOW" | "MEDIUM" | "HIGH"): BadgeTone {
  if (value === "LOW") return "low";
  if (value === "MEDIUM") return "medium";
  return "high";
}

export function evidenceTone(value: "PASS" | "WARNING" | "FAIL"): BadgeTone {
  if (value === "PASS") return "pass";
  if (value === "WARNING") return "warning";
  return "fail";
}

export function Badge({ children, tone }: { children: ReactNode; tone: BadgeTone }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold uppercase tracking-[0.12em] ${badgeToneClasses[tone]}`}
    >
      {children}
    </span>
  );
}

export function StatusDot({ className }: { className: string }) {
  return <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${className}`} />;
}

export function WebMcpStatus({ status, toolCount }: { status: WebMcpRegistrationStatus; toolCount: number }) {
  const copy = statusCopy[status];

  return (
    <div className="flex items-center gap-3 rounded-full border border-slate-700 bg-slate-900/80 px-3 py-2 text-sm shadow-sm shadow-black/20">
      <div className="flex items-center gap-2">
        <StatusDot className={copy.dot} />
        <span className="font-semibold text-slate-100">WebMCP</span>
        <span className="text-slate-400">{copy.label}</span>
      </div>
      <span className="hidden h-4 w-px bg-slate-700 sm:block" />
      <span className="hidden text-slate-400 sm:inline">{toolCount} agent tools</span>
    </div>
  );
}

export function AppShell({
  children,
  current,
  onReset,
  resetMessage,
  status,
  toolCount,
}: {
  children: ReactNode;
  current: "releases" | "activity";
  onReset: () => void;
  resetMessage?: string | null;
  status: WebMcpRegistrationStatus;
  toolCount: number;
}) {
  return (
    <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,rgba(14,116,144,0.18),transparent_34rem),linear-gradient(180deg,#020617,#0f172a)] text-slate-100">
      <header className="sticky top-0 z-10 border-b border-slate-800/90 bg-slate-950/86 backdrop-blur">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-4 px-4 py-4 sm:px-6 lg:flex-row lg:items-center lg:justify-between lg:px-8">
          <div className="flex flex-wrap items-center gap-4">
            <Link className="group flex items-center gap-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" href="/">
              <span className="grid h-9 w-9 place-items-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-sm font-black text-cyan-100 transition group-hover:border-cyan-200/60">
                RG
              </span>
              <span>
                <span className="block text-sm font-bold uppercase tracking-[0.22em] text-white">Release Gate</span>
                <span className="block text-xs text-slate-400">Agent-native release decisions</span>
              </span>
            </Link>
            <nav aria-label="Primary navigation" className="flex items-center gap-1 rounded-full border border-slate-800 bg-slate-900/70 p-1">
              <Link
                className={`rounded-full px-3 py-1.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${
                  current === "releases" ? "bg-slate-100 text-slate-950" : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
                href="/"
              >
                Releases
              </Link>
              <Link
                className={`rounded-full px-3 py-1.5 text-sm font-semibold transition focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${
                  current === "activity" ? "bg-slate-100 text-slate-950" : "text-slate-300 hover:bg-slate-800 hover:text-white"
                }`}
                href="/activity"
              >
                Activity
              </Link>
            </nav>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <WebMcpStatus status={status} toolCount={toolCount} />
            <button
              className="rounded-full border border-slate-700 px-3 py-2 text-sm font-semibold text-slate-300 transition hover:border-slate-500 hover:bg-slate-800 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300"
              onClick={onReset}
              type="button"
            >
              Reset demo state
            </button>
          </div>
        </div>
        {resetMessage ? (
          <div className="border-t border-slate-800 bg-emerald-950/40 px-4 py-2 text-center text-sm font-medium text-emerald-100">
            {resetMessage}
          </div>
        ) : null}
      </header>
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</div>
    </main>
  );
}

export function Hero({ eyebrow, title, subtitle, children }: { eyebrow: string; title: string; subtitle: string; children?: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-3xl border border-slate-800 bg-slate-900/72 p-6 shadow-2xl shadow-black/20 sm:p-8">
      <p className="text-xs font-semibold uppercase tracking-[0.28em] text-cyan-200">{eyebrow}</p>
      <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_auto] lg:items-end">
        <div>
          <h1 className="max-w-4xl text-4xl font-semibold tracking-tight text-white sm:text-5xl">{title}</h1>
          <p className="mt-4 max-w-3xl text-base leading-7 text-slate-300 sm:text-lg">{subtitle}</p>
        </div>
        {children}
      </div>
    </section>
  );
}

export function Panel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-3xl border border-slate-800 bg-slate-900/80 shadow-xl shadow-black/15 ${className}`}>{children}</section>;
}

export function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="border-b border-slate-800 px-5 py-4 sm:px-6">
      <h2 className="text-lg font-semibold text-white">{title}</h2>
      {subtitle ? <p className="mt-1 text-sm leading-6 text-slate-400">{subtitle}</p> : null}
    </div>
  );
}

export function MetricCard({ label, value, tone = "neutral" }: { label: string; value: ReactNode; tone?: BadgeTone }) {
  return (
    <div className="rounded-2xl border border-slate-800 bg-slate-950/50 p-4">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
      <div className="mt-2 flex items-center gap-2 text-2xl font-semibold text-white">
        <span>{value}</span>
        {tone !== "neutral" ? <span className={`h-2 w-2 rounded-full ${statusDotForTone(tone)}`} /> : null}
      </div>
    </div>
  );
}

function statusDotForTone(tone: BadgeTone): string {
  if (tone === "go" || tone === "pass" || tone === "low") return "bg-emerald-300";
  if (tone === "conditional" || tone === "warning" || tone === "medium") return "bg-amber-300";
  if (tone === "blocked" || tone === "fail" || tone === "high") return "bg-rose-300";
  return "bg-slate-400";
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-slate-700 bg-slate-950/40 p-6 text-center">
      <p className="font-semibold text-slate-100">{title}</p>
      <p className="mt-2 text-sm leading-6 text-slate-400">{body}</p>
    </div>
  );
}

export function ErrorState({ code, title, body }: { code: string; title: string; body: string }) {
  return (
    <Panel className="p-8">
      <Badge tone="fail">{code}</Badge>
      <h1 className="mt-4 text-3xl font-semibold text-white">{title}</h1>
      <p className="mt-3 max-w-2xl text-sm leading-6 text-slate-300">{body}</p>
      <Link className="mt-6 inline-flex rounded-full border border-slate-700 px-4 py-2 text-sm font-semibold text-slate-200 transition hover:border-cyan-300 hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300" href="/">
        Back to releases
      </Link>
    </Panel>
  );
}

export function ActivityTypeBadge({ activity }: { activity: ActivityRecord }) {
  if (activity.type === "APPROVAL" && activity.outcome === "RELEASE_BLOCKED") {
    return <Badge tone="blocked">Blocked approval</Badge>;
  }

  if (activity.type === "APPROVAL") return <Badge tone="go">Approval</Badge>;
  if (activity.type === "REJECTION") return <Badge tone="blocked">Rejection</Badge>;
  return <Badge tone="read">Analysis</Badge>;
}
