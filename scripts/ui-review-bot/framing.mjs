import { find, selector } from "@kaneo/browser-test";

export async function targetLocator(page, target) {
  return find(page, target, { first: true });
}

export function frameBounds(boxes, viewport) {
  if (
    !boxes.length ||
    boxes.some(
      (box) =>
        !box ||
        ![box.x, box.y, box.width, box.height].every(Number.isFinite) ||
        box.width <= 0 ||
        box.height <= 0,
    )
  )
    throw new Error("The preview target has no visible bounds.");
  const left = Math.min(...boxes.map((box) => box.x));
  const top = Math.min(...boxes.map((box) => box.y));
  const right = Math.max(...boxes.map((box) => box.x + box.width));
  const bottom = Math.max(...boxes.map((box) => box.y + box.height));
  if (
    left < -1 ||
    top < -1 ||
    right > viewport.width + 1 ||
    bottom > viewport.height + 1
  )
    throw new Error(
      "The intended controls do not fit in the visible viewport.",
    );
  const width = Math.min(
    viewport.width,
    Math.max(640, Math.ceil(right - left + 48)),
  );
  const height = Math.min(
    viewport.height,
    Math.max(180, Math.ceil(bottom - top + 48)),
  );
  return {
    x: Math.max(
      0,
      Math.min(viewport.width - width, Math.floor((left + right - width) / 2)),
    ),
    y: Math.max(
      0,
      Math.min(
        viewport.height - height,
        Math.floor((top + bottom - height) / 2),
      ),
    ),
    width,
    height,
  };
}

export async function captureFrame(page, focus, visible = []) {
  const anchorSelector = await selector(page, focus, { first: true });
  if (!anchorSelector) throw new Error("The preview target is missing");
  const region = await page.evaluate((css) => {
    const element = document.querySelector(css);
    element.scrollIntoView({ block: "nearest", inline: "nearest" });
    const rect = (node) => {
      const r = node.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height };
    };
    for (
      let node = element;
      node && node !== document.body;
      node = node.parentElement
    ) {
      const r = rect(node);
      const style = getComputedStyle(node);
      const bordered =
        Number.parseFloat(style.borderTopWidth) > 0 &&
        Number.parseFloat(style.borderBottomWidth) > 0;
      const expanded =
        node.getAttribute("data-state") === "open" &&
        node.querySelector("button");
      const section =
        node.querySelector("h1,h2,h3,[role=heading]") &&
        node.querySelector("input,button,select,textarea");
      if (
        r.width >= 320 &&
        r.width <= 1100 &&
        r.height >= 64 &&
        r.height <= 650 &&
        (bordered ||
          section ||
          expanded ||
          node.getAttribute("role") === "dialog")
      )
        return r;
    }
    return rect(element);
  }, anchorSelector);
  const boxes = [region];
  for (const target of visible) {
    const css = await selector(page, target, { first: true });
    if (!css) throw new Error("A required preview control is missing");
    boxes.push(
      await page.evaluate((selector) => {
        const r = document.querySelector(selector).getBoundingClientRect();
        return { x: r.x, y: r.y, width: r.width, height: r.height };
      }, css),
    );
  }
  boxes.push(
    ...(await page.evaluate(() =>
      [...document.querySelectorAll('[role="listbox"],[role="menu"]')]
        .filter((node) => node.getClientRects().length)
        .map((node) => {
          const r = node.getBoundingClientRect();
          return { x: r.x, y: r.y, width: r.width, height: r.height };
        }),
    )),
  );
  const viewport = await page.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
  }));
  const clip = frameBounds(boxes, viewport);
  const scroll = await page.evaluate(() => ({
    x: window.scrollX,
    y: window.scrollY,
  }));
  return { ...clip, x: clip.x + scroll.x, y: clip.y + scroll.y };
}
