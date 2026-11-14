import { useEffect, useId, useRef, useState, type PointerEvent } from "react";
import { validateImage } from "./media.js";
import { Icon } from "./Icon.js";
import { drawMarks, type Mark, type Tool } from "./annotation-draw.js";

const TOOLS: readonly [Tool, string][] = [
  ["box", "Box"],
  ["arrow", "Arrow"],
  ["blur", "Blur"],
  ["redact", "Redact"],
];
const POINTS = [
  ["x", "From x"],
  ["y", "From y"],
  ["x2", "To x"],
  ["y2", "To y"],
] as const;

export function ImageAnnotation({
  file,
  onSave,
  onCancel,
}: {
  file: File;
  onSave: (file: File) => void | Promise<void>;
  onCancel: () => void;
}) {
  const titleId = useId();
  const dialog = useRef<HTMLDialogElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const source = useRef<HTMLImageElement | null>(null);
  const start = useRef<{ x: number; y: number } | null>(null);
  const [marks, setMarks] = useState<Mark[]>([]);
  const [tool, setTool] = useState<Tool>("box");
  const [ready, setReady] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const active = useRef(false);
  useEffect(() => {
    active.current = true;
    const previous = document.activeElement;
    const modal = dialog.current;
    modal?.showModal();
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      if (!active.current || !canvas.current) return;
      const scale = Math.min(
        1,
        2048 / Math.max(image.naturalWidth, image.naturalHeight),
      );
      canvas.current.width = Math.max(
        1,
        Math.round(image.naturalWidth * scale),
      );
      canvas.current.height = Math.max(
        1,
        Math.round(image.naturalHeight * scale),
      );
      source.current = image;
      setReady(true);
    };
    image.onerror = () => {
      if (active.current)
        setError("This image could not be opened. Choose another image.");
    };
    image.src = url;
    return () => {
      active.current = false;
      image.onload = null;
      image.onerror = null;
      URL.revokeObjectURL(url);
      modal?.close();
      if (previous instanceof HTMLElement && previous.isConnected)
        previous.focus();
    };
  }, [file]);
  useEffect(() => {
    const image = source.current;
    const context = canvas.current?.getContext("2d");
    if (!image || !context || !ready) return;
    drawMarks(context, image, marks);
  }, [marks, ready]);
  const point = (event: PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(100, ((event.clientX - rect.left) / rect.width) * 100),
      ),
      y: Math.max(
        0,
        Math.min(100, ((event.clientY - rect.top) / rect.height) * 100),
      ),
    };
  };
  async function save() {
    if (!canvas.current || saving) return;
    setSaving(true);
    setError("");
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.current!.toBlob(resolve, "image/png"),
      );
      if (!active.current) return;
      if (!blob) throw new Error("Could not save the image. Please try again.");
      const output = new File(
        [blob],
        file.name.replace(/\.[^.]+$/, "") + ".png",
        { type: "image/png" },
      );
      await validateImage(output);
      if (active.current) await onSave(output);
    } catch (error) {
      if (active.current)
        setError(
          error instanceof Error
            ? error.message
            : "Could not save the image. Please try again.",
        );
    } finally {
      if (active.current) setSaving(false);
    }
  }
  const selected = marks[marks.length - 1];
  return (
    <dialog
      className="qb-annotation"
      ref={dialog}
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") event.stopPropagation();
      }}
    >
      <header>
        <h2 id={titleId}>Review image</h2>
        <button
          type="button"
          className="qb-icon-button"
          aria-label="Cancel image editing"
          onClick={onCancel}
        >
          <Icon name="close" />
        </button>
      </header>
      <p>
        Draw a box or an arrow, and blur or redact private information before
        attaching. Check the whole image: anything you do not cover stays
        visible.
      </p>
      <div className="qb-annotation-tools" role="group" aria-label="Tool">
        {TOOLS.map(([value, label]) => (
          <button
            type="button"
            key={value}
            aria-pressed={tool === value}
            onClick={() => setTool(value)}
          >
            {label}
          </button>
        ))}
        <button
          type="button"
          disabled={!ready || saving}
          onClick={() =>
            setMarks([...marks, { tool, x: 20, y: 20, x2: 50, y2: 40 }])
          }
        >
          Add {TOOLS.find(([value]) => value === tool)![1].toLowerCase()}
        </button>
        <button
          type="button"
          disabled={!marks.length || saving}
          onClick={() => setMarks(marks.slice(0, -1))}
        >
          <Icon name="undo" />
          Undo
        </button>
      </div>
      <canvas
        ref={canvas}
        aria-label="Image preview. Draw with a pointer, or use the Add button and the position fields."
        onPointerDown={(event) => {
          if (!ready || saving) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          start.current = point(event);
          setMarks([
            ...marks,
            {
              tool,
              ...start.current,
              x2: start.current.x,
              y2: start.current.y,
            },
          ]);
        }}
        onPointerMove={(event) => {
          if (!start.current) return;
          const p = point(event);
          setMarks((current) => [
            ...current.slice(0, -1),
            { ...current[current.length - 1]!, x2: p.x, y2: p.y },
          ]);
        }}
        onPointerUp={() => {
          start.current = null;
        }}
        onPointerCancel={() => {
          start.current = null;
        }}
      />
      {selected && (
        <fieldset disabled={saving}>
          <legend>Last mark position (%)</legend>
          {POINTS.map(([key, label]) => (
            <label key={key}>
              {label}
              <input
                aria-label={`Mark ${label.toLowerCase()}`}
                type="number"
                min="0"
                max="100"
                value={Math.round(selected[key])}
                onChange={(event) => {
                  const value = event.target.valueAsNumber;
                  if (Number.isFinite(value))
                    setMarks((current) =>
                      current.map((mark, i) =>
                        i === current.length - 1
                          ? {
                              ...mark,
                              [key]: Math.min(100, Math.max(0, value)),
                            }
                          : mark,
                      ),
                    );
                }}
              />
            </label>
          ))}
        </fieldset>
      )}
      {error && <p role="alert">{error}</p>}
      <footer>
        <button type="button" onClick={onCancel}>
          Cancel
        </button>
        <button
          type="button"
          className="qb-primary"
          disabled={!ready || saving}
          onClick={() => void save()}
        >
          {saving ? "Saving…" : "Use image"}
        </button>
      </footer>
    </dialog>
  );
}
