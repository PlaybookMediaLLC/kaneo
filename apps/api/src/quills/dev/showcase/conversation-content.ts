// Synthetic support and teammate data for the local demo, never imported customer data.

type Signal = {
  title: string;
  status: "pending" | "accepted" | "dismissed";
  /** The title of the showcase post that the request matches. */
  match?: string;
};

export type ConversationScript = {
  subject: string;
  status: "open" | "snoozed" | "closed";
  /** Assigned to the demo teammate. Otherwise unassigned. */
  mine?: boolean;
  priority?: "none" | "low" | "medium" | "high" | "urgent";
  channel?: "messenger" | "email";
  endReason?: "resolved" | "tracked_as_feedback";
  csat?: number;
  /** The first message asks for a feature: a job would extract this signal from it. */
  signal?: Signal;
  /** The visitor writes first, then the turns alternate. */
  messages: string[];
};

export const conversationScripts: ConversationScript[] = [
  {
    subject: "Export feedback with comments",
    status: "open",
    priority: "medium",
    signal: {
      title: "Export comments with feedback",
      status: "pending",
      match: "Export comments with feedback",
    },
    messages: [
      "Can I export feedback together with all of its comments? We review requests in a spreadsheet every month.",
    ],
  },
  {
    subject: "Linear sync for our team",
    status: "open",
    mine: true,
    priority: "high",
    signal: {
      title: "Linear integration",
      status: "accepted",
      match: "Linear integration",
    },
    messages: [
      "We moved to Linear last quarter. A request should create a Linear issue and keep its status in sync.",
      "Thanks for the details. I added your vote to the Linear integration request, so you get its updates.",
      "Great, thank you!",
    ],
  },
  {
    subject: "Billing address on invoices",
    status: "open",
    priority: "low",
    messages: ["Hello, how do I change the billing address on our invoices?"],
  },
  {
    subject: "Single sign-on for the whole company",
    status: "open",
    mine: true,
    priority: "urgent",
    signal: {
      title: "Single sign-on",
      status: "pending",
      match: "Single sign-on",
    },
    messages: [
      "Our security team requires single sign-on before we roll out to 300 people. Is SSO on the roadmap?",
      "It is planned. I am checking the date with the team and I will reply here today.",
      "Thanks. Our rollout meeting is on Friday.",
    ],
  },
  {
    subject: "The widget does not open in Safari",
    status: "open",
    priority: "high",
    messages: [
      "The feedback widget does not open in Safari. Chrome works.",
      "Thanks for the report. Can you send the output of the browser console?",
      "It says that a content security policy blocked the script.",
    ],
  },
  {
    subject: "A dark theme for the portal",
    status: "snoozed",
    mine: true,
    signal: { title: "Dark theme for the public portal", status: "pending" },
    messages: [
      "Is a dark theme for the public portal planned? Our documentation site is dark.",
      "Not yet. I will ask the product team next week and come back to you.",
    ],
  },
  {
    subject: "Trial extension",
    status: "snoozed",
    mine: true,
    priority: "medium",
    messages: [
      "Can we get one more week of the trial? Our approver is on vacation.",
      "Of course. I extended the trial by seven days. I will check in next week.",
    ],
  },
  {
    subject: "Password reset email",
    status: "closed",
    endReason: "resolved",
    csat: 5,
    messages: [
      "I did not get the password reset email.",
      "The spam filter of your domain held it. I sent it again.",
      "Got it, thanks!",
    ],
  },
  {
    subject: "Embed the roadmap in Notion",
    status: "closed",
    mine: true,
    endReason: "tracked_as_feedback",
    signal: { title: "Embed the roadmap in Notion", status: "dismissed" },
    messages: [
      "Can we embed the public roadmap in a Notion page?",
      "Not today. I recorded the request, so you hear from us when it ships.",
    ],
  },
  {
    subject: "Votes after a merge",
    status: "closed",
    mine: true,
    endReason: "resolved",
    csat: 4,
    messages: [
      "We merged two requests. Do the votes move to the remaining request?",
      "Yes. The votes move, and each customer counts only once.",
    ],
  },
  {
    subject: "Rate limits of the public API",
    status: "open",
    channel: "email",
    messages: [
      "What are the rate limits of the public API? We plan a nightly sync.",
    ],
  },
  {
    subject: "Help articles in German",
    status: "open",
    mine: true,
    priority: "low",
    signal: {
      title: "Multilingual help articles",
      status: "pending",
      match: "Multilingual help articles",
    },
    messages: [
      "Most of our customers are in Germany. Can the help center show articles in German?",
    ],
  },
];
