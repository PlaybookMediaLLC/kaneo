import { EmailIntro } from "../../components/email-intro";
import { Frame } from "../../components/frame";
import { Spacer } from "../../components/spacer";
import { EmailButton } from "../../components/email-button";
import React from "react";
void React;
import { Section, Text } from "@react-email/components";
import { EmailLayout, NotificationFooter } from "./email-layout";
import { typography } from "./shared-styles";

interface ShippedEmailProps {
  /** The published changelog entry. */
  entryTitle: string;
  entryUrl: string;
  /** The linked request that this person voted for or follows. */
  requestTitle: string;
  organizationName: string;
  unsubscribeUrl: string;
  preferencesUrl?: string;
  logoUrl?: string;
}

/** Tells a voter or follower that a request they asked for shipped (RFC 0003, feature 13). */
export function ShippedEmail({
  entryTitle,
  entryUrl,
  requestTitle,
  organizationName,
  unsubscribeUrl,
  preferencesUrl,
  logoUrl,
}: ShippedEmailProps) {
  return (
    <EmailLayout
      footer={
        <NotificationFooter
          reason="You received this email because you voted for or follow this request."
          unsubscribeUrl={unsubscribeUrl}
          preferencesUrl={preferencesUrl}
        />
      }
      preview={`Shipped: ${requestTitle}`}
      logoUrl={logoUrl}
      logoAlt={organizationName}
    >
      <EmailIntro title="Your request shipped" />
      <Text className="k-text-85" style={typography.text}>
        {organizationName} shipped something that you asked for.
      </Text>
      <Frame title="Your request">
        <Text
          className="k-text-85"
          style={{
            ...typography.text,
            marginTop: "0",
            marginBottom: "0",
            fontWeight: "600",
          }}
        >
          {requestTitle}
        </Text>
      </Frame>
      <Spacer size={20} />
      <Text className="k-text-85" style={typography.text}>
        Read the update: {entryTitle}
      </Text>
      <Section
        style={{ textAlign: "start", marginTop: "32px", marginBottom: "32px" }}
      >
        <EmailButton href={entryUrl}>View Update</EmailButton>
      </Section>
    </EmailLayout>
  );
}
