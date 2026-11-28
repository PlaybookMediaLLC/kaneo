// Browser-injected visual annotation overlay: visible cursor, click pulse, bounding-box highlight, and restrained zoom.

export const OVERLAY_INIT_SCRIPT = () => {
  if (window.__prVeInstalled) return;
  window.__prVeInstalled = true;

  const ensureRoot = () => {
    let style = document.getElementById("pr-ve-style");
    if (!style) {
      style = document.createElement("style");
      style.id = "pr-ve-style";
      style.textContent = `
        #pr-ve-layer {
          position: fixed;
          inset: 0;
          pointer-events: none;
          z-index: 2147483646;
          overflow: hidden;
        }
        #pr-ve-highlight {
          position: fixed;
          border: 3px solid #2563eb;
          background: rgba(37, 99, 235, 0.10);
          border-radius: 8px;
          box-shadow: 0 0 0 2px rgba(255, 255, 255, 0.85), 0 8px 24px rgba(15, 23, 42, 0.22);
          transition: all 240ms cubic-bezier(0.22, 1, 0.36, 1);
          opacity: 0;
          box-sizing: border-box;
        }
        #pr-ve-label {
          position: absolute;
          top: -32px;
          left: 0;
          background: #0f172a;
          color: #f8fafc;
          font: 600 13px/1.2 ui-sans-serif, system-ui, -apple-system, sans-serif;
          padding: 5px 10px;
          border-radius: 6px;
          white-space: nowrap;
          box-shadow: 0 4px 12px rgba(15, 23, 42, 0.32);
        }
        #pr-ve-cursor {
          position: fixed;
          top: 0;
          left: 0;
          width: 24px;
          height: 24px;
          transform: translate(-100px, -100px);
          transition: transform 320ms cubic-bezier(0.22, 1, 0.36, 1);
          filter: drop-shadow(0 2px 4px rgba(15, 23, 42, 0.45));
          z-index: 2147483647;
        }
        #pr-ve-click {
          position: fixed;
          width: 34px;
          height: 34px;
          margin-left: -17px;
          margin-top: -17px;
          border-radius: 9999px;
          border: 3px solid #2563eb;
          background: rgba(37, 99, 235, 0.22);
          transform: scale(0.3);
          opacity: 0;
          pointer-events: none;
        }
        #pr-ve-click.active {
          animation: pr-ve-ripple 420ms ease-out forwards;
        }
        @keyframes pr-ve-ripple {
          0% { transform: scale(0.3); opacity: 0.95; }
          100% { transform: scale(1.65); opacity: 0; }
        }
      `;
      (document.head || document.documentElement).appendChild(style);
    }

    let layer = document.getElementById("pr-ve-layer");
    if (!layer && document.body) {
      layer = document.createElement("div");
      layer.id = "pr-ve-layer";
      layer.innerHTML = `
        <div id="pr-ve-highlight"><div id="pr-ve-label"></div></div>
        <div id="pr-ve-click"></div>
        <svg id="pr-ve-cursor" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M4 2L20 11.5L12.5 13.5L9.5 21L4 2Z" fill="#0f172a" stroke="#ffffff" stroke-width="1.8" stroke-linejoin="round"/>
        </svg>
      `;
      document.body.appendChild(layer);
    }
    return layer;
  };

  if (document.body) {
    ensureRoot();
  } else {
    window.addEventListener("DOMContentLoaded", ensureRoot, { once: true });
  }

  let resetTimer = null;

  window.__prVe = {
    moveCursor(x, y) {
      ensureRoot();
      const cursor = document.getElementById("pr-ve-cursor");
      if (cursor) {
        cursor.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
      }
    },
    clickPulse(x, y) {
      ensureRoot();
      const ring = document.getElementById("pr-ve-click");
      if (!ring) return;
      ring.style.left = `${Math.round(x)}px`;
      ring.style.top = `${Math.round(y)}px`;
      ring.classList.remove("active");
      void ring.offsetWidth;
      ring.classList.add("active");
    },
    highlightRect(rect, label = "") {
      ensureRoot();
      const box = document.getElementById("pr-ve-highlight");
      const badge = document.getElementById("pr-ve-label");
      if (!box || !badge) return;
      const pad = 6;
      const top = Math.max(4, rect.y - pad);
      const left = Math.max(4, rect.x - pad);
      box.style.top = `${top}px`;
      box.style.left = `${left}px`;
      box.style.width = `${Math.max(16, rect.width + pad * 2)}px`;
      box.style.height = `${Math.max(16, rect.height + pad * 2)}px`;
      box.style.opacity = "1";
      badge.textContent = label;
      badge.style.display = label ? "block" : "none";
      badge.style.top =
        top < 40 ? `${Math.max(16, rect.height + pad * 2) + 8}px` : "-32px";
    },
    clearHighlight() {
      const box = document.getElementById("pr-ve-highlight");
      if (box) box.style.opacity = "0";
    },
    zoomTo(x, y, scale = 1.25) {
      const target = document.getElementById("root") || document.body;
      if (!target) return;
      if (resetTimer) {
        clearTimeout(resetTimer);
        resetTimer = null;
      }
      target.style.transition =
        "transform 380ms cubic-bezier(0.22, 1, 0.36, 1)";
      target.style.transformOrigin = `${Math.round(x)}px ${Math.round(y)}px`;
      target.style.transform = `scale(${scale})`;
    },
    resetZoom() {
      const target = document.getElementById("root") || document.body;
      if (!target || !target.style.transform) return;
      target.style.transition =
        "transform 340ms cubic-bezier(0.22, 1, 0.36, 1)";
      target.style.transform = "scale(1)";
      // Clear transform after transition so #root does not remain a CSS containing block for fixed dialogs.
      resetTimer = setTimeout(() => {
        target.style.transform = "";
        target.style.transformOrigin = "";
        target.style.transition = "";
        resetTimer = null;
      }, 360);
    },
  };
};

export async function installOverlay(context) {
  await context.addInitScript(OVERLAY_INIT_SCRIPT);
}

export async function highlightLocator(page, locator, label = "") {
  await locator.waitFor({ state: "visible", timeout: 15_000 });
  const box = await locator.boundingBox();
  if (!box) throw new Error(`Element not measurable for highlight: ${label}`);
  await page.evaluate(
    ({ rect, text }) => window.__prVe?.highlightRect(rect, text),
    { rect: box, text: label },
  );
  return box;
}

export async function moveAndClick(
  page,
  locator,
  { label = "", zoom = null } = {},
) {
  let box = await highlightLocator(page, locator, label);
  let cx = box.x + box.width / 2;
  let cy = box.y + box.height / 2;
  if (zoom && zoom > 1) {
    const insideRoot = await locator
      .evaluate((el) => Boolean(document.getElementById("root")?.contains(el)))
      .catch(() => false);
    if (insideRoot) {
      await page.evaluate(
        ({ x, y, scale }) => window.__prVe?.zoomTo(x, y, scale),
        { x: cx, y: cy, scale: zoom },
      );
      await page.waitForTimeout(420);
      // Re-measure after zoom so highlight box and cursor align with the scaled element.
      box = await highlightLocator(page, locator, label);
      cx = box.x + box.width / 2;
      cy = box.y + box.height / 2;
    }
  }
  await page.evaluate(({ x, y }) => window.__prVe?.moveCursor(x, y), {
    x: cx,
    y: cy,
  });
  await page.waitForTimeout(360);
  await page.evaluate(({ x, y }) => window.__prVe?.clickPulse(x, y), {
    x: cx,
    y: cy,
  });
  await locator.click();
  await page.waitForTimeout(260);
  return box;
}

export async function clearAnnotations(page) {
  await page.evaluate(() => {
    window.__prVe?.clearHighlight();
    window.__prVe?.resetZoom();
  });
}
