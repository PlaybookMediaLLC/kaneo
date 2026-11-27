// Lazy-loaded screenshot capture bundle (served as capture.js on demand, #316).
// Keeps html-to-image completely out of sdk.js until a visitor clicks "Capture screenshot".
import { toCanvas } from "html-to-image";

declare global {
  interface Window {
    __QUILLS_CAPTURE__?: { toCanvas: typeof toCanvas };
  }
}

window.__QUILLS_CAPTURE__ = { toCanvas };
