// Synthetic tickets and feedback relations for the local demo, never imported customer data.

export type TicketScript = {
  title: string;
  status: string;
  priority: "none" | "low" | "medium" | "high" | "urgent";
  mine?: boolean;
  messages: string[];
};

export const ticketScripts: TicketScript[] = [
  {
    title: "A content security policy blocks the widget in Safari",
    status: "investigating",
    priority: "high",
    mine: true,
    messages: [
      "The widget script is blocked in Safari.",
      "We can reproduce it and we are testing a fix.",
    ],
  },
  {
    title: "Single sign-on rollout for 300 seats",
    status: "escalated",
    priority: "urgent",
    mine: true,
    messages: ["We need SSO before the company rollout."],
  },
  {
    title: "Change the billing address on invoices",
    status: "new",
    priority: "low",
    messages: ["Please change our billing address."],
  },
  {
    title: "A CSV import with 20,000 rows stops",
    status: "waiting_customer",
    priority: "medium",
    mine: true,
    messages: [
      "The import stops at row 12,000.",
      "Can you send the file? We will look at row 12,000.",
    ],
  },
  {
    title: "Webhook retries for a failing endpoint",
    status: "waiting_third_party",
    priority: "medium",
    messages: ["Our endpoint was down for an hour. Do failed webhooks retry?"],
  },
  {
    title: "Remove the data of a former employee",
    status: "resolved",
    priority: "high",
    mine: true,
    messages: [
      "Please remove all data of a former employee.",
      "We removed the data and sent you a confirmation.",
    ],
  },
  {
    title: "A certificate for a custom domain",
    status: "new",
    priority: "none",
    messages: ["Our custom domain shows a certificate warning."],
  },
  {
    title: "A Kanban view in the portal",
    status: "wont_do",
    priority: "low",
    messages: [
      "Can the portal show requests as a Kanban board?",
      "The roadmap covers this view, so we do not plan a second one.",
    ],
  },
];

/** Pairs of showcase post titles that a duplicate detector would suggest merging. */
export const duplicatePairs: [string, string, "pending" | "dismissed"][] = [
  ["Saved searches", "Saved feedback views", "pending"],
  ["Subscribe to a roadmap column", "Public roadmap subscriptions", "pending"],
  [
    "Support ticket links on feedback",
    "Track requests from support",
    "pending",
  ],
  [
    "Roadmap dates move around daylight saving",
    "Timezone changes the release date",
    "pending",
  ],
  ["Compact roadmap cards", "A more compact feedback list", "dismissed"],
];

export const tagNames = [
  "Integrations",
  "Mobile",
  "Performance",
  "Enterprise",
  "Onboarding",
];
