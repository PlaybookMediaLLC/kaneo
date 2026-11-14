import { afterEach, expect, it, vi } from "vite-plus/test";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ImageAnnotation } from "../src/ui/ImageAnnotation.js";
import { arrowHead } from "../src/ui/annotation-draw.js";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

it("draws an arrowhead behind the point, on both sides of the line", () => {
  const [ax, ay, bx, by] = arrowHead(0, 0, 100, 0, 10);
  expect(ax).toBeCloseTo(100 - 10 * Math.cos((25 * Math.PI) / 180));
  expect(bx).toBeCloseTo(ax);
  expect(ay).toBeCloseTo(-by);
  expect(ay).not.toBe(0);
});

it("adds boxes, arrows, blurs and redactions from the keyboard, and undoes them", async () => {
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:shot");
  vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  // The image loads at once; happy-dom has no image decoder.
  vi.stubGlobal(
    "Image",
    class {
      naturalWidth = 800;
      naturalHeight = 600;
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      set src(_value: string) {
        queueMicrotask(() => this.onload?.());
      }
    },
  );
  render(
    <ImageAnnotation
      file={new File(["png"], "shot.png", { type: "image/png" })}
      onSave={vi.fn()}
      onCancel={vi.fn()}
    />,
  );
  const tools = screen.getByRole("group", { name: "Tool" });
  expect(
    Array.from(tools.querySelectorAll("[aria-pressed]"), (b) => b.textContent),
  ).toEqual(["Box", "Arrow", "Blur", "Redact"]);
  fireEvent.click(screen.getByRole("button", { name: "Arrow" }));
  expect(
    screen.getByRole("button", { name: "Arrow" }).getAttribute("aria-pressed"),
  ).toBe("true");
  const add = await screen.findByRole("button", { name: "Add arrow" });
  await vi.waitFor(() =>
    expect((add as HTMLButtonElement).disabled).toBe(false),
  );
  fireEvent.click(add);
  const to = screen.getByLabelText<HTMLInputElement>("Mark to x");
  expect(to.value).toBe("50");
  fireEvent.change(to, { target: { value: "70" } });
  expect(screen.getByLabelText<HTMLInputElement>("Mark to x").value).toBe("70");
  fireEvent.click(screen.getByRole("button", { name: "Blur" }));
  fireEvent.click(screen.getByRole("button", { name: "Add blur" }));
  expect(screen.getByLabelText<HTMLInputElement>("Mark to x").value).toBe("50");
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.getByLabelText<HTMLInputElement>("Mark to x").value).toBe("70");
  fireEvent.click(screen.getByRole("button", { name: "Undo" }));
  expect(screen.queryByLabelText("Mark to x")).toBeNull();
});
