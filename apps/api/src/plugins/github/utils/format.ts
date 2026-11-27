export const CUSTOMER_CONTEXT_START = "<!-- kaneo:customer-context:start -->";
export const CUSTOMER_CONTEXT_END = "<!-- kaneo:customer-context:end -->";

export type PiiSafeCustomerContext = {
  totalVotes: number;
  uniqueCompanies: number;
  companyNames: string[];
  linkedPostTitles: string[];
};

function sanitizeContextToken(raw: string): string {
  return raw
    .replace(/[<>[\]()!@#]/g, "")
    .replace(/[\r\n]+/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/**
 * Formats a PII-redacted customer context block for GitHub issue bodies (#305).
 * Never includes customer emails, personal names, or revenue numbers.
 */
export function formatCustomerContextBlock(
  context: PiiSafeCustomerContext,
): string {
  const lines = [CUSTOMER_CONTEXT_START, "### Customer Context"];
  lines.push(
    `- **Votes:** ${context.totalVotes} | **Companies:** ${context.uniqueCompanies}`,
  );
  const safeCompanies = context.companyNames
    .map(sanitizeContextToken)
    .filter(Boolean);
  if (safeCompanies.length) {
    const shown = safeCompanies.slice(0, 10).join(", ");
    const extra =
      safeCompanies.length > 10 ? ` (+${safeCompanies.length - 10} more)` : "";
    lines.push(`- **Requesting companies:** ${shown}${extra}`);
  }
  const safeTitles = context.linkedPostTitles
    .map(sanitizeContextToken)
    .filter(Boolean);
  if (safeTitles.length) {
    lines.push(`- **Linked requests:** ${safeTitles.slice(0, 5).join("; ")}`);
  }
  lines.push(CUSTOMER_CONTEXT_END);
  return lines.join("\n");
}

/** Strips any kaneo customer-context marked block to prevent inbound GitHub echo loops (#305). */
export function stripCustomerContextBlock(text: string): string {
  if (
    !text.includes(CUSTOMER_CONTEXT_START) ||
    !text.includes(CUSTOMER_CONTEXT_END)
  ) {
    return text;
  }
  const normalized = text.replace(/\r\n/g, "\n");
  const blockWithSep = new RegExp(
    `(?:\\n\\n)?${CUSTOMER_CONTEXT_START}[\\s\\S]*?${CUSTOMER_CONTEXT_END}(?:\\n\\n)?`,
    "g",
  );
  return normalized.replace(
    blockWithSep,
    (match, offset: number, str: string) =>
      offset > 0 && offset + match.length < str.length ? "\n\n" : "",
  );
}

export function formatIssueTitle(taskTitle: string): string {
  return taskTitle;
}

export function formatIssueBody(
  taskDescription: string | null,
  taskId: string,
  customerContext?: PiiSafeCustomerContext | null,
): string {
  const description = stripCustomerContextBlock(taskDescription || "");
  const hasContext =
    customerContext &&
    (customerContext.totalVotes > 0 ||
      customerContext.linkedPostTitles.length > 0);
  const contextBlock = hasContext
    ? formatCustomerContextBlock(customerContext)
    : "";

  const mainBody = contextBlock
    ? [description.trim() ? description : "", contextBlock]
        .filter(Boolean)
        .join("\n\n")
    : description;

  if (!mainBody.trim()) {
    return `<sub>Task: ${taskId}</sub>`;
  }

  return `${mainBody}

---
<sub>Task: ${taskId}</sub>`;
}

export function formatSyncComment(taskId: string): string {
  return `Task: ${taskId}`;
}

export function getLabelsForIssue(
  priority: string | null,
  status: string,
): string[] {
  const labels: string[] = [];

  if (priority && priority !== "no-priority") {
    labels.push(`priority:${priority}`);
  }

  labels.push(`status:${status}`);

  return labels;
}

export function formatTaskDescriptionFromIssue(
  issueBody: string | null,
  taskId?: string,
): string {
  const rawBody = issueBody || "";
  // Only normalize CRLF when markers or task footer are present so unrelated descriptions keep exact whitespace.
  let body = rawBody;
  if (taskId) {
    const footer = `<sub>Task: ${taskId}</sub>`;
    if (body === footer) return "";
    const crlfAware = body.replace(/\r\n/g, "\n");
    const suffix = `\n\n---\n${footer}`;
    if (crlfAware.endsWith(suffix)) {
      body = crlfAware.slice(0, -suffix.length);
    }
  }
  if (
    body.includes(CUSTOMER_CONTEXT_START) &&
    body.includes(CUSTOMER_CONTEXT_END)
  ) {
    return stripCustomerContextBlock(body);
  }
  return body;
}
