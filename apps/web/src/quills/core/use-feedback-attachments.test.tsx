import { act } from "@testing-library/react";
import { expect, it } from "vite-plus/test";
import { renderQuillsHook } from "../test/render";
import { mockApi } from "../test/mock-api";
import { preparePortalUploadFixture } from "../api/files/prepare-portal-upload.fixture";
import { createPortalUploadFixture } from "../api/files/create-portal-upload.fixture";
import { createPortalFilesFixture } from "../api/files/create-portal-files.fixture";
import { useFeedbackAttachments } from "./use-feedback-attachments";
it("reuses a successful PUT after registration fails and preserves the draft", async () => {
  const api = mockApi();
  api.reply(preparePortalUploadFixture.ok({ ready: true }));
  api.reply(
    createPortalUploadFixture.ok({
      uploadUrl: "https://storage.example.test/upload",
    }),
  );
  api.reply({});
  api.fail();
  const { result } = renderQuillsHook(
    () =>
      useFeedbackAttachments("workspace_test_1", {
        kind: "user",
        id: "user_1",
      }),
    {},
  );
  const file = new File(["example"], "example.txt", { type: "text/plain" });
  act(() => result.current.setFiles([file]));
  await act(async () => {
    await expect(result.current.upload()).rejects.toMatchObject({
      kind: "failed",
    });
  });
  expect(result.current.files).toEqual([file]);
  api.reply(preparePortalUploadFixture.ok({ ready: true }));
  api.reply(createPortalFilesFixture.ok({ id: "file_1" }));
  await act(async () => {
    expect(await result.current.upload()).toEqual(["file_1"]);
  });
  expect(
    api
      .calls()
      .filter(
        (request) =>
          request.method === "PUT" &&
          request.url.startsWith("https://storage.example.test"),
      ),
  ).toHaveLength(1);
  expect(api.calls("createQuillsPortalUpload")).toHaveLength(1);
  expect(api.calls("createQuillsPortalFiles")).toHaveLength(2);
});

it("clears staged files when the viewer changes", () => {
  const { result, rerender } = renderQuillsHook(
    ({ id }) =>
      useFeedbackAttachments("workspace_test_1", { kind: "user", id }),
    { initialProps: { id: "one" } },
  );
  act(() => result.current.setFiles([new File(["private"], "private.txt")]));
  rerender({ id: "two" });
  expect(result.current.files).toEqual([]);
  expect(result.current.attachments).toEqual([]);
});

it("obtains a fresh signed URL after a failed PUT", async () => {
  const api = mockApi();
  api.reply(preparePortalUploadFixture.ok({ ready: true }));
  api.reply(
    createPortalUploadFixture.ok({
      uploadUrl: "https://storage.example.test/expired",
    }),
  );
  api.fail();
  const { result } = renderQuillsHook(
    () =>
      useFeedbackAttachments("workspace_test_1", {
        kind: "user",
        id: "user_1",
      }),
    {},
  );
  act(() =>
    result.current.setFiles([
      new File(["example"], "example.txt", { type: "text/plain" }),
    ]),
  );
  await act(async () => {
    await expect(result.current.upload()).rejects.toThrow(
      "Network unavailable",
    );
  });
  api.reply(preparePortalUploadFixture.ok({ ready: true }));
  api.reply(
    createPortalUploadFixture.ok({
      uploadUrl: "https://storage.example.test/fresh",
    }),
  );
  api.reply({});
  api.reply(createPortalFilesFixture.ok({ id: "file_1" }));
  await act(async () => {
    expect(await result.current.upload()).toEqual(["file_1"]);
  });
  expect(api.calls("createQuillsPortalUpload")).toHaveLength(2);
});

it("keeps one submission key through a retry and rotates it after success", () => {
  const { result } = renderQuillsHook(
    () =>
      useFeedbackAttachments("workspace_test_1", {
        kind: "user",
        id: "user_1",
      }),
    {},
  );
  const before = result.current.idempotencyKey;
  act(() => result.current.setFiles([new File(["text"], "example.txt")]));
  expect(result.current.idempotencyKey).toBe(before);
  act(() => result.current.reset());
  expect(result.current.idempotencyKey).not.toBe(before);
});
