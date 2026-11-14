import { EmailIntro } from "../../components/email-intro";
import { EmailButton } from "../../components/email-button";
import React from "react";
void React;
import { Link, Section, Text } from "@react-email/components";
import { EmailLayout, NotificationFooter } from "./email-layout";
import { typography, utils } from "./shared-styles";

export interface WeeklyDigestItem {
  title: string;
  /** The status name now. */
  status: string;
  url: string;
}

interface WeeklyDigestEmailProps {
  /** Posts that this person created, voted for or follows and whose status changed last week. */
  items: readonly WeeklyDigestItem[];
  myFeedbackUrl: string;
  organizationName: string;
  unsubscribeUrl: string;
  logoUrl?: string;
}

/** The weekly summary of status changes on a person's feedback (RFC 0003, feature 16, D15). */
export function WeeklyDigestEmail({
  items,
  myFeedbackUrl,
  organizationName,
  unsubscribeUrl,
  logoUrl,
}: WeeklyDigestEmailProps) {
  return (
    <EmailLayout
      footer={
        <NotificationFooter
          reason="You received this email because you created, voted for or follow this feedback."
          unsubscribeUrl={unsubscribeUrl}
        />
      }
      preview={`Your feedback at ${organizationName} this week`}
      logoUrl={logoUrl}
      logoAlt={organizationName}
    >
      <EmailIntro title="Your feedback this week" />
      <Text className="k-text-85" style={typography.text}>
        The status of this feedback at {organizationName} changed last week.
      </Text>
      {items.map((item) => (
        <Text
          key={item.url}
          className="k-text-85"
          style={{ ...typography.text, marginTop: "0" }}
        >
          <Link href={item.url} className="k-link" style={utils.link}>
            {item.title}
          </Link>
          {" → "}
          <strong>{item.status}</strong>
        </Text>
      ))}
      <Section
        style={{ textAlign: "start", marginTop: "32px", marginBottom: "32px" }}
      >
        <EmailButton href={myFeedbackUrl}>View My Feedback</EmailButton>
      </Section>
    </EmailLayout>
  );
}
