import { afterEach, expect, it, vi } from "vite-plus/test";
import { toCanvas } from "html-to-image";
import { capturePage } from "../src/core/capture.js";

vi.mock("html-to-image", () => ({ toCanvas: vi.fn() }));

afterEach(() => {
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

const box = (left: number, top: number, width: number, height: number) =>
  ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  }) as DOMRect;

it("never renders the widget or a private field, and covers private fields with opaque boxes", async () => {
  document.body.innerHTML = `
    <p id="plain">Hello</p>
    <input id="password" type="password" value="hunter2">
    <div id="private" data-private>123-45-6789</div>
    <input id="card" autocomplete="cc-number" value="4242424242424242">
    <input id="offscreen" type="password">
    <div class="quackback-panel"><iframe id="own"></iframe></div>`;
  const rects: Record<string, DOMRect> = {
    password: box(10, 20, 100, 30),
    private: box(10, 60, 200, 20),
    card: box(10, 90, 150, 30),
    offscreen: box(10, 5000, 100, 30),
    own: box(600, 0, 384, 760),
  };
  for (const [id, rect] of Object.entries(rects))
    vi.spyOn(
      document.getElementById(id)!,
      "getBoundingClientRect",
    ).mockReturnValue(rect);
  const fillRect = vi.fn();
  const blob = new Blob(["png"], { type: "image/png" });
  vi.mocked(toCanvas).mockResolvedValue({
    getContext: () => ({ fillRect, fillStyle: "" }),
    toBlob: (done: BlobCallback) => done(blob),
  } as unknown as HTMLCanvasElement);

  const own = (element: Element) => !!element.closest(".quackback-panel");
  await expect(capturePage(own)).resolves.toBe(blob);

  const [root, options] = vi.mocked(toCanvas).mock.calls[0]!;
  expect(root).toBe(document.documentElement);
  const filter = options!.filter as (node: Node) => boolean;
  const kept = (id: string) => filter(document.getElementById(id)!);
  expect(kept("plain")).toBe(true);
  expect(filter(document.getElementById("plain")!.firstChild!)).toBe(true);
  for (const id of ["password", "private", "card", "own"])
    expect([id, kept(id)]).toEqual([id, false]);
  expect(options).toMatchObject({
    width: window.innerWidth,
    height: window.innerHeight,
    style: { position: "relative" },
  });
  // The three visible private fields are covered; the widget and off-screen fields are not.
  const ratio = options!.pixelRatio!;
  expect(fillRect.mock.calls).toEqual([
    [10 * ratio, 20 * ratio, 100 * ratio, 30 * ratio],
    [10 * ratio, 60 * ratio, 200 * ratio, 20 * ratio],
    [10 * ratio, 90 * ratio, 150 * ratio, 30 * ratio],
  ]);
});
