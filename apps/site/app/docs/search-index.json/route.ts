import { getDocsSearchEntries } from "@/lib/docs/source";

export const dynamic = "force-static";

export function GET() {
  const entries = getDocsSearchEntries();
  return Response.json(entries, {
    headers: {
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
