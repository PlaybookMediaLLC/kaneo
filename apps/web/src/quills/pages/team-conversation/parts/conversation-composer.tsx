import { Lock, MessageSquareReply, Send } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  detectInternalContentInReply,
  extractMentionedPrincipalIds,
} from "../../../core/reply-safety";
import {
  clearThreadDraft,
  readThreadDraft,
  writeThreadDraft,
} from "../../../core/thread-draft";
import type { PortalProblem } from "../../../core/types";
import { uploadObject } from "../../../core/upload-object";
import { useAddConversationNote } from "../../../hooks/team/use-add-conversation-note";
import { useCreateFiles } from "../../../hooks/team/use-create-files";
import { useCreateUpload } from "../../../hooks/team/use-create-upload";
import { useReplyConversation } from "../../../hooks/team/use-reply-conversation";
import { useSendConversationTyping } from "../../../hooks/team/use-send-conversation-typing";
import type { ThreadViewer } from "../../../hooks/team/use-thread-presence";
import { useTeamRuntime } from "../../../team/runtime";
import { AttachmentPicker } from "../../../ui/attachment-picker";
import { Composer } from "../../../ui/inbox/composer";
import { EmojiMenu } from "../../../ui/inbox/emoji-menu";
import type { ComposerMode } from "../../../ui/inbox/inbox-types";
import { ReplyGuardrailBanner } from "../../../ui/inbox/reply-guardrail-banner";
import { ScheduleSendMenu } from "../../../ui/inbox/schedule-send-menu";
import { useKeyShortcuts } from "../../../ui/inbox/use-key-shortcuts";
import type { Teammate } from "../../team-conversations/conversation-list";
import { ActionProblem } from "./action-problem";

export interface ConversationComposerProps {
  workspaceId: string;
  conversationId: string;
  customerName: string;
  people?: readonly Teammate[];
  viewers?: readonly ThreadViewer[];
  onReplyingChange?: (replying: boolean) => void;
  restoredDraft?: { text: string; seq: number } | null;
  onRestoredDraftConsumed?: () => void;
}

type Mode = "reply" | "note";

// The customer sees "typing" for a few seconds after each marker, so one marker
// every few seconds keeps it on without a request per key.
const TYPING_INTERVAL = 4000;

/**
 * The composer at the bottom of the thread: a reply to the customer or an internal note, with
 * files. R and N choose the mode and focus the box while preserving the draft (#324).
 */
export function ConversationComposer(props: ConversationComposerProps) {
  const { t } = useTranslation("quills");
  const team = useTeamRuntime();
  const reply = useReplyConversation(team.viewer);
  const note = useAddConversationNote(team.viewer);
  const typing = useSendConversationTyping(team.viewer);
  const lastTyping = useRef(0);
  const input = useRef<HTMLTextAreaElement>(null);
  const can = {
    reply: team.permissions.update,
    note: Boolean(team.permissions.update || team.permissions.commentInternal),
  };
  const savedDraft = useMemo(
    () =>
      readThreadDraft(
        props.workspaceId,
        "conversation",
        props.conversationId,
        team.viewer.id,
      ),
    [props.workspaceId, props.conversationId, team.viewer.id],
  );
  const initialMode: Mode =
    savedDraft && can[savedDraft.mode]
      ? savedDraft.mode
      : can.reply
        ? "reply"
        : "note";
  const [mode, setMode] = useState<Mode>(initialMode);
  const effectiveMode: Mode = can[mode] ? mode : can.reply ? "reply" : "note";
  const [text, setText] = useState(savedDraft?.text ?? "");
  const [pendingConfirm, setPendingConfirm] = useState<{
    scheduledAt?: string;
  } | null>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadProblem, setUploadProblem] = useState<PortalProblem | null>(
    null,
  );
  // A retry after a failed send reuses the files that already uploaded.
  const uploaded = useRef(new Map<File, string>());
  const sign = useCreateUpload();
  const register = useCreateFiles();
  const param = {
    workspaceId: props.workspaceId,
    conversationId: props.conversationId,
  };

  const { onRestoredDraftConsumed } = props;
  useEffect(() => {
    if (!props.restoredDraft) return;
    if (can.reply) setMode("reply");
    setText(props.restoredDraft.text);
    setPendingConfirm(null);
    onRestoredDraftConsumed?.();
    requestAnimationFrame(() => input.current?.focus());
  }, [props.restoredDraft, can.reply, onRestoredDraftConsumed]);

  useEffect(() => {
    writeThreadDraft(
      props.workspaceId,
      "conversation",
      props.conversationId,
      { text, mode: effectiveMode },
      team.viewer.id,
    );
  }, [
    props.workspaceId,
    props.conversationId,
    text,
    effectiveMode,
    team.viewer.id,
  ]);

  const { onReplyingChange } = props;
  const isReplyingState = effectiveMode === "reply" && Boolean(text.trim());
  useEffect(() => {
    onReplyingChange?.(isReplyingState);
  }, [isReplyingState, onReplyingChange]);

  const switchMode = (next: Mode, shouldFocus = false) => {
    if (!can[next]) return;
    setMode(next);
    setPendingConfirm(null);
    if (shouldFocus) input.current?.focus();
  };

  const focus = (next: Mode) =>
    can[next] ? () => switchMode(next, true) : undefined;
  useKeyShortcuts({ r: focus("reply"), n: focus("note") });

  const modes: ComposerMode[] = [
    ...(can.reply
      ? [
          {
            value: "reply",
            label: t("team-conversations.reply"),
            icon: MessageSquareReply,
            description: t("inbox.replyContext", { name: props.customerName }),
            sendLabel: t("inbox.replySend"),
            sendIcon: Send,
          },
        ]
      : []),
    ...(can.note
      ? [
          {
            value: "note",
            label: t("team-conversations.note"),
            icon: Lock,
            private: true,
            description: t("inbox.noteContext"),
            sendLabel: t("inbox.noteSend"),
            sendIcon: Lock,
          },
        ]
      : []),
  ];

  const people = useMemo(() => props.people ?? [], [props.people]);
  const internalWarning = useMemo(
    () =>
      effectiveMode === "reply"
        ? detectInternalContentInReply(text, people)
        : null,
    [effectiveMode, text, people],
  );
  const replyingTeammates = useMemo(
    () =>
      effectiveMode === "reply"
        ? (props.viewers ?? []).filter((viewer) => viewer.state === "replying")
        : [],
    [effectiveMode, props.viewers],
  );

  const sending = effectiveMode === "reply" ? reply : note;
  // Puts an emoji at the caret (or over the selection) and keeps the caret after it.
  const insert = (emoji: string) => {
    const box = input.current;
    const start = box?.selectionStart ?? text.length;
    const end = box?.selectionEnd ?? text.length;
    setText(text.slice(0, start) + emoji + text.slice(end));
    requestAnimationFrame(() => {
      box?.focus();
      box?.setSelectionRange(start + emoji.length, start + emoji.length);
    });
  };
  const upload = async (file: File) => {
    const saved = uploaded.current.get(file);
    if (saved) return saved;
    const target = { param: { workspaceId: props.workspaceId } };
    const contentType = file.type || "application/octet-stream";
    const signed = await sign.mutateAsync({
      ...target,
      json: {
        purpose: "file",
        filename: file.name,
        contentType,
        size: file.size,
      },
    });
    await uploadObject(file, signed);
    const { id } = await register.mutateAsync({
      ...target,
      json: { key: signed.key, name: file.name, contentType, size: file.size },
    });
    uploaded.current.set(file, id);
    return id;
  };
  const performSend = async (scheduledAt?: string) => {
    if (uploading || sending.isPending) return;
    setUploadProblem(null);
    let attachmentIds: string[];
    setUploading(true);
    try {
      attachmentIds = await Promise.all(files.map(upload));
    } catch (problem) {
      setUploadProblem(problem as PortalProblem);
      return;
    } finally {
      setUploading(false);
    }
    const trimmed = text.trim();
    const sent = text;
    const options = {
      // A file that retention removed (a retry a day later) is 404: upload again next time.
      onError: (problem: PortalProblem) => {
        if (problem.kind === "notFound") uploaded.current.clear();
      },
      onSuccess: () => {
        // Text typed while the files uploaded stays in the box.
        setText((current) => (current === sent ? "" : current));
        setPendingConfirm(null);
        setFiles([]);
        uploaded.current.clear();
        clearThreadDraft(
          props.workspaceId,
          "conversation",
          props.conversationId,
          team.viewer.id,
        );
      },
    };
    if (effectiveMode === "reply") {
      reply.mutate(
        {
          param,
          json: {
            content: trimmed,
            ...(attachmentIds.length ? { attachmentIds } : {}),
            ...(scheduledAt ? { scheduledAt } : {}),
          },
        },
        options,
      );
    } else {
      const mentionPrincipalIds = extractMentionedPrincipalIds(trimmed, people);
      note.mutate(
        {
          param,
          json: {
            content: trimmed,
            ...(attachmentIds.length ? { attachmentIds } : {}),
            ...(mentionPrincipalIds.length ? { mentionPrincipalIds } : {}),
          },
        },
        options,
      );
    }
  };
  const send = (scheduledAt?: string) => {
    if (
      effectiveMode === "reply" &&
      internalWarning?.flagged &&
      !pendingConfirm
    ) {
      setPendingConfirm({ scheduledAt });
      return;
    }
    void performSend(scheduledAt ?? pendingConfirm?.scheduledAt);
  };

  return (
    <div className="mx-auto w-full max-w-200 px-4 pb-4">
      <Composer
        label={
          effectiveMode === "reply"
            ? t("team-conversations.replyTo", { name: props.customerName })
            : t("team-conversations.noteLabel")
        }
        value={text}
        onChange={(value) => {
          setText(value);
          setPendingConfirm(null);
          if (effectiveMode !== "reply") return;
          if (Date.now() - lastTyping.current < TYPING_INTERVAL) return;
          lastTyping.current = Date.now();
          typing.mutate({ param });
        }}
        onSend={() => send()}
        onPaste={
          team.permissions.create
            ? (event) => {
                const items = event.clipboardData?.items;
                if (!items) return;
                const pastedImages: File[] = [];
                const now = Date.now();
                Array.from(items).forEach((item, idx) => {
                  if (
                    item.kind === "file" &&
                    item.type.startsWith("image/") &&
                    item.type !== "image/svg+xml"
                  ) {
                    const file = item.getAsFile();
                    if (file) {
                      const ext =
                        file.type.split("/")[1]?.replace(/[^a-z0-9]/gi, "") ||
                        "png";
                      const named =
                        file.name && file.name !== "image.png"
                          ? file
                          : new File(
                              [file],
                              `screenshot-${now}-${idx}.${ext}`,
                              {
                                type: file.type,
                              },
                            );
                      pastedImages.push(named);
                    }
                  }
                });
                if (pastedImages.length > 0) {
                  if (!event.clipboardData?.getData("text/plain")) {
                    event.preventDefault();
                  }
                  setFiles((prev) => [...prev, ...pastedImages].slice(0, 10));
                }
              }
            : undefined
        }
        modes={modes}
        mode={effectiveMode}
        onModeChange={(value) => switchMode(value as Mode)}
        sending={uploading || sending.isPending}
        disabled={!modes.length}
        inputRef={input}
        sendExtra={
          effectiveMode === "reply" && can.reply ? (
            <ScheduleSendMenu
              disabled={!text.trim() || uploading || sending.isPending}
              onSchedule={(isoDate) => send(isoDate)}
            />
          ) : null
        }
        banner={
          <ReplyGuardrailBanner
            internalWarning={internalWarning}
            confirmingSend={pendingConfirm !== null}
            sending={uploading || sending.isPending}
            replyingTeammates={replyingTeammates}
            canSwitchToNote={can.note}
            onSwitchToNote={() => switchMode("note", true)}
            onConfirmSendAnyway={() =>
              void performSend(pendingConfirm?.scheduledAt)
            }
          />
        }
        tools={
          <>
            {team.permissions.create ? (
              <AttachmentPicker
                attachments={[]}
                files={files}
                disabled={uploading || sending.isPending || !modes.length}
                onFilesChange={setFiles}
                onRemove={() => undefined}
                onRemoveFile={(file) => {
                  uploaded.current.delete(file);
                  setFiles((list) => list.filter((item) => item !== file));
                }}
              />
            ) : null}
            <EmojiMenu disabled={!modes.length} onPick={insert} />
          </>
        }
      />
      <ActionProblem problem={uploadProblem ?? sending.error} />
    </div>
  );
}
