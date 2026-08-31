import { analyzeRelease } from "@/lib/decision/engine";
import type { DecisionAnalysis, ReleaseDecision } from "@/lib/decision/types";
import {
  getChangeRiskEvidenceByReleaseId,
  getCiEvidenceByReleaseId,
  getReleaseById,
  getSecurityEvidenceByReleaseId,
  getTestEvidenceByReleaseId,
  RELEASES,
} from "@/lib/releases/fixtures";
import type {
  ChangeRiskEvidence,
  CiEvidence,
  Release,
  ReleaseLookupResult,
  ReleaseNotFoundError,
  SecurityEvidence,
  TestEvidence,
} from "@/lib/releases/types";
import type { WebMcpRegistrationResult, WebMcpToolContract } from "./types";

const REGISTRATION_KEY = "__webMcpReleaseGateWebMcpRegistration__";

type ReleaseWithDecision = Release & {
  decision: ReleaseDecision;
};

type ListReleasesResult = {
  releases: readonly ReleaseWithDecision[];
};

type ReleaseIdInput = {
  releaseId: string;
};

type AnalysisToolResult =
  | {
      analysis: DecisionAnalysis;
    }
  | {
      error: ReleaseNotFoundError;
    };

type ToolLookupResult<T> =
  | {
      releaseId: string;
      evidence: T;
    }
  | {
      error: ReleaseNotFoundError;
    };

type GetReleaseToolResult =
  | {
      release: ReleaseWithDecision;
    }
  | {
      error: ReleaseNotFoundError;
    };

type RegistrationStore = {
  controller: AbortController | null;
  promise: Promise<void> | null;
  refCount: number;
};

type WebMcpGlobal = typeof globalThis & {
  [REGISTRATION_KEY]?: RegistrationStore;
};

const emptyInputSchema = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
} as const;

const releaseIdInputSchema = {
  type: "object",
  properties: {
    releaseId: {
      type: "string",
    },
  },
  required: ["releaseId"],
  additionalProperties: false,
} as const;

export const webMcpToolCatalog = [
  {
    name: "list_releases",
    description:
      "List available software releases with their current release decision and risk level.",
    inputSchema: emptyInputSchema,
    annotations: {
      readOnlyHint: true,
    },
  },
  {
    name: "get_release",
    description:
      "Get metadata and current release decision for a specific software release.",
    inputSchema: releaseIdInputSchema,
    annotations: {
      readOnlyHint: true,
    },
  },
  {
    name: "get_ci_status",
    description:
      "Get continuous integration status and job results for a specific software release.",
    inputSchema: releaseIdInputSchema,
    annotations: {
      readOnlyHint: true,
    },
  },
  {
    name: "get_test_results",
    description:
      "Get automated test results, flaky tests, and coverage for a specific software release.",
    inputSchema: releaseIdInputSchema,
    annotations: {
      readOnlyHint: true,
    },
  },
  {
    name: "get_security_findings",
    description:
      "Get security finding counts and security gate status for a specific software release.",
    inputSchema: releaseIdInputSchema,
    annotations: {
      readOnlyHint: true,
    },
  },
  {
    name: "get_change_risk",
    description:
      "Get the code-change risk assessment and affected components for a specific software release.",
    inputSchema: releaseIdInputSchema,
    annotations: {
      readOnlyHint: true,
    },
  },
  {
    name: "analyze_release",
    description:
      "Analyze software release evidence and return a deterministic GO, CONDITIONAL GO, or NO GO recommendation with blockers, warnings, and conditions.",
    inputSchema: releaseIdInputSchema,
    annotations: {
      readOnlyHint: true,
    },
  },
] as const satisfies readonly WebMcpToolContract[];

export const listReleasesToolContract = webMcpToolCatalog[0];

function getRegistrationStore(): RegistrationStore {
  const webMcpGlobal = globalThis as WebMcpGlobal;

  webMcpGlobal[REGISTRATION_KEY] ??= {
    controller: null,
    promise: null,
    refCount: 0,
  };

  return webMcpGlobal[REGISTRATION_KEY];
}

function normalizeReleaseIdInput(input: unknown): ReleaseIdInput {
  if (
    typeof input === "object" &&
    input !== null &&
    "releaseId" in input &&
    typeof input.releaseId === "string"
  ) {
    return {
      releaseId: input.releaseId,
    };
  }

  return {
    releaseId: "",
  };
}

function mapReleaseLookupResult<T>(
  releaseId: string,
  result: ReleaseLookupResult<T>,
): ToolLookupResult<T> {
  return result.ok
    ? {
        releaseId,
        evidence: result.data,
      }
    : {
        error: result.error,
      };
}

function getReleaseDecision(releaseId: string): ReleaseDecision {
  const analysis = analyzeRelease(releaseId);

  return analysis.ok ? analysis.data.decision : "NO_GO";
}

function createReleaseWithDecision(release: Release): ReleaseWithDecision {
  return {
    ...release,
    decision: getReleaseDecision(release.id),
  };
}

function mapGetReleaseResult(result: ReleaseLookupResult<Release>): GetReleaseToolResult {
  return result.ok
    ? {
        release: createReleaseWithDecision(result.data),
      }
    : {
        error: result.error,
      };
}

function mapAnalysisResult(releaseId: string): AnalysisToolResult {
  const analysis = analyzeRelease(releaseId);

  return analysis.ok
    ? {
        analysis: analysis.data,
      }
    : {
        error: analysis.error,
      };
}

function createWebMcpTools(): WebMCP.ModelContextTool[] {
  const [
    listReleasesTool,
    getReleaseTool,
    getCiStatusTool,
    getTestResultsTool,
    getSecurityFindingsTool,
    getChangeRiskTool,
    analyzeReleaseTool,
  ] = webMcpToolCatalog;

  return [
    {
      ...listReleasesTool,
      execute: (): ListReleasesResult => ({
        releases: RELEASES.map(createReleaseWithDecision),
      }),
    },
    {
      ...getReleaseTool,
      execute: (input: unknown): GetReleaseToolResult => {
        const { releaseId } = normalizeReleaseIdInput(input);

        return mapGetReleaseResult(getReleaseById(releaseId));
      },
    },
    {
      ...getCiStatusTool,
      execute: (input: unknown): ToolLookupResult<CiEvidence> => {
        const { releaseId } = normalizeReleaseIdInput(input);

        return mapReleaseLookupResult(releaseId, getCiEvidenceByReleaseId(releaseId));
      },
    },
    {
      ...getTestResultsTool,
      execute: (input: unknown): ToolLookupResult<TestEvidence> => {
        const { releaseId } = normalizeReleaseIdInput(input);

        return mapReleaseLookupResult(
          releaseId,
          getTestEvidenceByReleaseId(releaseId),
        );
      },
    },
    {
      ...getSecurityFindingsTool,
      execute: (input: unknown): ToolLookupResult<SecurityEvidence> => {
        const { releaseId } = normalizeReleaseIdInput(input);

        return mapReleaseLookupResult(
          releaseId,
          getSecurityEvidenceByReleaseId(releaseId),
        );
      },
    },
    {
      ...getChangeRiskTool,
      execute: (input: unknown): ToolLookupResult<ChangeRiskEvidence> => {
        const { releaseId } = normalizeReleaseIdInput(input);

        return mapReleaseLookupResult(
          releaseId,
          getChangeRiskEvidenceByReleaseId(releaseId),
        );
      },
    },
    {
      ...analyzeReleaseTool,
      execute: (input: unknown): AnalysisToolResult => {
        const { releaseId } = normalizeReleaseIdInput(input);

        return mapAnalysisResult(releaseId);
      },
    },
  ];
}

export async function registerWebMcpTools(): Promise<WebMcpRegistrationResult> {
  if (typeof document === "undefined" || !document.modelContext) {
    return {
      status: "unsupported",
      cleanup: () => {},
    };
  }

  const modelContext = document.modelContext;
  const store = getRegistrationStore();
  store.refCount += 1;

  if (!store.controller || store.controller.signal.aborted) {
    const nextController = new AbortController();

    store.controller = nextController;
    store.promise = Promise.all(
      createWebMcpTools().map((tool) =>
        modelContext.registerTool(tool, {
          signal: nextController.signal,
        }),
      ),
    ).then(() => undefined);
  }

  const controller = store.controller;
  const registrationPromise = store.promise;

  if (!controller || !registrationPromise) {
    store.refCount = Math.max(0, store.refCount - 1);

    return {
      status: "error",
      cleanup: () => {},
    };
  }

  let isReleased = false;

  const cleanup = () => {
    if (isReleased) {
      return;
    }

    isReleased = true;
    store.refCount = Math.max(0, store.refCount - 1);

    if (store.refCount === 0 && store.controller === controller) {
      controller.abort();
      store.controller = null;
      store.promise = null;
    }
  };

  try {
    await registrationPromise;
    return {
      status: "ready",
      cleanup,
    };
  } catch (error) {
    cleanup();
    console.error("WebMCP tool registration failed", error);

    return {
      status: "error",
      cleanup: () => {},
    };
  }
}
