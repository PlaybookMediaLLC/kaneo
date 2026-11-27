import {
  getDocsMarkdown,
  getDocsPageByRawSlug,
  getDocsRawParams,
} from "@/lib/docs/source";

export const dynamic = "force-static";

export function generateStaticParams(): Array<{ slug: string[] }> {
  return getDocsRawParams();
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string[] }> },
) {
  const { slug } = await context.params;
  const page = getDocsPageByRawSlug(slug);
  if (!page) {
    return new Response("Not found", { status: 404 });
  }
  const markdown = getDocsMarkdown(page.slug);
  if (!markdown) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(markdown, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
