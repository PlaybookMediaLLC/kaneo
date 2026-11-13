import { useState } from "react";
import { useTranslation } from "react-i18next";
import type { Viewer } from "../../../core/types";
import { useGetPortalFile } from "../../../hooks/files/use-get-portal-file";
import { StateView } from "../../../ui/state-view";
import { PortalSheetContent } from "../../../ui/portal-sheet-content";
import {
  Button,
  Sheet,
  SheetHeader,
  SheetTitle,
  SheetPanel,
} from "../../../ui/upstream";
export interface PostAttachmentsProps {
  workspaceId: string;
  viewer: Viewer;
  /** Missing when the API predates attachments. */
  attachments?: Array<{
    id: string;
    name: string;
    contentType: string;
    size: number;
  }>;
}
export function PostAttachments({
  workspaceId,
  viewer,
  attachments,
}: PostAttachmentsProps) {
  const { t } = useTranslation("quills");
  const [selected, setSelected] = useState<string | null>(null);
  const file = useGetPortalFile(
    { param: { workspace: workspaceId, fileId: selected ?? "" } },
    viewer,
  );
  if (!attachments?.length) return null;
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm font-medium">{t("feedback.attachments")}</p>
      <div className="flex flex-wrap gap-2">
        {attachments.map((item) => (
          <Button
            key={item.id}
            variant="outline"
            size="sm"
            className="max-w-full"
            aria-label={t("feedback.openFile", { name: item.name })}
            onClick={() => {
              setSelected(item.id);
            }}
          >
            <span className="truncate">{item.name}</span>
          </Button>
        ))}
      </div>
      <Sheet
        open={Boolean(selected)}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <PortalSheetContent>
          <SheetHeader>
            <SheetTitle>
              {file.data?.name ?? t("feedback.attachments")}
            </SheetTitle>
          </SheetHeader>
          <SheetPanel>
            <StateView
              loading={file.isLoading}
              problem={file.error}
              onRetry={() => {
                void file.refetch();
              }}
            >
              {file.data ? (
                <div className="flex flex-col gap-4">
                  {file.data.contentType.startsWith("image/") ? (
                    <img
                      className="h-auto max-w-full rounded-lg"
                      src={file.data.downloadUrl}
                      alt={file.data.name}
                    />
                  ) : null}
                  <a
                    className="underline underline-offset-4"
                    href={file.data.downloadUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {t("feedback.download")}
                  </a>
                </div>
              ) : null}
            </StateView>
          </SheetPanel>
        </PortalSheetContent>
      </Sheet>
    </div>
  );
}
