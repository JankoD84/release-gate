import type { RepositoryReference } from "./repository.ts";
import type { ReleaseNotFoundError } from "./types.ts";

export function createCanonicalReleaseId(reference: RepositoryReference, type: string, label: string | number): string {
  return `${reference.provider}:${reference.fullPath}:${type}:${String(label)}`;
}

const RELEASE_ID_ROUTE_PREFIX = "rid_";

function toBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);

  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", "");
}

function fromBase64Url(value: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;

  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");

  try {
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

export function releaseDetailHref(releaseId: string): string {
  return `/releases/${RELEASE_ID_ROUTE_PREFIX}${toBase64Url(releaseId)}`;
}

function releaseNotFound(releaseId: string): ReleaseNotFoundError {
  return {
    code: "RELEASE_NOT_FOUND",
    releaseId,
    message: `Release '${releaseId}' was not found.`,
  };
}

export function normalizeReleaseIdRouteParam(param: string | readonly string[] | undefined):
  | { ok: true; releaseId: string }
  | { ok: false; error: ReleaseNotFoundError } {
  const raw = Array.isArray(param) ? param[0] : param;

  if (typeof raw !== "string" || raw.length === 0) {
    return { ok: false, error: releaseNotFound("") };
  }

  if (raw.startsWith(RELEASE_ID_ROUTE_PREFIX)) {
    const decoded = fromBase64Url(raw.slice(RELEASE_ID_ROUTE_PREFIX.length));
    return decoded ? { ok: true, releaseId: decoded } : { ok: false, error: releaseNotFound(raw) };
  }

  try {
    return { ok: true, releaseId: decodeURIComponent(raw) };
  } catch {
    return { ok: false, error: releaseNotFound(raw) };
  }
}
