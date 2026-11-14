// The host-page screenshot for the widget's "Capture screenshot" action (RFC 0003 feature 6).
// The SDK renders the visible part of the page with html-to-image. It never renders the widget's
// own elements, and it never renders a private field: such a field is left out of the copy and
// covered with an opaque box where it shows on the page.

/** Fields whose content never leaves the page. A host can mark any element with data-private. */
export const PRIVATE_FIELDS = [
  'input[type="password" i]',
  "[data-private]",
  '[autocomplete*="cc-" i]',
  'input[name*="card" i]',
  'input[name*="cvc" i]',
  'input[name*="cvv" i]',
  'input[id*="card" i]',
  // Frames (for example a payment form) cannot be read; their area is covered.
  "iframe",
].join(",");

/** The longest side of the image, as in the widget's image editor. */
const MAX_SIDE = 2048;
const MASK = "#171717";
const TRANSPARENT_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

function pageBackground() {
  for (const element of [document.documentElement, document.body]) {
    const color = element ? getComputedStyle(element).backgroundColor : "";
    if (color && color !== "transparent" && color !== "rgba(0, 0, 0, 0)")
      return color;
  }
  return "#ffffff";
}

/**
 * A PNG of the visible page. `own` names the elements that belong to the widget (its launcher,
 * panel and backdrop): they are never rendered.
 */
export async function capturePage(
  own: (element: Element) => boolean,
): Promise<Blob> {
  const { toCanvas } = await import("html-to-image");
  const width = window.innerWidth;
  const height = window.innerHeight;
  const ratio = Math.min(
    window.devicePixelRatio || 1,
    MAX_SIDE / Math.max(width, height, 1),
  );
  // Read the private areas before rendering: these are the page coordinates the visitor sees.
  const masks = Array.from(document.querySelectorAll(PRIVATE_FIELDS))
    .filter((element) => !own(element))
    .map((element) => element.getBoundingClientRect())
    .filter(
      (box) =>
        box.width > 0 &&
        box.height > 0 &&
        box.right > 0 &&
        box.bottom > 0 &&
        box.left < width &&
        box.top < height,
    );
  // ponytail: the copy keeps fixed and normal elements in place, but a sticky element or an
  // inner scroll area shows at its unscrolled position. Use a browser capture API if that matters.
  const canvas = await toCanvas(document.documentElement, {
    width,
    height,
    pixelRatio: ratio,
    backgroundColor: pageBackground(),
    // Moves the copy of the page to the current scroll position.
    style: {
      position: "relative",
      top: `${-window.scrollY}px`,
      left: `${-window.scrollX}px`,
    },
    filter: (node: Node) =>
      !(node instanceof Element) ||
      !(own(node) || node.matches(PRIVATE_FIELDS)),
    imagePlaceholder: TRANSPARENT_PIXEL,
  });
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Could not draw the screenshot.");
  context.fillStyle = MASK;
  for (const box of masks)
    context.fillRect(
      box.left * ratio,
      box.top * ratio,
      box.width * ratio,
      box.height * ratio,
    );
  return new Promise((resolve, reject) =>
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("Could not save the screenshot.")),
      "image/png",
    ),
  );
}
