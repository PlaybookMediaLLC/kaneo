import { createDraftKey } from "./create-draft-key";
import { useRef, useState, useEffect } from "react";
import type { Viewer } from "./types";
import { uploadObject } from "./upload-object";
import { usePreparePortalUpload } from "../hooks/files/use-prepare-portal-upload";
import { useCreatePortalUpload } from "../hooks/files/use-create-portal-upload";
import { useCreatePortalFiles } from "../hooks/files/use-create-portal-files";
import { useDiscardPortalFile } from "../hooks/files/use-discard-portal-file";
import type { CreatePortalUploadResponse } from "../api/files/create-portal-upload";

export interface FeedbackAttachment {
  id: string;
  name: string;
  contentType: string;
  size: number;
}
export function useFeedbackAttachments(
  workspaceId: string,
  viewer: Viewer,
  initial: FeedbackAttachment[] = [],
) {
  const [attachments, setAttachments] = useState(initial);
  const [files, setFiles] = useState<File[]>([]);
  const [idempotencyKey, setIdempotencyKey] = useState(() => createDraftKey());
  const uploaded = useRef(
    new Map<
      File,
      { upload: CreatePortalUploadResponse; id?: string; sent?: boolean }
    >(),
  );
  const prepare = usePreparePortalUpload(viewer);
  const sign = useCreatePortalUpload(viewer);
  const register = useCreatePortalFiles(viewer);
  const discard = useDiscardPortalFile(viewer);
  const scope = `${workspaceId}:${viewer.kind === "user" ? viewer.id : "anonymous"}`;
  const originalScope = useRef(scope);
  useEffect(() => {
    if (originalScope.current !== scope) {
      setFiles([]);
      setAttachments([]);
      uploaded.current.clear();
      setIdempotencyKey(createDraftKey());
      originalScope.current = scope;
    }
  }, [scope]);
  const param = { workspace: workspaceId };
  return {
    idempotencyKey,
    attachments,
    files,
    setFiles,
    remove: (id: string) =>
      setAttachments((values) => values.filter((file) => file.id !== id)),
    upload: async () => {
      if (files.length) await prepare.mutateAsync({ param });
      const ids = attachments.map((file) => file.id);
      for (const file of files) {
        let saved = uploaded.current.get(file);
        if (!saved) {
          saved = {
            upload: await sign.mutateAsync({
              param,
              json: {
                purpose: "customer_file",
                filename: file.name,
                contentType: file.type || "application/octet-stream",
                size: file.size,
              },
            }),
          };
          uploaded.current.set(file, saved);
        }
        if (!saved.sent) {
          try {
            await uploadObject(file, saved.upload);
            saved.sent = true;
          } catch (error) {
            uploaded.current.delete(file);
            throw error;
          }
        }
        if (!saved.id)
          saved.id = (
            await register.mutateAsync({
              param,
              json: {
                key: saved.upload.key,
                name: file.name,
                contentType: file.type || "application/octet-stream",
                size: file.size,
              },
            })
          ).id;
        ids.push(saved.id);
      }
      return ids;
    },
    removeFile: (file: File) => {
      setFiles((values) => values.filter((item) => item !== file));
      const id = uploaded.current.get(file)?.id;
      if (id && window.top === window.self)
        discard.mutate({ param: { ...param, fileId: id } });
      uploaded.current.delete(file);
    },
    reset: () => {
      setFiles([]);
      setAttachments([]);
      uploaded.current.clear();
      setIdempotencyKey(createDraftKey());
    },
  };
}
