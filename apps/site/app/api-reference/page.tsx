import type { Metadata } from "next";
import { ApiReferenceClient } from "@/components/docs/api-reference-client";
import { breadcrumbJsonLd, JsonLd } from "@/components/landing/json-ld";
import { API_REFERENCE_PATH, DOCS_BASE_PATH } from "@/lib/docs/links";
import { withSocialMetadata } from "@/lib/metadata";

export const metadata: Metadata = withSocialMetadata({
  title: "API Reference",
  description:
    "Interactive REST API reference for Kaneo workspaces, projects, tasks, integrations, webhooks, and customer portals.",
  alternates: {
    canonical: API_REFERENCE_PATH,
  },
});

export default function ApiReferencePage() {
  return (
    <>
      <JsonLd
        data={breadcrumbJsonLd([
          { name: "Home", path: "/" },
          { name: "Docs", path: DOCS_BASE_PATH },
          { name: "API Reference", path: API_REFERENCE_PATH },
        ])}
      />
      <h1 className="sr-only">Kaneo API Reference</h1>
      <ApiReferenceClient />
    </>
  );
}
