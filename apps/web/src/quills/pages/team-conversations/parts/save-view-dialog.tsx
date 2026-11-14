import { useTranslation } from "react-i18next";
import type { PortalProblem } from "../../../core/types";
import { useCreateConversationView } from "../../../hooks/team/use-create-conversation-view";
import { useTeamRuntime } from "../../../team/runtime";
import { Dialog, DialogPopup, DialogTitle } from "../../../ui/upstream";
import type { ListContext } from "../conversation-list";
import { viewRules } from "../list-filters";
import { SaveViewForm } from "./save-view-form";

export interface SaveViewDialogProps {
  workspaceId: string;
  /** The list to save. */
  context: ListContext;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Runs with the new view. */
  onSaved: (viewId: string) => void;
}

/** "Save as view…": names the current list and saves its filters as a conversation view. */
export function SaveViewDialog(props: SaveViewDialogProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const create = useCreateConversationView(team.viewer);
  const rules = viewRules(props.context);
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogPopup className="gap-4 p-6">
        <DialogTitle>{t("team-conversations.saveView.title")}</DialogTitle>
        <SaveViewForm
          onSubmit={async ({ name }): Promise<PortalProblem | void> => {
            if (!rules) return;
            try {
              const view = await create.mutateAsync({
                param: { workspaceId: props.workspaceId },
                json: {
                  name,
                  filters: { rules },
                  sort: props.context.view === "queue" ? "waiting" : "recent",
                },
              });
              props.onSaved(view.id);
            } catch (error) {
              return error as PortalProblem;
            }
          }}
        />
      </DialogPopup>
    </Dialog>
  );
}
