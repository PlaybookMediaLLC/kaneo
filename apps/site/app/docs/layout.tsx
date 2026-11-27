import { brand } from "@kaneo/branding";
import { DocsLayout as FumaDocsLayout } from "fumadocs-ui/layouts/docs";
import type { ReactNode } from "react";
import "@/app/documentation.css";
import { DocsProvider } from "@/app/docs/provider";
import { DocsShellNav } from "@/components/docs/docs-shell-nav";
import { DocsSidebar } from "@/components/docs/docs-sidebar";
import { JsonLd } from "@/components/landing/json-ld";
import { docsSource, getDocsSidebarSections } from "@/lib/docs/source";

export default function DocsLayout({ children }: { children: ReactNode }) {
  const sections = getDocsSidebarSections();
  const docsSearchJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebSite",
    name: `${brand.name} Docs`,
    url: `${brand.publicUrl}/docs`,
    potentialAction: {
      "@type": "SearchAction",
      target: `${brand.publicUrl}/docs?q={search_term_string}`,
      "query-input": "required name=search_term_string",
    },
  };

  return (
    <DocsProvider>
      <div className="docs-shell min-h-dvh bg-background text-foreground">
        <JsonLd data={docsSearchJsonLd} />
        <DocsShellNav sections={sections} />
        <DocsSidebar sections={sections} />
        <div className="lg:pl-[16.75rem]">
          <FumaDocsLayout
            tree={docsSource.pageTree}
            nav={{ enabled: false }}
            sidebar={{ enabled: false }}
            searchToggle={{ enabled: false }}
            themeSwitch={{ enabled: false }}
          >
            {children}
          </FumaDocsLayout>
        </div>
      </div>
    </DocsProvider>
  );
}
