import { quillsClient as client } from "@kaneo/libs";
import { HttpError } from "@/lib/http-error";

export type RetentionChannel =
  | "all"
  | "messenger"
  | "email"
  | "widget"
  | "ticket";
export type RetentionAction = "delete" | "anonymize";

export async function listRetentionPolicies(workspaceId: string) {
  const res = await client.quills[":workspaceId"].privacy[
    "retention-policies"
  ].$get({
    param: { workspaceId },
  });
  if (!res.ok) throw await HttpError.fromResponse(res);
  return res.json();
}

export async function upsertRetentionPolicy(
  workspaceId: string,
  json: {
    channel: RetentionChannel;
    action: RetentionAction;
    closedAfterDays: number | null;
    spamAfterDays: number | null;
    softDeletedAfterDays: number | null;
    aiLogsAfterDays: number | null;
  },
) {
  const res = await client.quills[":workspaceId"].privacy[
    "retention-policies"
  ].$put({
    param: { workspaceId },
    json,
  });
  if (!res.ok) throw await HttpError.fromResponse(res);
  return res.json();
}

export async function deleteRetentionPolicy(
  workspaceId: string,
  policyId: string,
) {
  const res = await client.quills[":workspaceId"].privacy["retention-policies"][
    ":policyId"
  ].$delete({
    param: { workspaceId, policyId },
  });
  if (!res.ok) throw await HttpError.fromResponse(res);
  return res.json();
}

export async function listPrivacyRequests(
  workspaceId: string,
  type?: "erasure" | "access",
) {
  const res = await client.quills[":workspaceId"].privacy.requests.$get({
    param: { workspaceId },
    query: { ...(type ? { type } : {}), limit: "30" },
  });
  if (!res.ok) throw await HttpError.fromResponse(res);
  return res.json();
}

export async function eraseCustomerData(
  workspaceId: string,
  principalId: string,
  mode: RetentionAction = "anonymize",
) {
  const res = await client.quills[":workspaceId"].privacy.erasure.$post({
    param: { workspaceId },
    json: { principalId, mode },
  });
  if (!res.ok) throw await HttpError.fromResponse(res);
  return res.json();
}

export async function createPrivacyAccessRequest(
  workspaceId: string,
  principalId: string,
) {
  const res = await client.quills[":workspaceId"].privacy[
    "access-requests"
  ].$post({
    param: { workspaceId },
    json: { principalId },
  });
  if (!res.ok) throw await HttpError.fromResponse(res);
  return res.json();
}

export async function downloadPrivacyAccessRequest(
  workspaceId: string,
  requestId: string,
) {
  const res = await client.quills[":workspaceId"].privacy.requests[
    ":requestId"
  ].download.$get({
    param: { workspaceId, requestId },
  });
  if (!res.ok) throw await HttpError.fromResponse(res);
  return res.json();
}

export async function redactConversationMessage(
  workspaceId: string,
  conversationId: string,
  messageId: string,
  json: {
    mode: "text" | "attachments" | "both";
    reason: string;
    replacement?: string;
  },
) {
  const res = await client.quills[":workspaceId"].conversations[
    ":conversationId"
  ].messages[":messageId"].redact.$post({
    param: { workspaceId, conversationId, messageId },
    json,
  });
  if (!res.ok) throw await HttpError.fromResponse(res);
  return res.json();
}
