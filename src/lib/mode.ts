export type ReleaseMode = "LIVE" | "DEMO";

export const RELEASE_MODE_STORAGE_KEY = "release-gate:mode:v1";

const RELEASE_MODE_CHANGE_EVENT = "release-gate:mode-changed";

let modeOverride: ReleaseMode | null | undefined;

export function isReleaseMode(value: unknown): value is ReleaseMode {
  return value === "LIVE" || value === "DEMO";
}

function getBrowserStorage(): Pick<Storage, "getItem" | "setItem"> | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export function getActiveReleaseMode(): ReleaseMode {
  if (modeOverride) {
    return modeOverride;
  }

  const stored = getBrowserStorage()?.getItem(RELEASE_MODE_STORAGE_KEY);

  return isReleaseMode(stored) ? stored : "LIVE";
}

export function setActiveReleaseMode(mode: ReleaseMode): void {
  modeOverride = mode;

  try {
    getBrowserStorage()?.setItem(RELEASE_MODE_STORAGE_KEY, mode);
  } catch {
    // Mode changes should still work in-memory if localStorage is unavailable.
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent(RELEASE_MODE_CHANGE_EVENT, { detail: mode }));
  }
}

export function subscribeToReleaseModeChanges(subscriber: () => void): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  window.addEventListener(RELEASE_MODE_CHANGE_EVENT, subscriber);
  window.addEventListener("storage", subscriber);

  return () => {
    window.removeEventListener(RELEASE_MODE_CHANGE_EVENT, subscriber);
    window.removeEventListener("storage", subscriber);
  };
}

export function setReleaseModeForTests(mode: ReleaseMode | null): void {
  modeOverride = mode;
}
