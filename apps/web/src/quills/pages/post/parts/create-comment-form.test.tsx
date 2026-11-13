import { act, fireEvent, waitFor } from "@testing-library/react";
import { mockApi } from "../../../test/mock-api";
import { advanceClock, fill, press } from "../../../test/actions";
import { describe, expect, it, vi } from "vite-plus/test";
import { describeFormContract } from "../../../test/contracts";
import { renderComponent } from "../../../test/render";
import { CreateCommentForm } from "./create-comment-form";

describe("CreateCommentForm", () => {
  describeFormContract({
    render: (onSubmit) =>
      renderComponent(
        <CreateCommentForm
          workspaceId="workspace_test_1"
          viewer={{ kind: "user", id: "user_test_1" }}
          onSubmit={onSubmit}
        />,
      ),
    fieldName: /Comment|post\.comment/,
    issuePath: "content",
    submitName: /Post comment|post\.submit/,
    validValue: "This would help our team.",
    expectedValues: {
      idempotencyKey: expect.any(String),
      attachmentIds: [],
      content: "This would help our team.",
    },
    invalidValue: "",
  });
  it("renders a labelled comment field", () => {
    const view = renderComponent(
      <CreateCommentForm
        workspaceId="workspace_test_1"
        viewer={{ kind: "user", id: "user_test_1" }}
        onSubmit={vi.fn()}
      />,
    );
    expect(view.getByLabelText("Comment")).toBeInTheDocument();
    expect(
      view.getByRole("button", { name: "Post comment" }),
    ).toBeInTheDocument();
  });
  it("clears a successful comment and gives the next submission a fresh key", async () => {
    const submit = vi.fn().mockResolvedValue(undefined);
    const view = renderComponent(
      <CreateCommentForm
        workspaceId="workspace_test_1"
        viewer={{ kind: "user", id: "user_test_1" }}
        onSubmit={submit}
      />,
    );
    fill("Comment", "First comment");
    press("Post comment");
    await waitFor(() => expect(view.getByLabelText("Comment")).toHaveValue(""));
    const firstKey = submit.mock.calls[0]![0].idempotencyKey;

    fill("Comment", "Second comment");
    press("Post comment");
    await waitFor(() => expect(submit).toHaveBeenCalledTimes(2));
    expect(submit.mock.calls[1]![0]).toMatchObject({
      content: "Second comment",
      attachmentIds: [],
      idempotencyKey: expect.any(String),
    });
    expect(submit.mock.calls[1]![0].idempotencyKey).not.toBe(firstKey);
    await waitFor(() => expect(view.getByLabelText("Comment")).toHaveValue(""));
  });
});

it("preserves upload rate limits and the comment draft", async () => {
  vi.useFakeTimers();
  try {
    const api = mockApi();
    api.reply({ message: "Rate limited" }, 429, { "retry-after": "3" });
    const submit = vi.fn();
    const view = renderComponent(
      <CreateCommentForm
        workspaceId="workspace_test_1"
        viewer={{ kind: "user", id: "user_1" }}
        onSubmit={submit}
      />,
    );
    fill("Comment", "A draft");
    fireEvent.change(view.getByLabelText("Attach files"), {
      target: {
        files: [new File(["text"], "example.txt", { type: "text/plain" })],
      },
    });
    await act(async () => press("Post comment"));
    expect(view.getByRole("button", { name: /Try again in/ })).toBeDisabled();
    expect(view.getByLabelText("Comment")).toHaveValue("A draft");
    await advanceClock(3000);
    expect(view.getByRole("button", { name: "Try again" })).toBeEnabled();
    expect(submit).not.toHaveBeenCalled();
  } finally {
    vi.useRealTimers();
  }
});
