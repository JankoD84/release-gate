export type RepositoryProvider = "github" | "gitlab";

export type RepositoryReference = {
  provider: RepositoryProvider;
  host: "github.com" | "gitlab.com";
  namespace: string;
  repository: string;
  fullPath: string;
  url: string;
};

export type RepositoryUrlErrorCode = "INVALID_REPOSITORY_URL" | "UNSUPPORTED_REPOSITORY_PROVIDER";

export type RepositoryUrlError = {
  code: RepositoryUrlErrorCode;
  message: string;
};

export type RepositoryParseResult =
  | { ok: true; reference: RepositoryReference }
  | { ok: false; error: RepositoryUrlError };

export const DEFAULT_PUBLIC_REPOSITORY_URL = "https://github.com/JankoD84/release-gate";
export const REPOSITORY_STORAGE_KEY = "release-gate:repository:v1";
export const REPOSITORY_CHANGE_EVENT = "release-gate:repository-changed";

let repositoryOverride: RepositoryReference | null | undefined;

function invalid(message = "Enter a valid HTTPS GitHub.com or GitLab.com repository URL."): RepositoryParseResult {
  return { ok: false, error: { code: "INVALID_REPOSITORY_URL", message } };
}

function unsupported(): RepositoryParseResult {
  return {
    ok: false,
    error: {
      code: "UNSUPPORTED_REPOSITORY_PROVIDER",
      message: "Only public repositories on github.com and gitlab.com are supported.",
    },
  };
}

function normalizeRepositoryName(segment: string): string | null {
  const withoutGitSuffix = segment.endsWith(".git") ? segment.slice(0, -4) : segment;

  return withoutGitSuffix.length > 0 ? withoutGitSuffix : null;
}

export function parsePublicRepositoryUrl(input: string): RepositoryParseResult {
  const trimmed = input.trim();

  if (!trimmed) {
    return invalid();
  }

  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    return invalid();
  }

  if (parsed.protocol !== "https:") {
    return invalid("Repository URLs must use HTTPS.");
  }

  if (parsed.username || parsed.password) {
    return invalid("Repository URLs must not contain credentials.");
  }

  if (parsed.search || parsed.hash || parsed.port) {
    return invalid("Repository URLs must point directly to a public repository path.");
  }

  const host = parsed.hostname.toLowerCase();
  if (host !== "github.com" && host !== "gitlab.com") {
    return unsupported();
  }

  const rawSegments = parsed.pathname.split("/").filter(Boolean);
  if (rawSegments.length < 2) {
    return invalid("Repository URL must include both namespace and repository name.");
  }

  if (rawSegments.some((segment) => segment === "." || segment === ".." || segment.includes(":") || segment.trim() !== segment || segment.length === 0 || !/^[A-Za-z0-9._-]+$/.test(segment))) {
    return invalid();
  }

  if (host === "github.com" && rawSegments.length !== 2) {
    return invalid("GitHub repository URLs must use https://github.com/{owner}/{repo}.");
  }

  const repository = normalizeRepositoryName(rawSegments[rawSegments.length - 1]);
  if (!repository) {
    return invalid("Repository URL must include a repository name.");
  }

  const namespaceSegments = rawSegments.slice(0, -1);
  if (namespaceSegments.length === 0) {
    return invalid("Repository URL must include a namespace.");
  }

  const namespace = namespaceSegments.join("/");
  const fullPath = [...namespaceSegments, repository].join("/");
  const provider: RepositoryProvider = host === "github.com" ? "github" : "gitlab";

  return {
    ok: true,
    reference: {
      provider,
      host,
      namespace,
      repository,
      fullPath,
      url: `https://${host}/${fullPath}`,
    },
  };
}

function getBrowserStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof window === "undefined") return null;

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getDefaultRepositoryReference(): RepositoryReference {
  const parsed = parsePublicRepositoryUrl(DEFAULT_PUBLIC_REPOSITORY_URL);
  if (!parsed.ok) throw new Error("Default repository URL is invalid.");

  return parsed.reference;
}

function isReference(value: unknown): value is RepositoryReference {
  return (
    typeof value === "object" &&
    value !== null &&
    "provider" in value &&
    (value.provider === "github" || value.provider === "gitlab") &&
    "host" in value &&
    (value.host === "github.com" || value.host === "gitlab.com") &&
    "namespace" in value &&
    typeof value.namespace === "string" &&
    "repository" in value &&
    typeof value.repository === "string" &&
    "fullPath" in value &&
    typeof value.fullPath === "string" &&
    "url" in value &&
    typeof value.url === "string"
  );
}

export function getActiveRepositoryReference(): RepositoryReference {
  if (repositoryOverride) return repositoryOverride;

  const stored = getBrowserStorage()?.getItem(REPOSITORY_STORAGE_KEY);
  if (stored) {
    try {
      const parsed: unknown = JSON.parse(stored);
      const candidate = isReference(parsed) ? parsePublicRepositoryUrl(parsed.url) : null;
      if (candidate?.ok) return candidate.reference;
    } catch {
      // Invalid localStorage data falls through to the safe default.
    }
  }

  return getDefaultRepositoryReference();
}

export function setActiveRepositoryReference(reference: RepositoryReference): void {
  repositoryOverride = reference;

  try {
    getBrowserStorage()?.setItem(REPOSITORY_STORAGE_KEY, JSON.stringify(reference));
  } catch {
    // Repository switching should still work in memory if localStorage fails.
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(REPOSITORY_CHANGE_EVENT, { detail: reference }));
  }
}

export function subscribeToRepositoryChanges(subscriber: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  window.addEventListener(REPOSITORY_CHANGE_EVENT, subscriber);
  window.addEventListener("storage", subscriber);

  return () => {
    window.removeEventListener(REPOSITORY_CHANGE_EVENT, subscriber);
    window.removeEventListener("storage", subscriber);
  };
}

export function setRepositoryReferenceForTests(reference: RepositoryReference | null): void {
  repositoryOverride = reference;
}
