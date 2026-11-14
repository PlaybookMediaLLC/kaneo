// Drawing for the image editor. A mark goes from one point to another, in percent of the image:
// a box, a blur and a redaction fill the rectangle between the points; an arrow points from the
// first point to the second.

export type Tool = "box" | "arrow" | "blur" | "redact";
export type Mark = { tool: Tool; x: number; y: number; x2: number; y2: number };

const RED = "#e53935";
const DARK = "#171717";

/** The two short lines of an arrowhead at (x2, y2), each `size` long and 25 degrees off the line. */
export function arrowHead(
  x: number,
  y: number,
  x2: number,
  y2: number,
  size: number,
): [number, number, number, number] {
  const angle = Math.atan2(y2 - y, x2 - x);
  const spread = (25 * Math.PI) / 180;
  return [
    x2 - size * Math.cos(angle - spread),
    y2 - size * Math.sin(angle - spread),
    x2 - size * Math.cos(angle + spread),
    y2 - size * Math.sin(angle + spread),
  ];
}

/** The image with its marks, in order. A blur pixelates what is under it at that moment. */
export function drawMarks(
  context: CanvasRenderingContext2D,
  image: CanvasImageSource,
  marks: readonly Mark[],
) {
  const { width, height } = context.canvas;
  context.clearRect(0, 0, width, height);
  context.drawImage(image, 0, 0, width, height);
  const line = Math.max(3, width / 300);
  for (const mark of marks) {
    const x = (Math.min(mark.x, mark.x2) * width) / 100;
    const y = (Math.min(mark.y, mark.y2) * height) / 100;
    const w = (Math.abs(mark.x2 - mark.x) * width) / 100;
    const h = (Math.abs(mark.y2 - mark.y) * height) / 100;
    if (mark.tool === "redact") {
      context.fillStyle = DARK;
      context.fillRect(x, y, w, h);
    } else if (mark.tool === "blur") {
      // Large blocks: text under them cannot be read back. Redact hides it completely.
      const block = Math.max(12, Math.round(width / 80));
      const small = document.createElement("canvas");
      small.width = Math.max(1, Math.round(w / block));
      small.height = Math.max(1, Math.round(h / block));
      if (w >= 1 && h >= 1) {
        small
          .getContext("2d")
          ?.drawImage(
            context.canvas,
            x,
            y,
            w,
            h,
            0,
            0,
            small.width,
            small.height,
          );
        context.imageSmoothingEnabled = false;
        context.drawImage(small, 0, 0, small.width, small.height, x, y, w, h);
        context.imageSmoothingEnabled = true;
      }
    } else {
      context.strokeStyle = RED;
      context.lineWidth = line;
      if (mark.tool === "box") context.strokeRect(x, y, w, h);
      else {
        const [x1, y1, x2, y2] = [
          (mark.x * width) / 100,
          (mark.y * height) / 100,
          (mark.x2 * width) / 100,
          (mark.y2 * height) / 100,
        ];
        const [ax, ay, bx, by] = arrowHead(x1, y1, x2, y2, line * 5);
        context.beginPath();
        context.moveTo(x1, y1);
        context.lineTo(x2, y2);
        context.moveTo(ax, ay);
        context.lineTo(x2, y2);
        context.lineTo(bx, by);
        context.stroke();
      }
    }
  }
}
