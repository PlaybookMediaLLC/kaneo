// Route-module helper: framework/boundaries.test.ts checks its imports like a module that uses ../framework/define-route.

const RESERVED = [".test", ".example", ".invalid", ".localhost"];
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;
/**
 * Room for the TXT record name `_quills-verification.<domain>` (DNS allows 253 characters)
 * and for the domain as an outbox entity ID (200 characters).
 */
export const MAX_DOMAIN_LENGTH = 200;

/** Lower-case ASCII (punycode) without a trailing dot, or null when the input is not a public host name. */
export function normalizeDomain(input: string): string | null {
  const trimmed = input.trim().replace(/\.$/, "");
  // URL parsing accepts ports, paths, credentials and IP literals: refuse their characters first.
  if (!trimmed || /[\s/\\?#@:[\]%]/.test(trimmed)) return null;
  let host: string;
  try {
    host = new URL(`http://${trimmed}`).hostname;
  } catch {
    return null;
  }
  const labels = host.split(".");
  if (
    labels.length < 2 ||
    host.length > MAX_DOMAIN_LENGTH ||
    !labels.every((label) => LABEL.test(label)) ||
    // A numeric last label is an IP address.
    !/[a-z]/.test(labels.at(-1)!) ||
    RESERVED.some((suffix) => host === suffix.slice(1) || host.endsWith(suffix))
  )
    return null;
  return host;
}
