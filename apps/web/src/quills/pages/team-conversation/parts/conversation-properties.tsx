import { useTranslation } from "react-i18next";
import type { GetConversationResponse } from "../../../api/team/get-conversation";
import { ConversationSection } from "./conversation-section";
import { CustomerIdentity } from "./customer-identity";
import { CustomerSection } from "./customer-section";
import { type EmailAuth, EmailSecuritySection } from "./email-security-section";
import { ForwardParseWarning } from "./forward-parse-warning";
import { LinksSection } from "./links-section";
import { PreviousConversations } from "./previous-conversations";
import { SummarySection } from "./summary-section";

export interface ConversationPropertiesProps {
  workspaceId: string;
  conversation: GetConversationResponse & { forwardParseFailed?: boolean };
  /** The checks of the newest inbound mail that has them. */
  emailSecurity?: { auth: EmailAuth; receivedAt: string } | null;
}

/**
 * The right panel (design section 2): who the customer is, the email security checks of an
 * email conversation, then the conversation's properties, its AI summary, its links, the
 * customer's details and their other conversations. The header holds the status and the
 * assignee.
 */
export function ConversationProperties({
  workspaceId,
  conversation,
  emailSecurity,
}: ConversationPropertiesProps) {
  const { t } = useTranslation("quills");
  const customerName =
    conversation.visitorName ??
    conversation.visitorEmail ??
    t("team-conversations.unknown");
  return (
    <div className="grid gap-3">
      {conversation.forwardParseFailed ? (
        <ForwardParseWarning
          workspaceId={workspaceId}
          conversationId={conversation.id}
        />
      ) : null}
      <CustomerIdentity
        workspaceId={workspaceId}
        principalId={conversation.visitorPrincipalId}
        name={conversation.visitorName}
        avatarUrl={conversation.visitorAvatarUrl}
        email={conversation.visitorEmail}
      />
      {emailSecurity ? <EmailSecuritySection {...emailSecurity} /> : null}
      <ConversationSection
        workspaceId={workspaceId}
        conversation={conversation}
      />
      <SummarySection
        workspaceId={workspaceId}
        conversationId={conversation.id}
        summary={conversation.summary}
        summaryUpdatedAt={conversation.summaryUpdatedAt}
      />
      <LinksSection
        workspaceId={workspaceId}
        conversationId={conversation.id}
        visitorPrincipalId={conversation.visitorPrincipalId}
        customerName={customerName}
        subject={conversation.subject}
      />
      <CustomerSection
        workspaceId={workspaceId}
        principalId={conversation.visitorPrincipalId}
      />
      <PreviousConversations
        workspaceId={workspaceId}
        conversationId={conversation.id}
        visitorPrincipalId={conversation.visitorPrincipalId}
      />
    </div>
  );
}
