import type { EvidenceProvenance, EvidenceSourceType } from "./types.ts";

const allowedHosts = new Set(["github.com", "gitlab.com"]);

function isIpAddress(hostname: string): boolean {
  return /^\d+\.\d+\.\d+\.\d+$/.test(hostname) || hostname.includes(":");
}

export function safeProviderExternalUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.trim().length === 0) {
    return undefined;
  }

  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return undefined;
    if (!allowedHosts.has(url.hostname)) return undefined;
    if (url.username || url.password) return undefined;
    if (url.hostname === "localhost" || isIpAddress(url.hostname)) return undefined;

    return url.toString();
  } catch {
    return undefined;
  }
}

export function createEvidenceProvenance(input: {
  provider: "github" | "gitlab";
  repository: string;
  sourceType: EvidenceSourceType;
  label: string;
  externalUrl?: unknown;
  observedAt?: unknown;
}): EvidenceProvenance {
  return {
    provider: input.provider,
    repository: input.repository,
    sourceType: input.sourceType,
    label: input.label,
    ...(safeProviderExternalUrl(input.externalUrl) ? { externalUrl: safeProviderExternalUrl(input.externalUrl) } : {}),
    ...(typeof input.observedAt === "string" && !Number.isNaN(Date.parse(input.observedAt)) ? { observedAt: input.observedAt } : {}),
  };
}
