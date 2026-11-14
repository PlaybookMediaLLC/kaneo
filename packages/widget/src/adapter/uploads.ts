import { ApiError, type Api } from "./api.js";

/**
 * Uploads one image through the widget upload routes and registers it: the presigned PUT goes
 * straight to storage, then the API verifies the object. Returns the file ID that a feedback post
 * attaches. Needs a visitor that the host app identified.
 */
export async function uploadImage(
  api: Api,
  file: File,
  signal?: AbortSignal,
): Promise<string> {
  const object = { contentType: file.type, size: file.size };
  const target = await api.request<{
    key: string;
    uploadUrl: string;
    headers: Record<string, string>;
  }>(
    "POST",
    "/widget/uploads",
    { purpose: "customer_image", filename: file.name, ...object },
    signal,
  );
  let stored: Response;
  try {
    stored = await fetch(target.uploadUrl, {
      method: "PUT",
      headers: target.headers,
      body: file,
      // Storage gets no cookie and no session token.
      credentials: "omit",
      signal,
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new ApiError(0, "Could not upload the image. Check your connection.");
  }
  if (!stored.ok)
    throw new ApiError(stored.status, "Could not upload the image.");
  const registered = await api.request<{ id: string }>(
    "POST",
    "/widget/files",
    { key: target.key, name: file.name, ...object },
    signal,
  );
  return registered.id;
}
