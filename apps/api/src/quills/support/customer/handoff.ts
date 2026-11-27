import { buildHandoffSummary } from "@quills/ai/customer-agent";
import { and, desc, eq, sql } from "drizzle-orm";
import { apiRouter, z } from "../../../openapi";
import { assistantInvolvements } from "../../../database/quills/schema/assistant";
import { settings } from "../../../database/quills/schema/auth";
import {
  conversationMessages,
  conversations,
} from "../../../database/quills/schema/conversation";
import { defineQuillsRoute } from "../../framework/define-route";
import { type Customer, title } from "../../portal/feedback/viewer";
import {
  conversationParams,
  preview,
  systemNotice,
} from "../conversation-model";
import {
  customerMessageSchema,
  ownConversation,
  requireSurface,
  selectCustomerMessages,
  toMessages,
} from "./model";

const HANDOFF_CONFIRMATION = "I've connected you with our team.";

/**
 * Deterministic customer-triggered handoff routes (`POST /widget/conversations/{id}/handoff`
 * and `POST /support/conversations/{id}/handoff`, #299).
 * Immediately ends any active AI involvement, posts a structured private handoff summary note
 * for teammates, marks waitingSince, and sends a confirmation reply — zero LLM call!
 */
export const handoffRoutes = (audience: Customer) => {
  const prefix = audience === "portal" ? "support" : "widget";
  return apiRouter().openapi(
    ...defineQuillsRoute({
      audience,
      method: "post",
      path: `/${prefix}/conversations/{conversationId}/handoff`,
      operationId: `handoffQuills${title(audience)}Conversation`,
      summary: "Immediately hand off this conversation to a human teammate",
      description:
        "Deterministic handoff with zero LLM call. Ends any active AI involvement, adds a structured internal handoff summary note, and confirms connection to a teammate.",
      action: "update",
      rateLimit: { limit: 20, windowSeconds: 900, per: "caller" },
      params: conversationParams,
      response: z.object({
        handedOff: z.literal(true),
        message: customerMessageSchema,
      }),
      responseDescription: "Confirmation message after deterministic handoff",
      errors: { 404: "Conversation not found" },
      event: ({ params }) => ({
        type: "conversation.handed_off",
        entityType: "conversation",
        entityId: params.conversationId,
        payload: { reason: "customer_requested" },
      }),
      handler: async ({ db, caller, params }) => {
        await requireSurface(db, audience, caller, "messenger");
        const me = caller.principalId;
        const conversation = await ownConversation(
          db,
          me,
          params.conversationId,
          true,
        );
        const now = new Date();

        // End any active assistant involvement so the AI agent never interrupts again.
        await db
          .update(assistantInvolvements)
          .set({
            status: "handed_off",
            handoffReason: "explicit_request",
            endedAt: now,
          })
          .where(
            and(
              eq(assistantInvolvements.conversationId, conversation.id),
              eq(assistantInvolvements.status, "active"),
            ),
          );

        const [lastVisitorMsg] = await db
          .select({ content: conversationMessages.content })
          .from(conversationMessages)
          .where(
            and(
              eq(conversationMessages.conversationId, conversation.id),
              eq(conversationMessages.senderType, "visitor"),
            ),
          )
          .orderBy(desc(conversationMessages.createdAt))
          .limit(1);

        const [ws] = await db
          .select({ config: settings.assistantConfig })
          .from(settings)
          .limit(1);
        const agentName =
          (ws?.config as { identity?: { name?: string } } | null)?.identity
            ?.name || "Quinn";

        const { note } = buildHandoffSummary({
          agentName,
          customerQuestion:
            lastVisitorMsg?.content ||
            conversation.subject ||
            "Customer requested human assistance",
          reason: "customer_requested",
          confidence: null,
          attemptedSteps: [
            "Customer clicked Talk to a person (deterministic handoff)",
          ],
          sourcesConsulted: [],
        });

        await systemNotice(db, conversation.id, note, {
          internal: true,
          event: { kind: "assistant_handoff" },
        });

        const [reply] = await db
          .insert(conversationMessages)
          .values({
            conversationId: conversation.id,
            principalId: null,
            senderType: "agent",
            content: HANDOFF_CONFIRMATION,
            metadata: { assistantReply: true },
          })
          .returning({
            id: conversationMessages.id,
            createdAt: conversationMessages.createdAt,
          });

        await db
          .update(conversations)
          .set({
            status: "open",
            waitingSince: sql`coalesce(${conversations.waitingSince}, now())`,
            lastMessageAt: reply!.createdAt,
            lastMessagePreview: preview(HANDOFF_CONFIRMATION),
            updatedAt: reply!.createdAt,
          })
          .where(eq(conversations.id, conversation.id));

        const rows = await selectCustomerMessages(
          db,
          me!,
          eq(conversationMessages.id, reply!.id),
        );
        return {
          handedOff: true as const,
          message: toMessages(rows)[0]!,
        };
      },
    }),
  );
};
