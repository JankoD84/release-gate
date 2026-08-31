import {
  LIVE_EVIDENCE_ASSET_NAME,
  LIVE_EVIDENCE_RELEASE_TAG,
  LIVE_REPOSITORY,
  validateLiveEvidenceDocument,
} from "@/lib/releases/live-evidence";

export const dynamic = "force-dynamic";
export const revalidate = 45;

const githubApiHeaders = {
  Accept: "application/vnd.github+json",
  "User-Agent": "release-gate-live-evidence",
};

function unavailable(message: string, status = 503): Response {
  return Response.json(
    {
      code: "LIVE_EVIDENCE_UNAVAILABLE",
      message,
    },
    { status },
  );
}

function invalid(message: string): Response {
  return Response.json(
    {
      code: "LIVE_EVIDENCE_INVALID",
      message,
    },
    { status: 502 },
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export async function GET() {
  const releaseUrl = `https://api.github.com/repos/${LIVE_REPOSITORY}/releases/tags/${LIVE_EVIDENCE_RELEASE_TAG}`;
  let releaseResponse: Response;

  try {
    releaseResponse = await fetch(releaseUrl, {
      headers: githubApiHeaders,
      next: { revalidate },
    });
  } catch {
    return unavailable("Live evidence is currently unavailable. Switch to Demo to explore deterministic safety scenarios.");
  }

  if (!releaseResponse.ok) {
    return unavailable("Live evidence is currently unavailable. Switch to Demo to explore deterministic safety scenarios.");
  }

  let releaseMetadata: unknown;

  try {
    releaseMetadata = await releaseResponse.json();
  } catch {
    return invalid("GitHub release metadata was not valid JSON.");
  }

  if (!isRecord(releaseMetadata) || !Array.isArray(releaseMetadata.assets)) {
    return invalid("GitHub release metadata did not include a valid asset list.");
  }

  const asset = releaseMetadata.assets.find(
    (candidate: unknown) =>
      isRecord(candidate) &&
      candidate.name === LIVE_EVIDENCE_ASSET_NAME &&
      typeof candidate.browser_download_url === "string",
  );

  if (!isRecord(asset) || typeof asset.browser_download_url !== "string") {
    return unavailable("Live evidence asset is not published yet. Switch to Demo to explore deterministic safety scenarios.");
  }

  let evidenceResponse: Response;

  try {
    evidenceResponse = await fetch(asset.browser_download_url, {
      headers: { Accept: "application/json", "User-Agent": "release-gate-live-evidence" },
      next: { revalidate },
    });
  } catch {
    return unavailable("Live evidence asset could not be downloaded.");
  }

  if (!evidenceResponse.ok) {
    return unavailable("Live evidence asset could not be downloaded.");
  }

  let evidencePayload: unknown;

  try {
    evidencePayload = await evidenceResponse.json();
  } catch {
    return invalid("Live evidence asset was not valid JSON.");
  }
  const validation = validateLiveEvidenceDocument(evidencePayload);

  if (!validation.ok) {
    return invalid(validation.error.message);
  }

  return Response.json(validation.document, {
    headers: {
      "Cache-Control": "public, s-maxage=45, stale-while-revalidate=15",
    },
  });
}
