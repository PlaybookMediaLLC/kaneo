import { brand } from "@kaneo/branding";
import { API_REFERENCE_PATH } from "@/lib/docs/links";
import { docsSource } from "@/lib/docs/source";

export const dynamic = "force-static";

export function GET() {
  const origin = brand.publicUrl.replace(/\/+$/, "");
  const urls = Array.from(
    new Set([
      ...docsSource.getPages().map((page) => `${origin}${page.url}`),
      `${origin}${API_REFERENCE_PATH}`,
    ]),
  );

  const items = urls
    .map(
      (loc) => `  <url>
    <loc>${loc}</loc>
  </url>`,
    )
    .join("\n");

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${items}
</urlset>`;

  return new Response(xml, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
