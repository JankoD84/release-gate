
export type WebMcpRegistrationStatus =
  | "unsupported"
  | "registering"
  | "ready"
  | "error";

export type WebMcpRegistrationResult = {
  status: Exclude<WebMcpRegistrationStatus, "registering">;
  cleanup: () => void;
};

export type WebMcpToolContract = Pick<
  WebMCP.ModelContextTool,
  "name" | "description" | "inputSchema" | "annotations"
>;
