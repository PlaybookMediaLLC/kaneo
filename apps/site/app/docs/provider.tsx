"use client";

import { NextProvider } from "fumadocs-core/framework/next";
import { RootProvider } from "fumadocs-ui/provider/base";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { DocsSearchQuerySync } from "@/components/docs/docs-search-query-sync";

const DocsSearchDialog = dynamic(
  () => import("@/components/docs/docs-search-dialog"),
  { ssr: false },
);

export function DocsProvider({ children }: { children: ReactNode }) {
  return (
    <NextProvider>
      <RootProvider
        theme={{ enabled: false }}
        search={{
          SearchDialog: DocsSearchDialog,
        }}
      >
        <DocsSearchQuerySync />
        {children}
      </RootProvider>
    </NextProvider>
  );
}
