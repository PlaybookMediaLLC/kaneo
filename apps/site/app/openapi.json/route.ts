import { getBrandedOpenApiSpec } from "@/lib/docs/source";

export const dynamic = "force-static";

export function GET() {
  const spec = getBrandedOpenApiSpec();
  return new Response(`${JSON.stringify(spec, null, 2)}\n`, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
