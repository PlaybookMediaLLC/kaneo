import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { fill, press } from "../../test/actions";
import { renderComponent } from "../../test/render";
import { PostComposer } from "./post-composer";

const boards = [{ id: "board_test_1", name: "Ideas" }];

describe("PostComposer", () => {
  it("expands, reports the title and submits the post", async () => {
    const onTitleChange = vi.fn();
    const onSubmit = vi.fn(async () => undefined);
    const view = renderComponent(
      <PostComposer
        workspaceName="Acme"
        boards={boards}
        onTitleChange={onTitleChange}
        onSubmit={onSubmit}
      />,
    );
    const title = view.getByPlaceholderText("What would make Acme better?");
    fireEvent.focus(title);
    fill("Title", "CSV export");
    fill("Details", "Monthly");
    await waitFor(() =>
      expect(onTitleChange).toHaveBeenCalledWith("CSV export"),
    );
    press("Submit feedback");
    expect(
      await view.findByText("Thanks! Your feedback was posted."),
    ).toBeInTheDocument();
    expect(onSubmit).toHaveBeenCalledWith({
      boardId: "board_test_1",
      title: "CSV export",
      content: "Monthly",
    });
    expect(view.getByLabelText("Title")).toHaveValue("");
  });

  it("requires a title", async () => {
    const onSubmit = vi.fn(async () => undefined);
    const view = renderComponent(
      <PostComposer
        workspaceName="Acme"
        boards={boards}
        autoFocus
        onTitleChange={vi.fn()}
        onSubmit={onSubmit}
      />,
    );
    press("Submit feedback");
    expect(await view.findByRole("alert")).toHaveTextContent("Add a title.");
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("asks a visitor to sign in and still reports the title", async () => {
    const onTitleChange = vi.fn();
    const view = renderComponent(
      <PostComposer
        workspaceName="Acme"
        boards={boards}
        signInHref="/auth/sign-in"
        onTitleChange={onTitleChange}
        onSubmit={vi.fn()}
      />,
    );
    fireEvent.focus(view.getByLabelText("Title"));
    fill("Title", "Dark mode");
    await waitFor(() =>
      expect(view.getByRole("link", { name: "Sign in" })).toHaveAttribute(
        "href",
        "/auth/sign-in",
      ),
    );
    await waitFor(() =>
      expect(onTitleChange).toHaveBeenCalledWith("Dark mode"),
    );
    expect(
      view.queryByRole("button", { name: "Submit feedback" }),
    ).not.toBeInTheDocument();
  });
});
