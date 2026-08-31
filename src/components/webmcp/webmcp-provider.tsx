"use client";

import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import { registerWebMcpTools } from "@/lib/webmcp/register-tools";
import type { WebMcpRegistrationStatus } from "@/lib/webmcp/types";

type WebMcpContextValue = {
  status: WebMcpRegistrationStatus;
};

const WebMcpContext = createContext<WebMcpContextValue>({
  status: "unsupported",
});

export function WebMcpProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<WebMcpRegistrationStatus>("registering");

  useEffect(() => {
    let isMounted = true;
    let cleanup: (() => void) | undefined;

    registerWebMcpTools()
      .then((result) => {
        cleanup = result.cleanup;

        if (isMounted) {
          setStatus(result.status);
        } else {
          cleanup();
        }
      })
      .catch((error: unknown) => {
        console.error("Unexpected WebMCP provider failure", error);

        if (isMounted) {
          setStatus("error");
        }
      });

    return () => {
      isMounted = false;
      cleanup?.();
    };
  }, []);

  const contextValue = useMemo<WebMcpContextValue>(
    () => ({ status }),
    [status],
  );

  return (
    <WebMcpContext.Provider value={contextValue}>
      {children}
    </WebMcpContext.Provider>
  );
}

export function useWebMcpStatus() {
  return useContext(WebMcpContext).status;
}
