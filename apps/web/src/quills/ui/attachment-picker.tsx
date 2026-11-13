import {
  IconPaperclipOutline18,
  IconXmarkOutline18,
} from "nucleo-ui-essential-outline-18";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";

export interface AttachmentPickerProps {
  /** Files that are already saved, such as on an edited post. */
  attachments: Array<{ id: string; name: string }>;
  /** Chosen files that upload when the form is sent. */
  files: File[];
  disabled?: boolean;
  onFilesChange: (files: File[]) => void;
  onRemove: (id: string) => void;
  onRemoveFile: (file: File) => void;
}

const LIMIT = 10;
const ACCEPT =
  "image/png,image/jpeg,image/webp,image/gif,application/pdf,text/plain,text/csv";
const same = (a: File, b: File) =>
  a.name === b.name && a.size === b.size && a.lastModified === b.lastModified;

/** A paperclip control and the chosen files as removable chips. */
export function AttachmentPicker(props: AttachmentPickerProps) {
  const { t } = useTranslation("quills");
  const hintId = useId();
  const [tooMany, setTooMany] = useState(false);
  const choose = (chosen: File[]) => {
    const added = chosen.filter(
      (file) => !props.files.some((item) => same(item, file)),
    );
    const total = added.length + props.files.length + props.attachments.length;
    setTooMany(total > LIMIT);
    if (total <= LIMIT) props.onFilesChange([...props.files, ...added]);
  };
  const chips = [
    ...props.attachments.map((file) => ({
      key: file.id,
      name: file.name,
      remove: () => props.onRemove(file.id),
    })),
    ...props.files.map((file) => ({
      key: `${file.name}:${file.size}:${file.lastModified}`,
      name: file.name,
      remove: () => props.onRemoveFile(file),
    })),
  ];
  return (
    <div className="portal-attachments flex min-w-0 flex-wrap items-center gap-1.5">
      <label
        title={t("feedback.attachHint")}
        className="flex size-7 cursor-pointer items-center justify-center rounded-md text-muted-foreground transition-colors focus-within:ring-2 focus-within:ring-ring hover:bg-muted hover:text-foreground has-disabled:pointer-events-none has-disabled:opacity-50"
      >
        <IconPaperclipOutline18 aria-hidden="true" className="size-4" />
        <input
          type="file"
          multiple
          accept={ACCEPT}
          disabled={props.disabled}
          aria-label={t("feedback.attachFiles")}
          aria-describedby={hintId}
          className="sr-only"
          onChange={(event) => {
            const chosen = Array.from(event.target.files ?? []);
            event.target.value = "";
            choose(chosen);
          }}
        />
      </label>
      <span id={hintId} className="sr-only">
        {t("feedback.attachHint")}
      </span>
      {chips.map((chip) => (
        <span
          key={chip.key}
          className="flex max-w-48 items-center gap-0.5 rounded-md bg-muted py-0.5 pl-2 text-xs"
        >
          <span className="truncate">{chip.name}</span>
          <button
            type="button"
            disabled={props.disabled}
            aria-label={t("feedback.removeFile", { name: chip.name })}
            className="grid size-6 place-items-center rounded text-muted-foreground hover:text-foreground"
            onClick={() => {
              setTooMany(false);
              chip.remove();
            }}
          >
            <IconXmarkOutline18 aria-hidden="true" className="size-3" />
          </button>
        </span>
      ))}
      {tooMany ? (
        <p role="alert" className="w-full text-xs text-destructive-foreground">
          {t("feedback.attachLimit")}
        </p>
      ) : null}
    </div>
  );
}
