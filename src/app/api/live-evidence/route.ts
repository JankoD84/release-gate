import { GitHubPublicRepositoryAdapter, GitLabPublicRepositoryAdapter } from "@/lib/releases/public-adapters";
import { DEFAULT_PUBLIC_REPOSITORY_URL, parsePublicRepositoryUrl } from "@/lib/releases/repository";

export const dynamic = "force-dynamic";
export const revalidate = 45;

function errorResponse(error: { code: string; message: string; status?: number }, fallbackStatus = 400): Response {
  const status =
    error.status ??
    (error.code === "REPOSITORY_NOT_FOUND"
      ? 404
      : error.code === "PROVIDER_RATE_LIMITED"
        ? 429
        : error.code === "PROVIDER_UNAVAILABLE" || error.code === "EVIDENCE_NOT_AVAILABLE"
          ? 503
          : fallbackStatus);

  return Response.json(
    {
      code: error.code,
      message: error.message,
    },
    { status },
  );
}

export async function GET(request: Request) {
  const requestedUrl = new URL(request.url).searchParams.get("repositoryUrl") ?? DEFAULT_PUBLIC_REPOSITORY_URL;
  const parsed = parsePublicRepositoryUrl(requestedUrl);

  if (!parsed.ok) {
    return errorResponse(parsed.error, parsed.error.code === "UNSUPPORTED_REPOSITORY_PROVIDER" ? 422 : 400);
  }

  const adapter = parsed.reference.provider === "github" ? new GitHubPublicRepositoryAdapter() : new GitLabPublicRepositoryAdapter();
  const result = await adapter.getSnapshot(parsed.reference);

  if (!result.ok) {
    return errorResponse(result.error);
  }

  return Response.json(result.snapshot, {
    headers: {
      "Cache-Control": "public, s-maxage=45, stale-while-revalidate=15",
    },
  });
}
