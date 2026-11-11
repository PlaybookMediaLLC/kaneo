import { Resolver } from "node:dns/promises";
import { and, eq } from "drizzle-orm";
import { withQuillsSystemWorkspace } from "../../../database/quills/client";
import {
  customDomains,
  verificationRecordName,
} from "../../../database/quills/schema/custom-domains";
import type { JobQueueRow } from "../../../database/quills/schema/job-queue";
import { recordQuillsChange } from "../../events";
import { loadEvent } from "../fanout";
import { eventPayloadSchema, finishQuillsJob } from "../queue";

type Outcome = "verified" | "missing" | "unanswered";

/** A missing name or record is an answer. A timeout or server failure says nothing about the domain. */
const ANSWERED = new Set(["ENOTFOUND", "ENODATA"]);

/** Looks up the TXT record that proves control of `domain`, for at most five seconds. */
export async function checkVerificationRecord(
  domain: string,
  value: string,
): Promise<Outcome> {
  const resolver = new Resolver({ timeout: 2000, tries: 2 });
  const timer = setTimeout(() => resolver.cancel(), 5000);
  try {
    const records = await resolver.resolveTxt(verificationRecordName(domain));
    return records.some((chunks) => chunks.join("") === value)
      ? "verified"
      : "missing";
  } catch (error) {
    return ANSWERED.has((error as NodeJS.ErrnoException).code ?? "")
      ? "missing"
      : "unanswered";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Checks the domain that the request named, only while this workspace still stores it.
 * A rerun repeats the same lookup and write, so a retry is safe.
 */
export async function runDomainCheckJob(workspaceId: string, job: JobQueueRow) {
  const { eventId } = eventPayloadSchema.parse(job.payload);
  const target = await withQuillsSystemWorkspace(workspaceId, async (db) => {
    const event = await loadEvent(db, eventId);
    const kind = (event?.payload as { kind?: unknown } | undefined)?.kind;
    if (
      event?.type !== "custom_domain.verification_requested" ||
      (kind !== "portal" && kind !== "help_center")
    )
      return undefined;
    const [row] = await db
      .select({
        kind: customDomains.kind,
        domain: customDomains.domain,
        verificationValue: customDomains.verificationValue,
      })
      .from(customDomains)
      .where(
        and(
          eq(customDomains.kind, kind),
          eq(customDomains.domain, event.entityId),
        ),
      );
    return row;
  });
  // Outside a transaction, so a slow nameserver never holds a connection or a row lock.
  const outcome =
    target &&
    (await checkVerificationRecord(target.domain, target.verificationValue));
  await withQuillsSystemWorkspace(workspaceId, async (db) => {
    if (target && outcome) {
      // The same claim only: a domain set again since the read has a new value and stays inactive.
      const [changed] = await db
        .update(customDomains)
        .set({
          checkedAt: new Date(),
          checkResult: outcome,
          // Only an answer takes a verification away.
          ...(outcome !== "unanswered" && {
            verifiedAt: outcome === "verified" ? new Date() : null,
          }),
        })
        .where(
          and(
            eq(customDomains.kind, target.kind),
            eq(customDomains.domain, target.domain),
            eq(customDomains.verificationValue, target.verificationValue),
          ),
        )
        .returning({ domain: customDomains.domain });
      if (changed)
        await recordQuillsChange(db, null, {
          type: "custom_domain.checked",
          entityType: "custom_domain",
          entityId: changed.domain,
          payload: { kind: target.kind, outcome },
        });
    }
    await finishQuillsJob(db, job.id, job.leaseToken!);
  });
}
