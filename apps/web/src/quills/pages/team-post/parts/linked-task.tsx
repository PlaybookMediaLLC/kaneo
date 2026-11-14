import { Link } from "@tanstack/react-router";
import { SquareCheck } from "lucide-react";
import { useTranslation } from "react-i18next";
import { useGetTask } from "../../../ui/upstream";

export interface LinkedTaskProps {
  workspaceId: string;
  taskId: string;
}

/** A Kaneo task that a post links to. A task the viewer cannot open shows as unavailable. */
export function LinkedTask({ workspaceId, taskId }: LinkedTaskProps) {
  const { t } = useTranslation("quills");
  const task = useGetTask(taskId);
  if (!task.data)
    return (
      <span className="text-muted-foreground">
        {task.isLoading
          ? t("team-post.loadingTask")
          : t("team-post.hiddenTask")}
      </span>
    );
  return (
    <Link
      to={`/dashboard/workspace/${encodeURIComponent(workspaceId)}/project/${encodeURIComponent(task.data.projectId)}/task/${encodeURIComponent(taskId)}`}
      className="flex min-w-0 items-center gap-1.5 hover:underline"
    >
      <SquareCheck aria-hidden="true" className="size-4 shrink-0" />
      <span className="truncate">{task.data.title}</span>
    </Link>
  );
}
