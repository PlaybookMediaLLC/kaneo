import { and, desc, eq, inArray, isNull, or } from "drizzle-orm";
import type { PrincipalId, TypeId } from "@kaneo/ids";
import {
  withQuillsSystemWorkspace,
  type Database,
} from "../../database/quills/client";
import { principal, settings, user } from "../../database/quills/schema/auth";
import { changelogSubscriptions } from "../../database/quills/schema/changelog-subscriptions";
import { companies } from "../../database/quills/schema/companies";
import {
  conversationMessages,
  conversations,
} from "../../database/quills/schema/conversation";
import { files } from "../../database/quills/schema/files";
import type { JobQueueRow } from "../../database/quills/schema/job-queue";
import { postSubscriptions } from "../../database/quills/schema/notifications";
import {
  postComments,
  posts,
  postVotes,
} from "../../database/quills/schema/posts";
import {
  privacyRequests,
  type PrivacyRequestSummary,
} from "../../database/quills/schema/privacy";
import { statusSubscriptions } from "../../database/quills/schema/status";
import { surveyResponses } from "../../database/quills/schema/surveys";
import { ticketSubscriptions } from "../../database/quills/schema/ticket-subscriptions";
import { tickets } from "../../database/quills/schema/tickets";
import { recordQuillsChange } from "../events";
import {
  exportKey,
  isQuillsStorageConfigured,
  putObject,
  readObject,
} from "../framework/files";
import { loadEvent } from "../jobs/fanout";
import { eventPayloadSchema, finishQuillsJob } from "../jobs/queue";
import { buildZipArchive, type ZipEntry } from "./zip";

const EXPORT_TTL_MS = 7 * 86_400_000;
const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_ATTACHMENTS_BYTES = 25 * 1024 * 1024;

export type SubjectExportPayload = {
  format: "quills-subject-export";
  version: 1;
  exportedAt: string;
  workspace: { id: string; name: string; slug: string };
  profile: {
    principalId: string;
    displayName: string | null;
    email: string | null;
    contactEmail: string | null;
    externalId: string | null;
    type: string;
    attributes: unknown;
    createdAt: string;
    company: { id: string; name: string; domain: string | null } | null;
  };
  posts: Array<{
    id: string;
    title: string;
    content: string | null;
    createdAt: string;
  }>;
  comments: Array<{
    id: string;
    postId: string;
    content: string;
    createdAt: string;
  }>;
  votes: Array<{
    id: string;
    postId: string;
    createdAt: string;
  }>;
  conversations: Array<{
    id: string;
    channel: string;
    status: string;
    subject: string | null;
    createdAt: string;
    messages: Array<{
      id: string;
      senderType: string;
      content: string;
      createdAt: string;
      attachments: Array<{
        fileId: string | null;
        name: string;
        contentType: string;
        size: number;
        archivePath: string | null;
      }>;
    }>;
  }>;
  tickets: Array<{
    id: string;
    subject: string;
    priority: string;
    createdAt: string;
  }>;
  surveyResponses: Array<{
    id: string;
    surveyId: string;
    value: unknown;
    createdAt: string;
  }>;
  subscriptions: {
    posts: string[];
    tickets: string[];
    changelog: boolean;
    statusPage: boolean;
  };
};

type AttachmentRef = {
  fileId: string;
  storageKey: string;
  name: string;
  archivePath: string;
};

/**
 * Collects all customer-owned data in a single workspace-scoped read transaction. Internal
 * teammate notes (`is_internal = true`) and private workspace data are strictly excluded.
 */
export async function collectSubjectData(
  db: Database,
  workspaceId: string,
  subjectPrincipalId: PrincipalId,
): Promise<{
  payload: SubjectExportPayload;
  attachmentRefs: AttachmentRef[];
  summary: PrivacyRequestSummary;
} | null> {
  const [ws] = await db
    .select({ name: settings.name, slug: settings.slug })
    .from(settings)
    .limit(1);
  const [subject] = await db
    .select({
      id: principal.id,
      type: principal.type,
      displayName: principal.displayName,
      contactEmail: principal.contactEmail,
      companyId: principal.companyId,
      createdAt: principal.createdAt,
      userId: principal.userId,
      email: user.email,
      userName: user.name,
      externalId: user.externalId,
      metadata: user.metadata,
    })
    .from(principal)
    .leftJoin(user, eq(user.id, principal.userId))
    .where(eq(principal.id, subjectPrincipalId))
    .limit(1);

  if (!subject || !ws) return null;

  let company: { id: string; name: string; domain: string | null } | null =
    null;
  if (subject.companyId) {
    const [co] = await db
      .select({
        id: companies.id,
        name: companies.name,
        domain: companies.domain,
      })
      .from(companies)
      .where(eq(companies.id, subject.companyId))
      .limit(1);
    if (co) company = co;
  }

  const subjectPosts = await db
    .select({
      id: posts.id,
      title: posts.title,
      content: posts.content,
      createdAt: posts.createdAt,
    })
    .from(posts)
    .where(
      and(eq(posts.principalId, subjectPrincipalId), isNull(posts.deletedAt)),
    )
    .orderBy(desc(posts.createdAt))
    .limit(500);

  const subjectComments = await db
    .select({
      id: postComments.id,
      postId: postComments.postId,
      content: postComments.content,
      createdAt: postComments.createdAt,
    })
    .from(postComments)
    .where(
      and(
        eq(postComments.principalId, subjectPrincipalId),
        isNull(postComments.deletedAt),
      ),
    )
    .orderBy(desc(postComments.createdAt))
    .limit(1000);

  const subjectVotes = await db
    .select({
      id: postVotes.id,
      postId: postVotes.postId,
      createdAt: postVotes.createdAt,
    })
    .from(postVotes)
    .where(eq(postVotes.principalId, subjectPrincipalId))
    .limit(1000);

  const subjectConversations = await db
    .select({
      id: conversations.id,
      channel: conversations.channel,
      status: conversations.status,
      subject: conversations.subject,
      createdAt: conversations.createdAt,
    })
    .from(conversations)
    .where(eq(conversations.visitorPrincipalId, subjectPrincipalId))
    .orderBy(desc(conversations.createdAt))
    .limit(500);

  const convIds = subjectConversations.map((c) => c.id);
  const convMessages =
    convIds.length > 0
      ? await db
          .select({
            id: conversationMessages.id,
            conversationId: conversationMessages.conversationId,
            senderType: conversationMessages.senderType,
            content: conversationMessages.content,
            attachments: conversationMessages.attachments,
            createdAt: conversationMessages.createdAt,
          })
          .from(conversationMessages)
          .where(
            and(
              inArray(conversationMessages.conversationId, convIds),
              eq(conversationMessages.isInternal, false),
              isNull(conversationMessages.deletedAt),
            ),
          )
          .orderBy(conversationMessages.createdAt)
      : [];

  const msgIds = convMessages.map((m) => m.id);
  const subjectFiles = await db
    .select({
      id: files.id,
      storageKey: files.storageKey,
      name: files.name,
      size: files.size,
      messageId: files.messageId,
    })
    .from(files)
    .where(
      and(
        isNull(files.deletedAt),
        msgIds.length > 0
          ? or(
              eq(files.uploadedById, subjectPrincipalId),
              inArray(files.messageId, msgIds),
            )
          : eq(files.uploadedById, subjectPrincipalId),
      ),
    )
    .limit(200);

  const fileById = new Map(subjectFiles.map((f) => [f.id, f]));
  const attachmentRefs: AttachmentRef[] = [];
  const seenFiles = new Set<string>();
  const archivePathByFileId = new Map<string, string>();

  for (const file of subjectFiles) {
    if (seenFiles.has(file.id)) continue;
    seenFiles.add(file.id);
    const safeBase = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
    const archivePath = `attachments/${file.id}-${safeBase || "file"}`;
    archivePathByFileId.set(file.id, archivePath);
    if (file.size <= MAX_ATTACHMENT_BYTES) {
      attachmentRefs.push({
        fileId: file.id,
        storageKey: file.storageKey,
        name: file.name,
        archivePath,
      });
    }
  }

  const messagesByConv = new Map<
    string,
    SubjectExportPayload["conversations"][number]["messages"]
  >();
  for (const msg of convMessages) {
    if (!msg.conversationId) continue;
    const list = messagesByConv.get(msg.conversationId) ?? [];
    list.push({
      id: msg.id,
      senderType: msg.senderType,
      content: msg.content,
      createdAt: msg.createdAt.toISOString(),
      attachments: (msg.attachments ?? []).map((att) => ({
        fileId: att.fileId ?? null,
        name: att.name,
        contentType: att.contentType,
        size: att.size,
        archivePath:
          att.fileId && fileById.has(att.fileId as typeof files.$inferSelect.id)
            ? (archivePathByFileId.get(att.fileId) ?? null)
            : null,
      })),
    });
    messagesByConv.set(msg.conversationId, list);
  }

  const subjectTickets = await db
    .select({
      id: tickets.id,
      subject: tickets.title,
      priority: tickets.priority,
      createdAt: tickets.createdAt,
    })
    .from(tickets)
    .where(eq(tickets.requesterPrincipalId, subjectPrincipalId))
    .limit(500);

  const subjectSurveys = await db
    .select({
      id: surveyResponses.id,
      surveyId: surveyResponses.surveyId,
      score: surveyResponses.score,
      choice: surveyResponses.choice,
      comment: surveyResponses.comment,
      createdAt: surveyResponses.createdAt,
    })
    .from(surveyResponses)
    .where(eq(surveyResponses.principalId, subjectPrincipalId))
    .limit(500);

  const postSubs = await db
    .select({ postId: postSubscriptions.postId })
    .from(postSubscriptions)
    .where(eq(postSubscriptions.principalId, subjectPrincipalId));
  const ticketSubs = await db
    .select({ ticketId: ticketSubscriptions.ticketId })
    .from(ticketSubscriptions)
    .where(eq(ticketSubscriptions.principalId, subjectPrincipalId));
  const [changelogSub] = await db
    .select({ id: changelogSubscriptions.id })
    .from(changelogSubscriptions)
    .where(
      and(
        eq(changelogSubscriptions.principalId, subjectPrincipalId),
        isNull(changelogSubscriptions.unsubscribedAt),
      ),
    )
    .limit(1);
  const [statusSub] = await db
    .select({ id: statusSubscriptions.id })
    .from(statusSubscriptions)
    .where(eq(statusSubscriptions.principalId, subjectPrincipalId))
    .limit(1);

  const payload: SubjectExportPayload = {
    format: "quills-subject-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    workspace: { id: workspaceId, name: ws.name, slug: ws.slug },
    profile: {
      principalId: subject.id,
      displayName: subject.userName ?? subject.displayName,
      email: subject.email ?? null,
      contactEmail: subject.contactEmail ?? null,
      externalId: subject.externalId ?? null,
      type: subject.type,
      attributes: (() => {
        if (!subject.metadata) return {};
        try {
          return JSON.parse(subject.metadata) as unknown;
        } catch {
          return {};
        }
      })(),
      createdAt: subject.createdAt.toISOString(),
      company,
    },
    posts: subjectPosts.map((p) => ({
      ...p,
      createdAt: p.createdAt.toISOString(),
    })),
    comments: subjectComments.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
    })),
    votes: subjectVotes.map((v) => ({
      ...v,
      createdAt: v.createdAt.toISOString(),
    })),
    conversations: subjectConversations.map((c) => ({
      ...c,
      createdAt: c.createdAt.toISOString(),
      messages: messagesByConv.get(c.id) ?? [],
    })),
    tickets: subjectTickets.map((t) => ({
      ...t,
      createdAt: t.createdAt.toISOString(),
    })),
    surveyResponses: subjectSurveys.map((s) => ({
      id: s.id,
      surveyId: s.surveyId,
      value: { score: s.score, choice: s.choice, comment: s.comment },
      createdAt: s.createdAt.toISOString(),
    })),
    subscriptions: {
      posts: postSubs.map((s) => s.postId),
      tickets: ticketSubs.map((s) => s.ticketId),
      changelog: Boolean(changelogSub),
      statusPage: Boolean(statusSub),
    },
  };

  const summary: PrivacyRequestSummary = {
    conversations: payload.conversations.length,
    messages: convMessages.length,
    files: attachmentRefs.length,
    posts: payload.posts.length,
    comments: payload.comments.length,
    votes: payload.votes.length,
    tickets: payload.tickets.length,
    surveyResponses: payload.surveyResponses.length,
    subscriptions:
      postSubs.length +
      ticketSubs.length +
      (changelogSub ? 1 : 0) +
      (statusSub ? 1 : 0),
  };

  return { payload, attachmentRefs, summary };
}

/**
 * Builds the portable ZIP archive (data.json + streamed attachments) for a subject access request
 * and uploads it through the shared storage lifecycle. Runs inside the `quills.transfer` worker.
 */
export async function runPrivacyAccessJob(
  workspaceId: string,
  job: JobQueueRow,
): Promise<void> {
  const { eventId } = eventPayloadSchema.parse(job.payload);
  const requestId = await withQuillsSystemWorkspace(workspaceId, async (tx) => {
    const event = await loadEvent(tx, eventId);
    if (!event || event.type !== "privacy.access_requested") {
      await finishQuillsJob(tx, job.id, job.leaseToken!);
      return null;
    }
    const id = event.entityId as TypeId<"privacy_request">;
    const [claimed] = await tx
      .update(privacyRequests)
      .set({ status: "running" })
      .where(
        and(
          eq(privacyRequests.id, id),
          eq(privacyRequests.type, "access"),
          eq(privacyRequests.status, "pending"),
        ),
      )
      .returning({
        id: privacyRequests.id,
        subjectPrincipalId: privacyRequests.subjectPrincipalId,
      });
    if (!claimed) {
      await finishQuillsJob(tx, job.id, job.leaseToken!);
      return null;
    }
    return claimed;
  });

  if (!requestId) return;

  if (!isQuillsStorageConfigured()) {
    await withQuillsSystemWorkspace(workspaceId, async (tx) => {
      await tx
        .update(privacyRequests)
        .set({
          status: "failed",
          error: "File storage is not configured",
          completedAt: new Date(),
        })
        .where(eq(privacyRequests.id, requestId.id));
      await finishQuillsJob(tx, job.id, job.leaseToken!);
    });
    return;
  }

  if (!requestId.subjectPrincipalId) {
    await withQuillsSystemWorkspace(workspaceId, async (tx) => {
      await tx
        .update(privacyRequests)
        .set({
          status: "failed",
          error: "Customer no longer exists",
          completedAt: new Date(),
        })
        .where(eq(privacyRequests.id, requestId.id));
      await finishQuillsJob(tx, job.id, job.leaseToken!);
    });
    return;
  }

  try {
    const collected = await withQuillsSystemWorkspace(workspaceId, (tx) =>
      collectSubjectData(tx, workspaceId, requestId.subjectPrincipalId!),
    );
    if (!collected) {
      await withQuillsSystemWorkspace(workspaceId, async (tx) => {
        await tx
          .update(privacyRequests)
          .set({
            status: "failed",
            error: "Customer not found",
            completedAt: new Date(),
          })
          .where(eq(privacyRequests.id, requestId.id));
        await finishQuillsJob(tx, job.id, job.leaseToken!);
      });
      return;
    }

    const entries: ZipEntry[] = [
      {
        name: "data.json",
        data: Buffer.from(JSON.stringify(collected.payload, null, 2), "utf8"),
      },
    ];
    let totalAttachmentBytes = 0;
    let attachmentCount = 0;
    for (const ref of collected.attachmentRefs) {
      if (totalAttachmentBytes >= MAX_TOTAL_ATTACHMENTS_BYTES) break;
      try {
        const bytes = await readObject(ref.storageKey, MAX_ATTACHMENT_BYTES);
        if (
          bytes &&
          totalAttachmentBytes + bytes.length <= MAX_TOTAL_ATTACHMENTS_BYTES
        ) {
          entries.push({ name: ref.archivePath, data: Buffer.from(bytes) });
          totalAttachmentBytes += bytes.length;
          attachmentCount += 1;
        }
      } catch {
        // Missing object in storage must not abort the customer's JSON export.
      }
    }

    const zipBuffer = buildZipArchive(entries);
    const key = exportKey(workspaceId, "zip");
    await putObject(key, zipBuffer, "application/zip");

    const now = new Date();
    const expiresAt = new Date(now.getTime() + EXPORT_TTL_MS);
    const summary: PrivacyRequestSummary = {
      ...collected.summary,
      exportBytes: zipBuffer.length,
      attachmentCount,
    };

    await withQuillsSystemWorkspace(workspaceId, async (tx) => {
      await tx
        .update(privacyRequests)
        .set({
          status: "completed",
          exportS3Key: key,
          exportExpiresAt: expiresAt,
          summary,
          completedAt: now,
        })
        .where(eq(privacyRequests.id, requestId.id));
      await recordQuillsChange(tx, null, {
        type: "privacy.access_completed",
        entityType: "privacy_request",
        entityId: requestId.id,
        payload: {
          status: "completed",
          exportBytes: String(zipBuffer.length),
        },
      });
      await finishQuillsJob(tx, job.id, job.leaseToken!);
    });
  } catch (error) {
    console.error("Quills privacy access export failed", {
      requestId: requestId.id,
      name: (error as Error | null)?.name,
    });
    await withQuillsSystemWorkspace(workspaceId, async (tx) => {
      await tx
        .update(privacyRequests)
        .set({
          status: "failed",
          error: "The subject export failed",
          completedAt: new Date(),
        })
        .where(eq(privacyRequests.id, requestId.id));
      await finishQuillsJob(tx, job.id, job.leaseToken!);
    });
  }
}
