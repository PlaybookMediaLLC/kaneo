import { useState } from "react";
import { fireEvent } from "@testing-library/react";
import { expect, it, vi } from "vite-plus/test";
import { renderComponent } from "../test/render";
import { FeedbackEditor } from "./feedback-editor";
it("formats a selection and previews sanitized Markdown", () => {
  function Editor() {
    const [value, setValue] = useState("hello");
    return (
      <FeedbackEditor
        id="editor"
        value={value}
        onChange={setValue}
        maxLength={100}
        attachments={[]}
        files={[]}
        onFilesChange={() => {}}
        onRemove={() => {}}
        onRemoveFile={() => {}}
      />
    );
  }
  const view = renderComponent(<Editor />);
  const input = view.getByRole("textbox") as HTMLTextAreaElement;
  input.setSelectionRange(0, 5);
  fireEvent.click(view.getByRole("button", { name: "Bold" }));
  expect(input).toHaveValue("**hello**");
  fireEvent.click(view.getByRole("button", { name: "Preview" }));
  expect(view.getByText("hello").tagName).toBe("STRONG");
});
it("rejects more than ten files without losing the existing selection", () => {
  const change = vi.fn();
  const view = renderComponent(
    <FeedbackEditor
      id="editor"
      value=""
      onChange={() => {}}
      maxLength={100}
      attachments={[]}
      files={[]}
      onFilesChange={change}
      onRemove={() => {}}
      onRemoveFile={() => {}}
    />,
  );
  fireEvent.change(view.getByLabelText("Attach files"), {
    target: {
      files: Array.from(
        { length: 11 },
        (_, i) => new File(["x"], `${i}.txt`, { type: "text/plain" }),
      ),
    },
  });
  expect(change).not.toHaveBeenCalled();
  expect(view.getByRole("alert")).toHaveTextContent("up to 10");
});
