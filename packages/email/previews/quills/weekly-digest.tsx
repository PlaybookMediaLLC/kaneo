import { createElement, type ComponentProps } from "react";
import { WeeklyDigestEmail } from "../../src/quills/templates/weekly-digest";

export default function Preview(
  props: ComponentProps<typeof WeeklyDigestEmail>,
) {
  return createElement(WeeklyDigestEmail, props);
}

Preview.PreviewProps = {
  organizationName: "Acme",
  unsubscribeUrl: "https://app.quills.io/settings/notifications/unsubscribe",
  myFeedbackUrl: "https://app.quills.io/my-feedback",
  items: [
    {
      title: "Add calendar subscriptions",
      status: "Planned",
      url: "https://app.quills.io/feedback/calendar-subscriptions",
    },
    {
      title: "Dark mode",
      status: "Complete",
      url: "https://app.quills.io/feedback/dark-mode",
    },
  ],
} satisfies ComponentProps<typeof WeeklyDigestEmail>;
