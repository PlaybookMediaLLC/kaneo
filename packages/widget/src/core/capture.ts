// The host-page screenshot for the widget's "Capture screenshot" action (RFC 0003 feature 6).
// In the browser IIFE (sdk.js), html-to-image is never bundled up front (#316): it loads lazily
// from `{widgetBase}/capture.js` only when the visitor clicks "Capture screenshot".

declare const process: { env: { QUILLS_BROWSER_IIFE?: string } };

type ToCanvasFn = typeof import("html-to-image").toCanvas;
type CaptureGlobal = {
  toCanvas?: ToCanvasFn;
  capturePage?: (own: (element: Element) => boolean) => Promise<Blob>;
};

declare global {
  interface Window {
    __QUILLS_CAPTURE__?: CaptureGlobal;
  }
}

/** Fields whose content never leaves the page. A host can mark any element with data-private. */
export const PRIVATE_FIELDS =
  'input[type="password" i],input[type="email" i],input[type="tel" i],[autocomplete*="email" i],[autocomplete*="tel" i],[data-private],[autocomplete*="cc-" i],input[name*="card" i],input[name*="cvc" i],input[name*="cvv" i],input[id*="card" i],iframe';

/** The longest side of the image, as in the widget's image editor. */
const MAX_SIDE = 2048;
const MASK = "#171717";
const TRANSPARENT_PIXEL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";

let pendingLoad: Promise<CaptureGlobal> | null = null;

function loadCaptureScript(url: string): Promise<CaptureGlobal> {
  if (window.__QUILLS_CAPTURE__?.capturePage) {
    return Promise.resolve(window.__QUILLS_CAPTURE__);
  }
  if (pendingLoad) return pendingLoad;
  pendingLoad = new Promise<CaptureGlobal>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = url;
    script.async = true;
    script.onload = () => {
      const cap = window.__QUILLS_CAPTURE__;
      if (cap?.capturePage) resolve(cap);
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
  if (process.env.QUILLS_BROWSER_IIFE === "true") {
    if (!captureScriptUrl) {
      throw new Error("Screenshot capture URL is not configured.");
    }
    const helper = await loadCaptureScript(captureScriptUrl);
    return helper.capturePage!(own);
  }
  const toCanvas =
    window.__QUILLS_CAPTURE__?.toCanvas ??
    (await import("html-to-image")).toCanvas;
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
