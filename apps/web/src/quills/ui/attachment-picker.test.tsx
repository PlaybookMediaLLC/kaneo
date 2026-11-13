import { fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vite-plus/test";
import { press } from "../test/actions";
import { renderComponent } from "../test/render";
import { AttachmentPicker } from "./attachment-picker";

describe("AttachmentPicker", () => {
  const file = new File(["x"], "notes.txt", { type: "text/plain" });
  const render = (props: Partial<Parameters<typeof AttachmentPicker>[0]>) =>
    renderComponent(
      <AttachmentPicker
        attachments={[]}
        files={[]}
        onFilesChange={vi.fn()}
        onRemove={vi.fn()}
        onRemoveFile={vi.fn()}
        {...props}
      />,
    );

  it("adds chosen files once", () => {
    const onFilesChange = vi.fn();
    const view = render({ files: [file], onFilesChange });
    const other = new File(["y"], "shot.png", { type: "image/png" });
    fireEvent.change(view.getByLabelText("Attach files"), {
      target: { files: [file, other] },
    });
    expect(onFilesChange).toHaveBeenCalledWith([file, other]);
  });

  it("removes saved and chosen files", () => {
    const onRemove = vi.fn();
    const onRemoveFile = vi.fn();
    render({
      attachments: [{ id: "file_test_1", name: "saved.pdf" }],
      files: [file],
      onRemove,
      onRemoveFile,
    });
    press("Remove saved.pdf");
    press("Remove notes.txt");
    expect(onRemove).toHaveBeenCalledWith("file_test_1");
    expect(onRemoveFile).toHaveBeenCalledWith(file);
  });
});
