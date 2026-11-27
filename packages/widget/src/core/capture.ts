// The host-page screenshot for the widget's "Capture screenshot" action (RFC 0003 feature 6).
// In the browser IIFE (sdk.js), html-to-image is never bundled up front (#316): it loads lazily
// from `{widgetBase}/capture.js` only when the visitor clicks "Capture screenshot".

declare const process: { env: { QUILLS_BROWSER_IIFE?: string } };

type ToCanvasFn = typeof import("html-to-image").toCanvas;

declare global {
  interface Window {
    __QUILLS_CAPTURE__?: { toCanvas: ToCanvasFn };
  }
}

/** Fields whose content never leaves the page. A host can mark any element with data-private. */
export const PRIVATE_FIELDS = [
  'input[type="password" i]',
  'input[type="email" i]',
  'input[type="tel" i]',
  '[autocomplete*="email" i]',
  '[autocomplete*="tel" i]',
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

let pendingLoad: Promise<ToCanvasFn> | null = null;

function loadCaptureScript(url: string): Promise<ToCanvasFn> {
  if (window.__QUILLS_CAPTURE__?.toCanvas) {
    return Promise.resolve(window.__QUILLS_CAPTURE__.toCanvas);
  }
  if (pendingLoad) return pendingLoad;
  pendingLoad = new Promise<ToCanvasFn>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () => {
      const fn = window.__QUILLS_CAPTURE__?.toCanvas;
      if (fn) resolve(fn);
      else {
        pendingLoad = null;
        reject(new Error("Screenshot capture helper did not initialize."));
      }
    };
    script.onerror = () => {
      pendingLoad = null;
      script.remove();
      reject(new Error("Could not load screenshot capture helper."));
    };
    (document.head ?? document.documentElement).appendChild(script);
  });
  return pendingLoad;
}

async function resolveToCanvas(captureScriptUrl?: string): Promise<ToCanvasFn> {
  if (window.__QUILLS_CAPTURE__?.toCanvas) {
    return window.__QUILLS_CAPTURE__.toCanvas;
  }
  if (process.env.QUILLS_BROWSER_IIFE === "true") {
    if (!captureScriptUrl) {
      throw new Error("Screenshot capture URL is not configured.");
    }
    return loadCaptureScript(captureScriptUrl);
  }
  const mod = await import("html-to-image");
  return mod.toCanvas;
}

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
  captureScriptUrl?: string,
): Promise<Blob> {
  const toCanvas = await resolveToCanvas(captureScriptUrl);
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
    // Moves the copy of the page to the current scroll position. Margins keep fixed elements in
    // place; "relative" moves absolute elements with the page (checked in Chromium).
    style: {
      position: "relative",
      marginTop: `${-window.scrollY}px`,
      marginLeft: `${-window.scrollX}px`,
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
