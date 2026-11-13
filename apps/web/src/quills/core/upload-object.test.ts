import { expect, it, vi } from "vite-plus/test";
import { uploadObject } from "./upload-object";
it("uploads without session credentials and rejects a failed PUT", async () => {
  const fetch = vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValue(new Response(null, { status: 403 }));
  const file = new File(["x"], "example.txt");
  await expect(
    uploadObject(file, {
      uploadUrl: "https://storage.example.test/upload",
      headers: { "Content-Type": "text/plain" },
    }),
  ).rejects.toEqual({ kind: "failed" });
  expect(fetch).toHaveBeenCalledWith(
    "https://storage.example.test/upload",
    expect.objectContaining({ credentials: "omit", method: "PUT", body: file }),
  );
  fetch.mockRestore();
});
