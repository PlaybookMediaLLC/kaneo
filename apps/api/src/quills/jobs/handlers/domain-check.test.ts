import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vite-plus/test";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { customDomains } from "../../../database/quills/schema/custom-domains";
import { events } from "../../../database/quills/schema/events";
import { jobQueue } from "../../../database/quills/schema/job-queue";
import * as kaneo from "../../../database/schema";
import { fanOut } from "../fanout";
import { claimQuillsJob } from "../queue";
import { checkVerificationRecord, runDomainCheckJob } from "./domain-check";
import { harness } from "./harness.fixture";

let pool: Pool;
vi.mock("../../../database/index", () => ({
  getDatabasePool: () => pool,
  get schema() {
    return kaneo;
  },
  default: new Proxy(
    {},
    {
      get(_target, property) {
        const db = drizzle(pool, { schema: kaneo });
        const value = Reflect.get(db, property);
        return typeof value === "function" ? value.bind(db) : value;
      },
    },
  ),
}));
vi.mock("../../../ws", () => ({
  broadcastToUserAndWait: vi.fn(async () => {}),
}));
// The DNS edge only: the handler's own lookup, timeout and outcome mapping run for real.
const dns = vi.hoisted(() => ({
  resolveTxt: vi.fn<(name: string) => Promise<string[][]>>(),
  cancel: vi.fn(),
  options: [] as unknown[],
}));
vi.mock("node:dns/promises", () => ({
  Resolver: class {
    constructor(options: unknown) {
      dns.options.push(options);
    }
    resolveTxt = dns.resolveTxt;
    cancel = dns.cancel;
  },
}));

const url = process.env.QUILLS_TEST_DATABASE_URL;
const h = harness("domaincheck");
const failure = (code: string) =>
  Object.assign(new Error(code), { code }) as NodeJS.ErrnoException;
const name = (label: string) =>
  `${label}-${h.a.replaceAll("_", "-")}.example.com`;

async function store(
  workspaceId: string,
  domain: string,
  verifiedAt: Date | null = null,
) {
  await h.system(workspaceId, (db) =>
    db
      .insert(customDomains)
      .values({
        kind: "portal",
        domain,
        verificationValue: "proof",
        verifiedAt,
      })
      .onConflictDoUpdate({
        target: [customDomains.workspaceId, customDomains.kind],
        set: {
          domain,
          verificationValue: "proof",
          verifiedAt,
          checkResult: null,
        },
      }),
  );
}
const request = (domain: string) =>
  h.emit(h.a, {
    type: "custom_domain.verification_requested",
    entityType: "custom_domain",
    entityId: domain,
    payload: { kind: "portal" },
  });
const row = async (workspaceId = h.a) =>
  (await h.system(workspaceId, (db) => db.select().from(customDomains)))[0];
const checked = (domain: string) =>
  h.system(h.a, (db) =>
    db
      .select({ payload: events.payload })
      .from(events)
      .where(
        and(
          eq(events.type, "custom_domain.checked"),
          eq(events.entityId, domain),
        ),
      ),
  );

describe("checkVerificationRecord", () => {
  beforeEach(() => {
    dns.resolveTxt.mockReset();
    dns.cancel.mockReset();
  });
  it("gives up after five seconds and counts that as no answer", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      let reject: (error: Error) => void = () => {};
      dns.resolveTxt.mockImplementation(
        () => new Promise((_resolve, fail) => (reject = fail)),
      );
      dns.cancel.mockImplementation(() => reject(failure("ECANCELLED")));
      const outcome = checkVerificationRecord("slow.example.com", "proof");
      await vi.advanceTimersByTimeAsync(5000);
      expect(await outcome).toBe("unanswered");
      expect(dns.cancel).toHaveBeenCalledOnce();
      expect(dns.options.at(-1)).toEqual({ timeout: 2000, tries: 2 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe.skipIf(!url)("Quills custom domain check job", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 });
    await h.start(pool, url!);
  }, 120000);
  afterAll(async () => {
    await h.stop();
    await pool?.end();
  });
  beforeEach(() => {
    dns.resolveTxt.mockReset();
  });

  it("activates a domain whose TXT record holds its value", async () => {
    const domain = name("found");
    await store(h.a, domain);
    // TXT strings longer than 255 bytes arrive in chunks.
    dns.resolveTxt.mockResolvedValue([["other"], ["pro", "of"]]);
    await request(domain);
    await h.drain(h.a);
    expect(dns.resolveTxt).toHaveBeenCalledWith(
      `_kaneo-verification.${domain}`,
    );
    expect(await row()).toMatchObject({
      domain,
      checkResult: "verified",
      verifiedAt: expect.any(Date),
    });
    expect(await checked(domain)).toEqual([
      { payload: { kind: "portal", outcome: "verified" } },
    ]);
  });

  it("deactivates on an answer without the value, and keeps the state when nobody answers", async () => {
    const domain = name("answers");
    await store(h.a, domain, new Date());
    dns.resolveTxt.mockRejectedValue(failure("ETIMEOUT"));
    await request(domain);
    await h.drain(h.a);
    expect(await row()).toMatchObject({
      checkResult: "unanswered",
      verifiedAt: expect.any(Date),
    });

    dns.resolveTxt.mockRejectedValue(failure("ENOTFOUND"));
    await request(domain);
    await h.drain(h.a);
    expect(await row()).toMatchObject({
      checkResult: "missing",
      verifiedAt: null,
    });
  });

  it("never looks up a domain this workspace does not store, and never activates a newer claim", async () => {
    // Workspace B's domain, named by an event in A.
    const foreign = name("foreign").replace("-a.", "-b.");
    await store(h.b, foreign);
    await request(foreign);
    await h.drain(h.a);
    expect(dns.resolveTxt).not.toHaveBeenCalled();
    expect(await row(h.b)).toMatchObject({ checkResult: null });

    // The domain is set again while the lookup runs: the new value stays inactive.
    const domain = name("moved");
    await store(h.a, domain);
    dns.resolveTxt.mockImplementation(async () => {
      await pool.query(
        "UPDATE quills.custom_domains SET verification_value='newer' WHERE workspace_id=$1 AND kind='portal'",
        [h.a],
      );
      return [["proof"]];
    });
    await request(domain);
    await h.drain(h.a);
    expect(await row()).toMatchObject({
      verificationValue: "newer",
      verifiedAt: null,
      checkResult: null,
    });
    expect(await checked(domain)).toEqual([]);
  });

  it("writes nothing after a lost lease, and the retry finishes the check once", async () => {
    const domain = name("lease");
    await store(h.a, domain);
    dns.resolveTxt.mockResolvedValue([["proof"]]);
    const eventId = await request(domain);
    await fanOut(h.a, eventId);
    await fanOut(h.a, eventId);
    const job = await h.system(h.a, async (db) => {
      expect(
        await db
          .select({ id: jobQueue.id })
          .from(jobQueue)
          .where(
            and(
              eq(jobQueue.queue, "quills.domain_check"),
              eq(jobQueue.dedupeKey, eventId),
            ),
          ),
      ).toHaveLength(1);
      await db
        .update(jobQueue)
        .set({ runAt: sql`now() + interval '1 hour'` })
        .where(
          and(
            eq(jobQueue.status, "pending"),
            sql`${jobQueue.queue} <> 'quills.domain_check'`,
          ),
        );
      return claimQuillsJob(db);
    });
    expect(job?.queue).toBe("quills.domain_check");
    await h.system(h.a, (db) =>
      db
        .update(jobQueue)
        .set({ lockedUntil: sql`now() - interval '1 second'` })
        .where(eq(jobQueue.id, job!.id)),
    );
    await expect(runDomainCheckJob(h.a, job!)).rejects.toThrow(
      "Quills job lease lost",
    );
    expect(await row()).toMatchObject({ verifiedAt: null, checkResult: null });

    await h.due(h.a);
    await h.drain(h.a);
    expect(await row()).toMatchObject({ checkResult: "verified" });
    expect(await checked(domain)).toHaveLength(1);
  });
});
