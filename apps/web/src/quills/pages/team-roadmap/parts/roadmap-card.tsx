import { useSortable } from "@dnd-kit/sortable";
import { memo, useCallback, useEffect, useRef } from "react";
import { plainText } from "../../../core/plain-text";
import { cn } from "../../../ui/upstream";
import { ownListeners } from "../card-listeners";
import type { DragItem } from "../roadmap-moves";
import {
  RoadmapCardBody,
  type RoadmapCardBodyProps,
} from "./roadmap-card-body";

// The drag state changes on each move of a drag over the board; the body does not need it.
const Body = memo(RoadmapCardBody);

export interface RoadmapCardProps extends Omit<
  RoadmapCardBodyProps,
  "activatorRef" | "describedBy"
> {
  /** Moves the keyboard focus to the title when the card mounts, after a move by its menu. */
  focus?: boolean;
  onFocused?: () => void;
}

/**
 * A roadmap card. A pointer or a long touch drags it to another column, Space on the title
 * starts a keyboard drag, and its menu moves it without a drag. This wrapper holds only the
 * drag state; the memoized body does not render again while a drag moves over the board.
 */
export function RoadmapCard({ focus, onFocused, ...body }: RoadmapCardProps) {
  const title = plainText(body.post.title);
  const data: DragItem = {
    type: "card",
    post: body.post,
    statusId: body.statusId,
    label: title,
  };
  const drag = useSortable({
    id: body.post.id,
    data,
    disabled: { draggable: !body.onMove, droppable: false },
  });
  const link = useRef<HTMLElement | null>(null);
  const { setActivatorNodeRef } = drag;
  const activatorRef = useCallback(
    (element: HTMLElement | null) => {
      link.current = element;
      setActivatorNodeRef(element);
    },
    [setActivatorNodeRef],
  );
  useEffect(() => {
    if (!focus) return;
    link.current?.focus();
    onFocused?.();
  }, [focus, onFocused]);
  return (
    <article
      ref={drag.setNodeRef}
      {...ownListeners(drag.listeners)}
      className={cn(
        "group relative rounded-lg border border-border bg-card px-3 py-2.5 shadow-xs/5 transition-[border-color,box-shadow] duration-150 ease-out hover:border-foreground/12 hover:shadow-sm/5 has-focus-visible:border-foreground/12 motion-reduce:transition-none",
        body.onMove && "cursor-grab active:cursor-grabbing",
        // The lifted card follows the pointer; its place shows as an empty slot.
        drag.isDragging &&
          "border-dashed border-ring/40 bg-transparent shadow-none hover:border-ring/40",
      )}
    >
      <div className={cn(drag.isDragging && "invisible")}>
        <Body
          {...body}
          title={title}
          activatorRef={activatorRef}
          describedBy={
            body.onMove ? drag.attributes["aria-describedby"] : undefined
          }
        />
      </div>
    </article>
  );
}
