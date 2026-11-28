import { Ban, Download, Ellipsis, ShieldOff, UserMinus } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  createPrivacyAccessRequest,
  eraseCustomerData,
} from "@/fetchers/quills/privacy";
import type { PortalProblem } from "../../../core/types";
import { useBlockUser } from "../../../hooks/team/use-block-user";
import { useDeleteUser } from "../../../hooks/team/use-delete-user";
import { useUnblockUser } from "../../../hooks/team/use-unblock-user";
import { useTeamRuntime } from "../../../team/runtime";
import { IconButton } from "../../../ui/inbox/icon-button";
import {
  ConfirmDialog,
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
  toast,
} from "../../../ui/upstream";

export interface MemberMenuProps {
  workspaceId: string;
  member: { principalId: string; name: string; blockedAt: string | null };
  onRemoved: () => void;
}

/** The kebab menu of a member: block/unblock, export/erase personal data, and remove. */
export function MemberMenu({
  workspaceId,
  member,
  onRemoved,
}: MemberMenuProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const block = useBlockUser(team.viewer);
  const unblock = useUnblockUser(team.viewer);
  const remove = useDeleteUser(team.viewer);
  const [confirm, setConfirm] = useState(false);
  const [confirmErase, setConfirmErase] = useState(false);
  const [erasing, setErasing] = useState(false);
  const [exporting, setExporting] = useState(false);
  const input = {
    param: { workspaceId, principalId: member.principalId },
  };
  // A 409 means that the person still authors posts, comments or conversations.
  const fail = (problem: PortalProblem) =>
    toast.error(
      t(
        problem.kind === "conflict"
          ? "team-members.removeConflict"
          : "team-members.failed",
      ),
    );
  const toggleBlock = () =>
    (member.blockedAt ? unblock : block)
      .mutateAsync(input)
      .then(() =>
        toast.success(
          t(
            member.blockedAt
              ? "team-members.unblocked"
              : "team-members.blockedDone",
          ),
        ),
      )
      .catch(fail);

  const exportData = async () => {
    setExporting(true);
    try {
      await createPrivacyAccessRequest(workspaceId, member.principalId);
      toast.success(t("team-members.exportQueued"));
    } catch {
      toast.error(t("team-members.failed"));
    } finally {
      setExporting(false);
    }
  };

  const eraseData = async () => {
    setErasing(true);
    try {
      await eraseCustomerData(workspaceId, member.principalId, "anonymize");
      setConfirmErase(false);
      toast.success(t("team-members.erased"));
      onRemoved();
    } catch {
      toast.error(t("team-members.failed"));
    } finally {
      setErasing(false);
    }
  };

  return (
    <>
      <Menu>
        <MenuTrigger render={<IconButton label={t("team-members.actions")} />}>
          <Ellipsis aria-hidden="true" />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem
            disabled={!team.permissions.update}
            onClick={() => void toggleBlock()}
          >
            <Ban aria-hidden="true" />
            {t(
              member.blockedAt ? "team-members.unblock" : "team-members.block",
            )}
          </MenuItem>
          <MenuItem
            disabled={!team.permissions.manageSettings || exporting}
            onClick={() => void exportData()}
          >
            <Download aria-hidden="true" />
            {t("team-members.exportData")}
          </MenuItem>
          <MenuSeparator />
          <MenuItem
            variant="destructive"
            disabled={!team.permissions.manageSettings}
            onClick={() => setConfirmErase(true)}
          >
            <ShieldOff aria-hidden="true" />
            {t("team-members.eraseData")}
          </MenuItem>
          <MenuItem
            variant="destructive"
            disabled={!team.permissions.delete}
            onClick={() => setConfirm(true)}
          >
            <UserMinus aria-hidden="true" />
            {t("team-members.remove")}
          </MenuItem>
        </MenuPopup>
      </Menu>
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title={t("team-members.removeTitle", { name: member.name })}
        description={t("team-members.removeText")}
        confirmLabel={t("team-members.remove")}
        pending={remove.isPending}
        onConfirm={() =>
          void remove
            .mutateAsync(input)
            .then(() => {
              setConfirm(false);
              toast.success(t("team-members.removed"));
              onRemoved();
            })
            .catch(fail)
        }
      />
      <ConfirmDialog
        open={confirmErase}
        onOpenChange={setConfirmErase}
        title={t("team-members.eraseTitle", { name: member.name })}
        description={t("team-members.eraseText")}
        confirmLabel={t("team-members.eraseData")}
        pending={erasing}
        onConfirm={() => void eraseData()}
      />
    </>
  );
}
