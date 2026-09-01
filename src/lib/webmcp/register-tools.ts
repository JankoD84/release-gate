import type { DecisionAnalysis } from "../decision/types.ts";
import type { ActivityLogResult } from "../decisions/activity-types.ts";
import type {
  FinalDecisionState,
} from "../decisions/final-decision-types.ts";
import { getActiveReleaseMode } from "../mode.ts";
import { getActiveRepositoryReference, type RepositoryReference } from "../releases/repository.ts";
import { getReleaseProvider, type ProviderMutationResult, type ReleaseProviderError, type ReleaseWithDecision } from "../releases/providers.ts";
import type {
  ChangeRiskEvidence,
  CiEvidence,
  SecurityEvidence,
  TestEvidence,
} from "../releases/types.ts";
import type { WebMcpRegistrationResult, WebMcpToolContract } from "./types";

const REGISTRATION_KEY = "__webMcpReleaseGateWebMcpRegistration__";

type ListReleasesResult =
  | {
      mode: "LIVE" | "DEMO";
      releases: readonly ReleaseWithDecision[];
      repository?: string;
      branch?: string;
      commitSha?: string;
      generatedAt?: string;
      workflowRunUrl?: string;
      repositoryContext?: Pick<RepositoryReference, "provider" | "host" | "namespace" | "repository" | "fullPath" | "url">;
    }
  | { error: ReleaseProviderError };

type ReleaseIdInput = {
  releaseId: string;
};

type ApproveReleaseInput = ReleaseIdInput & {
  acknowledgement: boolean;
};

type RejectReleaseInput = ReleaseIdInput & {
  reason?: string;
};

type ActivityLogInput = {
  releaseId?: string;
};

type RepositoryOutput = {
  source: "LIVE" | "DEMO";
  provider: RepositoryReference["provider"] | "synthetic";
  fullPath: string;
  publicUrl?: string;
};

type AnalysisToolResult =
  | {
      repository: RepositoryOutput;
      analysis: DecisionAnalysis;
    }
  | {
      error: ReleaseProviderError;
    };

type ToolLookupResult<T> =
  | {
      repository: RepositoryOutput;
      releaseId: string;
      evidence: T;
    }
  | {
      error: ReleaseProviderError;
    };

type GetReleaseToolResult =
  | {
      repository: RepositoryOutput;
      release: ReleaseWithDecision;
    }
  | {
      error: ReleaseProviderError;
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

const approveReleaseInputSchema = {
  type: "object",
  properties: {
    releaseId: {
      type: "string",
    },
    acknowledgement: {
      type: "boolean",
    },
  },
  required: ["releaseId", "acknowledgement"],
  additionalProperties: false,
} as const;

const rejectReleaseInputSchema = {
  type: "object",
  properties: {
    releaseId: {
      type: "string",
    },
    reason: {
      type: "string",
    },
  },
  required: ["releaseId"],
  additionalProperties: false,
} as const;

const activityLogInputSchema = {
  type: "object",
  properties: {
    releaseId: {
      type: "string",
    },
  },
  required: [],
  additionalProperties: false,
} as const;

export const webMcpToolCatalog = [
  {
    name: "list_releases",
    description:
      "Use to discover available release candidates before selecting a releaseId; in LIVE mode open PR/MR candidates are preferred before release/tag fallback.",
    inputSchema: emptyInputSchema,
    annotations: {
      readOnlyHint: true,
    },
  },
  {
    name: "get_release",
    description:
      "Use to inspect normalized metadata for one releaseId/candidate; returns the deterministic system recommendation but not a human final decision.",
    inputSchema: releaseIdInputSchema,
    annotations: {
      readOnlyHint: true,
    },
  },
  {
    name: "get_ci_status",
    description:
      "Use to inspect CI evidence for one releaseId, including pass/fail status and job counts.",
    inputSchema: releaseIdInputSchema,
    annotations: {
      readOnlyHint: true,
    },
  },
  {
    name: "get_test_results",
    description:
      "Use to inspect automated test evidence for one releaseId, including failed and flaky tests.",
    inputSchema: releaseIdInputSchema,
    annotations: {
      readOnlyHint: true,
    },
  },
  {
    name: "get_security_findings",
    description:
      "Use to inspect security evidence for one releaseId, including severity counts and gate status.",
    inputSchema: releaseIdInputSchema,
    annotations: {
      readOnlyHint: true,
    },
  },
  {
    name: "get_change_risk",
    description:
      "Use to inspect change-risk evidence for one releaseId, including affected components and risk reasons.",
    inputSchema: releaseIdInputSchema,
    annotations: {
      readOnlyHint: true,
    },
  },
  {
    name: "analyze_release",
    description:
      "Read-only: calculate the current deterministic system recommendation from evidence for one releaseId; returns GO, CONDITIONAL_GO, or NO_GO and never records human approval.",
    inputSchema: releaseIdInputSchema,
    annotations: {
      readOnlyHint: true,
    },
  },
  {
    name: "approve_release",
    description:
      "Write operation: record explicit human authorization only after the user clearly approves; requires acknowledgement=true, recalculates current evidence, cannot override NO_GO, and does not merge or deploy externally.",
    inputSchema: approveReleaseInputSchema,
    annotations: {
      readOnlyHint: false,
    },
  },
  {
    name: "reject_release",
    description:
      "Write operation: record explicit human rejection only after the user clearly rejects a candidate; optional reason is stored in the audit trail.",
    inputSchema: rejectReleaseInputSchema,
    annotations: {
      readOnlyHint: false,
    },
  },
  {
    name: "get_final_decision",
    description:
      "Use to inspect the recorded human final decision for one releaseId; PENDING means no human approval or rejection is recorded.",
    inputSchema: releaseIdInputSchema,
    annotations: {
      readOnlyHint: true,
    },
  },
  {
    name: "get_activity_log",
    description:
      "Use to inspect recent human decision activity and blocked approval attempts; optionally filter by releaseId.",
    inputSchema: activityLogInputSchema,
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

function normalizeApproveReleaseInput(input: unknown): ApproveReleaseInput {
  const { releaseId } = normalizeReleaseIdInput(input);

  return {
    releaseId,
    acknowledgement:
      typeof input === "object" &&
      input !== null &&
      "acknowledgement" in input &&
      input.acknowledgement === true,
  };
}

function normalizeRejectReleaseInput(input: unknown): RejectReleaseInput {
  const { releaseId } = normalizeReleaseIdInput(input);

  return {
    releaseId,
    reason:
      typeof input === "object" &&
      input !== null &&
      "reason" in input &&
      typeof input.reason === "string"
        ? input.reason
        : undefined,
  };
}

function normalizeActivityLogInput(input: unknown): ActivityLogInput {
  return {
    releaseId:
      typeof input === "object" &&
      input !== null &&
      "releaseId" in input &&
      typeof input.releaseId === "string"
        ? input.releaseId
        : undefined,
  };
}

function getActiveProvider() {
  return getReleaseProvider(getActiveReleaseMode());
}

function getRepositoryOutput(): RepositoryOutput {
  if (getActiveReleaseMode() === "DEMO") {
    return {
      source: "DEMO",
      provider: "synthetic",
      fullPath: "Deterministic scenarios",
    };
  }

  const repository = getActiveRepositoryReference();

  return {
    source: "LIVE",
    provider: repository.provider,
    fullPath: repository.fullPath,
    publicUrl: repository.url,
  };
}

function mapProviderLookup<T>(releaseId: string, result: { ok: true; data: T } | { ok: false; error: ReleaseProviderError }): ToolLookupResult<T> {
  return result.ok ? { repository: getRepositoryOutput(), releaseId, evidence: result.data } : { error: result.error };
}

export function createWebMcpTools(): WebMCP.ModelContextTool[] {
  const [
    listReleasesTool,
    getReleaseTool,
    getCiStatusTool,
    getTestResultsTool,
    getSecurityFindingsTool,
    getChangeRiskTool,
    analyzeReleaseTool,
    approveReleaseTool,
    rejectReleaseTool,
    getFinalDecisionTool,
    getActivityLogTool,
  ] = webMcpToolCatalog;

  return [
    {
      ...listReleasesTool,
      execute: async (): Promise<ListReleasesResult> => {
        const result = await getActiveProvider().listReleases();

        if (!result.ok) {
          return { error: result.error };
        }

        return {
          mode: result.mode,
          releases: result.releases,
          repositoryContext: result.repository ?? getActiveRepositoryReference(),
          ...(result.source
            ? {
                repository: result.source.repository,
                branch: result.source.branch,
                commitSha: result.source.commitSha,
                generatedAt: result.source.generatedAt,
                workflowRunUrl: result.source.workflow?.runUrl,
              }
            : {}),
        };
      },
    },
    {
      ...getReleaseTool,
      execute: async (input: unknown): Promise<GetReleaseToolResult> => {
        const { releaseId } = normalizeReleaseIdInput(input);
        const result = await getActiveProvider().getRelease(releaseId);

        return result.ok ? { repository: getRepositoryOutput(), release: result.data } : { error: result.error };
      },
    },
    {
      ...getCiStatusTool,
      execute: async (input: unknown): Promise<ToolLookupResult<CiEvidence>> => {
        const { releaseId } = normalizeReleaseIdInput(input);

        return mapProviderLookup(releaseId, await getActiveProvider().getCiEvidence(releaseId));
      },
    },
    {
      ...getTestResultsTool,
      execute: async (input: unknown): Promise<ToolLookupResult<TestEvidence>> => {
        const { releaseId } = normalizeReleaseIdInput(input);

        return mapProviderLookup(releaseId, await getActiveProvider().getTestEvidence(releaseId));
      },
    },
    {
      ...getSecurityFindingsTool,
      execute: async (input: unknown): Promise<ToolLookupResult<SecurityEvidence>> => {
        const { releaseId } = normalizeReleaseIdInput(input);

        return mapProviderLookup(releaseId, await getActiveProvider().getSecurityEvidence(releaseId));
      },
    },
    {
      ...getChangeRiskTool,
      execute: async (input: unknown): Promise<ToolLookupResult<ChangeRiskEvidence>> => {
        const { releaseId } = normalizeReleaseIdInput(input);

        return mapProviderLookup(releaseId, await getActiveProvider().getChangeRiskEvidence(releaseId));
      },
    },
    {
      ...analyzeReleaseTool,
      execute: async (input: unknown): Promise<AnalysisToolResult> => {
        const { releaseId } = normalizeReleaseIdInput(input);
        const result = await getActiveProvider().analyzeRelease(releaseId);

        return result.ok ? { repository: getRepositoryOutput(), analysis: result.data } : { error: result.error };
      },
    },
    {
      ...approveReleaseTool,
      execute: async (input: unknown): Promise<ProviderMutationResult> => {
        const { acknowledgement, releaseId } = normalizeApproveReleaseInput(input);

        return getActiveProvider().approveRelease(releaseId, acknowledgement);
      },
    },
    {
      ...rejectReleaseTool,
      execute: async (input: unknown): Promise<ProviderMutationResult> => {
        const { reason, releaseId } = normalizeRejectReleaseInput(input);

        return getActiveProvider().rejectRelease(releaseId, reason);
      },
    },
    {
      ...getFinalDecisionTool,
      execute: async (input: unknown): Promise<FinalDecisionState | { error: ReleaseProviderError }> => {
        const { releaseId } = normalizeReleaseIdInput(input);

        return getActiveProvider().getFinalDecision(releaseId);
      },
    },
    {
      ...getActivityLogTool,
      execute: async (input: unknown): Promise<ActivityLogResult> => {
        const { releaseId } = normalizeActivityLogInput(input);

        return getActiveProvider().getActivityLog(releaseId);
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
