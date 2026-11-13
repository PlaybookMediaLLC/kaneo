import { useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { MarkdownContent } from "./markdown-content";
import { Button, Input, Field, FieldLabel, Textarea } from "./upstream";
export interface FeedbackEditorProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  invalid?: boolean;
  disabled?: boolean;
  maxLength: number;
  attachments: Array<{ id: string; name: string }>;
  files: File[];
  onFilesChange: (files: File[]) => void;
  onRemove: (id: string) => void;
  onRemoveFile: (file: File) => void;
}
export function FeedbackEditor(props: FeedbackEditorProps) {
  const { t } = useTranslation("quills");
  const ref = useRef<HTMLTextAreaElement>(null);
  const [preview, setPreview] = useState(false);
  const [error, setError] = useState(false);
  const insert = (prefix: string, suffix = "") => {
    const input = ref.current;
    if (!input) return;
    const { selectionStart: start, selectionEnd: end } = input;
    const value =
      props.value.slice(0, start) +
      prefix +
      props.value.slice(start, end) +
      suffix +
      props.value.slice(end);
    if (value.length > props.maxLength) return;
    props.onChange(value);
    requestAnimationFrame(() => {
      input.focus();
      input.setSelectionRange(start + prefix.length, end + prefix.length);
    });
  };
  return (
    <div className="flex flex-col gap-3">
      <div
        role="toolbar"
        aria-label={t("feedback.formatting")}
        className="flex flex-wrap gap-1"
      >
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={props.disabled || preview}
          onClick={() => insert("**", "**")}
        >
          {t("feedback.bold")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={props.disabled || preview}
          onClick={() => insert("*", "*")}
        >
          {t("feedback.italic")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={props.disabled || preview}
          onClick={() => insert("\n- ")}
        >
          {t("feedback.list")}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={props.disabled || preview}
          onClick={() => insert("[", "](https://)")}
        >
          {t("feedback.link")}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          aria-pressed={preview}
          onClick={() => setPreview((value) => !value)}
        >
          {t("feedback.preview")}
        </Button>
      </div>
      <Textarea
        id={props.id}
        ref={ref}
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        maxLength={props.maxLength}
        disabled={props.disabled}
        aria-invalid={props.invalid}
        className={preview ? "hidden" : "min-h-40"}
      />
      {preview ? (
        <div className="min-h-40 rounded-lg border border-border p-3">
          <MarkdownContent content={props.value} />
        </div>
      ) : null}
      <Field>
        <FieldLabel htmlFor={`${props.id}-files`}>
          {t("feedback.attachFiles")}
        </FieldLabel>
        <Input
          id={`${props.id}-files`}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/csv"
          disabled={props.disabled}
          onChange={(event) => {
            const chosen = Array.from(event.target.files ?? []);
            event.target.value = "";
            if (
              chosen.length + props.files.length + props.attachments.length >
              10
            ) {
              setError(true);
              return;
            }
            setError(false);
            props.onFilesChange([
              ...props.files,
              ...chosen.filter(
                (file) =>
                  !props.files.some(
                    (existing) =>
                      existing.name === file.name &&
                      existing.size === file.size &&
                      existing.lastModified === file.lastModified,
                  ),
              ),
            ]);
          }}
        />
      </Field>
      <p className="text-xs text-muted-foreground">
        {t("feedback.attachHint")}
      </p>
      {error ? <p role="alert">{t("feedback.attachLimit")}</p> : null}
      <ul className="flex flex-col gap-2">
        {props.attachments.map((file) => (
          <li key={file.id} className="flex items-center justify-between gap-2">
            <span className="min-w-0 break-all text-sm">{file.name}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={props.disabled}
              aria-label={t("feedback.removeFile", { name: file.name })}
              onClick={() => props.onRemove(file.id)}
            >
              {t("feedback.remove")}
            </Button>
          </li>
        ))}
        {props.files.map((file) => (
          <li
            key={`${file.name}:${file.size}:${file.lastModified}`}
            className="flex items-center justify-between gap-2"
          >
            <span className="min-w-0 break-all text-sm">{file.name}</span>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={props.disabled}
              aria-label={t("feedback.removeFile", { name: file.name })}
              onClick={() => props.onRemoveFile(file)}
            >
              {t("feedback.remove")}
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}
