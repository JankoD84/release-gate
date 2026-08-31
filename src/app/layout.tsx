import type { Metadata } from "next";
import { WebMcpProvider } from "@/components/webmcp/webmcp-provider";
import "./globals.css";

export const metadata: Metadata = {
  title: "Release Gate",
  description: "Agent-native software release decisions with human control.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">
        <WebMcpProvider>{children}</WebMcpProvider>
      </body>
    </html>
  );
}
