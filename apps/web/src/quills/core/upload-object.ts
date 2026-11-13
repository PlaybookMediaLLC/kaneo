export async function uploadObject(
  file: File,
  upload: { uploadUrl: string; headers: Record<string, string> },
) {
  const response = await fetch(upload.uploadUrl, {
    method: "PUT",
    headers: upload.headers,
    body: file,
    credentials: "omit",
  });
  if (!response.ok) throw { kind: "failed" };
}
