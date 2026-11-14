import { useId } from "react";
import { useTranslation } from "react-i18next";
import { z } from "zod";
import type { PortalProblem } from "../../../core/types";
import { PortalForm } from "../../../ui/portal-form";
import { Checkbox, Label } from "../../../ui/upstream";

export interface BoardSegmentsProps {
  board: { name: string; visibleSegmentIds: string[] | null };
  segments: { id: string; name: string }[];
  /** Absent for a teammate without manage_settings: the choice shows, the save does not. */
  onSubmit?: (segmentIds: string[]) => Promise<PortalProblem | void>;
}

// RFC 0003 D11: the segments that may see one board. No segment means every customer that the
// board's access tier admits. The API checks the permission and the segment IDs.
export function BoardSegments({
  board,
  segments,
  onSubmit,
}: BoardSegmentsProps) {
  const { t } = useTranslation("quills");
  const legend = useId();
  const schema = z.object({ segmentIds: z.array(z.string()).max(50) });
  /** The checkboxes; without `change` they only show the stored choice. */
  const fields = (
    chosen: string[],
    change?: (segmentIds: string[]) => void,
  ) => (
    <div role="group" aria-labelledby={legend} className="grid gap-2">
      <p id={legend} className="text-sm font-medium">
        {t("boards.segments.legend", { board: board.name })}
      </p>
      <p className="text-sm text-muted-foreground">
        {chosen.length ? t("boards.segments.some") : t("boards.segments.all")}
      </p>
      {segments.map((segment) => (
        <Label key={segment.id}>
          <Checkbox
            checked={chosen.includes(segment.id)}
            disabled={!change}
            onCheckedChange={(checked) =>
              change?.(
                checked
                  ? [...chosen, segment.id]
                  : chosen.filter((id) => id !== segment.id),
              )
            }
          />
          {segment.name}
        </Label>
      ))}
    </div>
  );
  if (!segments.length)
    return (
      <p className="text-sm text-muted-foreground">
        {t("boards.segments.none")}
      </p>
    );
  if (!onSubmit) return fields(board.visibleSegmentIds ?? []);
  return (
    <PortalForm<{ segmentIds: string[] }>
      schema={schema}
      defaultValues={{ segmentIds: board.visibleSegmentIds ?? [] }}
      submitKey="boards.segments.save"
      onSubmit={(values) => onSubmit(values.segmentIds)}
    >
      {(form) =>
        fields(form.watch("segmentIds"), (segmentIds) =>
          form.setValue("segmentIds", segmentIds),
        )
      }
    </PortalForm>
  );
}
