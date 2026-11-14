import { createElement, type ComponentProps } from "react";
import { ShippedEmail } from "../../src/quills/templates/shipped";

export default function Preview(props: ComponentProps<typeof ShippedEmail>) {
  return createElement(ShippedEmail, props);
}

Preview.PreviewProps = {
  organizationName: "Acme",
  unsubscribeUrl: "https://app.quills.io/settings/notifications/unsubscribe",
  preferencesUrl: "https://app.quills.io/settings/notifications",
  entryTitle: "Calendar subscriptions are here",
  entryUrl: "https://app.quills.io/changelog/calendar-subscriptions",
  requestTitle: "Add calendar subscriptions",
} satisfies ComponentProps<typeof ShippedEmail>;
