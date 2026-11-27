import { getDocsImagePaths, readDocsImage } from "@/lib/docs/source";

export const dynamic = "force-static";

export function generateStaticParams(): Array<{ path: string[] }> {
  return getDocsImagePaths().map((segments) => ({ path: segments }));
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path: segments } = await context.params;
  const image = readDocsImage(segments);
  if (!image) {
    return new Response("Not found", { status: 404 });
  }

  return new Response(new Uint8Array(image.bytes), {
    headers: {
      "Content-Type": image.contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
