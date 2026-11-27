import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
} from "fumadocs-ui/layouts/docs/page";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { docsMdxComponents } from "@/components/docs/docs-mdx-components";
import { DocsPageActions } from "@/components/docs/docs-page-actions";
import { breadcrumbJsonLd, JsonLd } from "@/components/landing/json-ld";
import { DOCS_BASE_PATH } from "@/lib/docs/links";
import { compileDocsMdx } from "@/lib/docs/mdx";
import {
  docsSource,
  getDocsRedirect,
  getDocsRedirects,
} from "@/lib/docs/source";
import { withSocialMetadata } from "@/lib/metadata";

export const dynamicParams = false;

type Params = { slug?: string[] };

export function generateStaticParams(): Params[] {
  return [
    ...docsSource.generateParams(),
    ...getDocsRedirects().map((redirect) => ({ slug: redirect.slugs })),
  ];
}

export async function generateMetadata({
  params,
}: {
  params: Promise<Params>;
}): Promise<Metadata> {
  const { slug } = await params;

  const redirect = getDocsRedirect(slug);
  if (redirect) {
    return {
      title: "Redirecting",
      description: `This documentation page moved to ${redirect.destinationUrl}.`,
      alternates: { canonical: redirect.destinationUrl },
      robots: { index: false, follow: true },
    };
  }

  const page = docsSource.getPage(slug);
  if (!page) {
    return {
      title: "Page not found",
      robots: { index: false, follow: false },
    };
  }

  return withSocialMetadata({
    title: page.title,
    description: page.description,
    alternates: { canonical: page.url },
    keywords: page.keywords.length > 0 ? page.keywords : undefined,
  });
}

export default async function DocsContentPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { slug } = await params;

  const redirect = getDocsRedirect(slug);
  if (redirect) {
    return (
      <DocsPage
        toc={[]}
        footer={{ enabled: false }}
        breadcrumb={{ enabled: false }}
      >
        <meta
          httpEquiv="refresh"
          content={`0;url=${redirect.destinationUrl}`}
        />
        <DocsTitle>This page has moved</DocsTitle>
        <DocsDescription>
          Continue to{" "}
          <Link
            href={redirect.destinationUrl}
            className="text-foreground underline underline-offset-4"
          >
            {redirect.destinationUrl}
          </Link>
          .
        </DocsDescription>
      </DocsPage>
    );
  }

  const page = docsSource.getPage(slug);
  if (!page) {
    notFound();
  }

  const compiled = await compileDocsMdx(page);
  const MdxContent = compiled.body;

  const breadcrumbs = [
    { name: "Home", path: "/" },
    { name: "Docs", path: DOCS_BASE_PATH },
    ...(page.url !== DOCS_BASE_PATH
      ? [{ name: page.title, path: page.url }]
      : []),
  ];

  return (
    <DocsPage
      toc={compiled.toc}
      tableOfContent={{ style: "clerk" }}
      breadcrumb={{ enabled: false }}
    >
      <JsonLd data={breadcrumbJsonLd(breadcrumbs)} />

      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-medium text-muted-foreground">
        <span>{page.section}</span>
        <span aria-hidden="true">/</span>
        <span>{page.group}</span>
      </div>

      <DocsTitle className="font-heading text-3xl font-semibold tracking-tight text-foreground sm:text-4xl">
        {page.title}
      </DocsTitle>

      {page.description ? (
        <DocsDescription className="mb-4 text-base text-muted-foreground leading-relaxed">
          {page.description}
        </DocsDescription>
      ) : null}

      <div className="mb-6 border-b border-border pb-5">
        <DocsPageActions rawUrl={page.rawUrl} />
      </div>

      <DocsBody>
        <MdxContent components={docsMdxComponents} />
      </DocsBody>
    </DocsPage>
  );
}
