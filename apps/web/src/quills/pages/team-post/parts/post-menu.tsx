import { Ellipsis, ExternalLink, Link2, Share2, Trash2 } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { portalHref } from "../../../core/portal-href";
import { useTeamRuntime } from "../../../team/runtime";
import {
  Button,
  Menu,
  MenuItem,
  MenuPopup,
  MenuSeparator,
  MenuTrigger,
  toast,
} from "../../../ui/upstream";
import { DeletePostDialog } from "./delete-post-dialog";

export interface PostMenuProps {
  workspaceId: string;
  postId: string;
  title: string;
  onDeleted: () => void;
}

/** The kebab menu of a request: visit, share or copy its portal page, and delete it. */
export function PostMenu(props: PostMenuProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const [confirm, setConfirm] = useState(false);
  const page = () =>
    new URL(
      portalHref(
        props.workspaceId,
        `posts/${encodeURIComponent(props.postId)}`,
      ),
      window.location.origin,
    ).href;
  const copy = () =>
    void (
      navigator.clipboard
        ? navigator.clipboard.writeText(page())
        : Promise.reject(new Error("No clipboard"))
    ).then(
      () => toast.success(t("team-post.linkCopied")),
      () => toast.error(t("core.problem.failed")),
    );
  return (
    <>
      <Menu>
        <MenuTrigger
          render={
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t("team-post.more")}
            />
          }
        >
          <Ellipsis aria-hidden="true" />
        </MenuTrigger>
        <MenuPopup align="end">
          <MenuItem onClick={() => window.open(page(), "_blank", "noopener")}>
            <ExternalLink aria-hidden="true" />
            {t("team-post.visit")}
          </MenuItem>
          {"share" in navigator ? (
            <MenuItem
              onClick={() =>
                void navigator
                  .share({ title: props.title, url: page() })
                  .catch(() => undefined)
              }
            >
              <Share2 aria-hidden="true" />
              {t("team-post.share")}
            </MenuItem>
          ) : null}
          <MenuItem onClick={copy}>
            <Link2 aria-hidden="true" />
            {t("team-post.copyLink")}
          </MenuItem>
          {team.permissions.delete ? (
            <>
              <MenuSeparator />
              <MenuItem variant="destructive" onClick={() => setConfirm(true)}>
                <Trash2 aria-hidden="true" />
                {t("team-post.delete")}
              </MenuItem>
            </>
          ) : null}
        </MenuPopup>
      </Menu>
      {confirm ? (
        <DeletePostDialog
          workspaceId={props.workspaceId}
          postId={props.postId}
          onClose={() => setConfirm(false)}
          onDeleted={props.onDeleted}
        />
      ) : null}
    </>
  );
}
