import { useRef, useState } from "react";
import { AttachmentPicker } from "./attachment-picker";
import { useTranslation } from "react-i18next";
import { MarkdownContent } from "./markdown-content";
import { Button, Textarea } from "./upstream";
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
      <AttachmentPicker
        attachments={props.attachments}
        files={props.files}
        disabled={props.disabled}
        onFilesChange={props.onFilesChange}
        onRemove={props.onRemove}
        onRemoveFile={props.onRemoveFile}
      />
    </div>
  );
}
