import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";
import { toUuid, type TypeId } from "@kaneo/ids";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { principal, settings } from "../../database/quills/schema/auth";
import { segments, userSegments } from "../../database/quills/schema/segments";
import { surveyResponses } from "../../database/quills/schema/surveys";
import * as kaneo from "../../database/schema";
import { apiRouter, type BaseVariables } from "../../openapi";
import {
  contractApp,
  contractEnv,
  contractSession,
  startContract,
  stopContract,
} from "../framework/contract";
import { role, users } from "../framework/contract-world";
import {
  buildQuillsRoute,
  type AnyQuillsRoute,
} from "../framework/define-route";
import { registry } from "../framework/registry";
import quillsRouter from "../index";
import publicRouter from "../public";

// Feature checks for in-app surveys that the per-route contract cannot express: the lifecycle,
// segment targeting, one answer per person under parallel requests, the score range of each
// type and the results math. Runs on a disposable local quills_ database.

let pool: Pool;
vi.mock("../../database/index", () => ({
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
vi.mock("../../utils/get-user-session", () => ({
  getUserSession: (headers: Headers) => contractSession(headers),
}));
const url = process.env.QUILLS_TEST_DATABASE_URL;
const app = contractApp(quillsRouter, publicRouter);
let client = 0;

type Options = {
  user?: string;
  bearer?: string;
  body?: unknown;
  scope?: object;
  target?: typeof app;
};
async function call(method: string, path: string, options: Options = {}) {
  const res = await (options.target ?? app).request(path, {
    method,
    headers: {
      ...(options.user && { "x-test-user": options.user }),
      ...(options.bearer && { authorization: `Bearer ${options.bearer}` }),
      ...(options.scope && { "x-test-scope": JSON.stringify(options.scope) }),
      ...(options.body !== undefined && { "content-type": "application/json" }),
      // A fresh client per request keeps these checks under the rate limits.
      "x-kaneo-client-ip": `203.0.113.${++client % 250}`,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  return { status: res.status, body: (await res.json()) as any };
}
const env = () => contractEnv();
const team = (method: string, path: string, options: Options = {}) =>
  call(method, `/quills/${env().a}${path}`, { user: env().owner, ...options });
const portal = (method: string, path: string, options: Options = {}) =>
  call(method, `/quills-public/${env().a}/portal${path}`, {
    user: env().customerA,
    ...options,
  });
const widget = (method: string, path: string, token: string, body?: unknown) =>
  call(method, `/quills-public/${env().a}/widget${path}`, {
    bearer: token,
    body,
  });
const answer = (id: string, body: unknown, options: Options = {}) =>
  portal("POST", `/surveys/${id}/responses`, { body, ...options });

/** A new active survey in A. Other active surveys close, so it is the one a customer gets. */
async function activeSurvey(body: Record<string, unknown>) {
  await pool.query(
    "UPDATE quills.surveys SET status='closed' WHERE workspace_id=$1 AND status='active'",
    [env().a],
  );
  const created = await team("POST", "/surveys", { body });
  expect(created.status).toBe(200);
  const id: string = created.body.id;
  expect(
    (await team("PUT", `/surveys/${id}/status`, { body: { status: "active" } }))
      .status,
  ).toBe(200);
  return id;
}

/** Customer principals of A with these display names. */
const people = (names: string[]) =>
  env().scoped(env().a, async (db) =>
    (
      await db
        .insert(principal)
        .values(
          names.map((displayName) => ({
            type: "user" as const,
            role: "user" as const,
            displayName,
            createdAt: new Date(),
          })),
        )
        .returning({ id: principal.id })
    ).map((row) => row.id),
  );

const eventsOf = async (id: string) =>
  (
    await pool.query(
      "SELECT type, payload FROM quills.events WHERE workspace_id=$1 AND entity_id=$2 ORDER BY id",
      [env().a, id],
    )
  ).rows;

describe.skipIf(!url)("Quills in-app surveys", () => {
  beforeAll(async () => {
    pool = new Pool({ connectionString: url, max: 6 });
    await startContract(pool, url!);
    await env().scoped(env().a, (db) =>
      db
        .update(settings)
        .set({ portalConfig: JSON.stringify({ enabled: true }) }),
    );
  }, 120000);
  afterAll(() => stopContract(), 120000);

  it("moves a survey from draft to active to closed, and deletes only a draft", async () => {
    const pmf = await team("POST", "/surveys", {
      body: { type: "pmf", question: "How would you feel without us?" },
    });
    expect(pmf.body.options).toEqual([
      "Very disappointed",
      "Somewhat disappointed",
      "Not disappointed",
    ]);
    for (const body of [
      { type: "poll", question: "Which?" },
      { type: "poll", question: "Which?", options: ["CSV", "CSV"] },
      { type: "poll", question: "Which?", options: ["CSV"] },
      { type: "nps", question: "How likely?", options: ["A", "B"] },
      { type: "nps", question: " " },
    ])
      expect((await team("POST", "/surveys", { body })).status).toBe(400);

    const created = await team("POST", "/surveys", {
      body: { type: "nps", question: "How likely?" },
    });
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      status: "draft",
      options: [],
      targetSegmentIds: null,
      responseCount: 0,
    });
    const id: string = created.body.id;
    const path = `/surveys/${id}`;
    const edited = await team("PATCH", path, {
      body: { question: "How likely are you to recommend us?" },
    });
    expect(edited.body.question).toBe("How likely are you to recommend us?");
    expect(
      (await team("PATCH", path, { body: { options: ["A", "B"] } })).status,
    ).toBe(400);
    const status = (value: string) =>
      team("PUT", `${path}/status`, { body: { status: value } });
    expect((await status("closed")).status).toBe(409);
    expect((await status("active")).body.status).toBe("active");
    expect((await status("active")).status).toBe(409);
    expect((await team("DELETE", path)).status).toBe(409);
    expect((await status("closed")).body.status).toBe("closed");
    expect(
      (await team("PATCH", path, { body: { question: "Q?" } })).status,
    ).toBe(409);
    expect((await status("active")).status).toBe(409);
    expect(await eventsOf(id)).toEqual([
      { type: "survey.created", payload: {} },
      { type: "survey.updated", payload: {} },
      { type: "survey.updated", payload: { status: "active" } },
      { type: "survey.closed", payload: {} },
    ]);

    const draft = await team("POST", "/surveys", {
      body: { type: "open", question: "Anything else?" },
    });
    expect((await team("DELETE", `/surveys/${draft.body.id}`)).status).toBe(
      200,
    );
    expect(
      (await team("GET", `/surveys/${draft.body.id}/results`)).status,
    ).toBe(404);
    expect((await eventsOf(draft.body.id)).map((e) => e.type)).toEqual([
      "survey.created",
      "survey.deleted",
    ]);
    const listed = await team("GET", "/surveys?status=closed");
    expect(listed.body.surveys.map((s: { id: string }) => s.id)).toContain(id);
    expect(
      listed.body.surveys.every(
        (s: { status: string }) => s.status === "closed",
      ),
    ).toBe(true);
  });

  it("keeps the surveys and segments of workspace B out of workspace A", async () => {
    const foreign = await env().scoped(env().b, async (db) => {
      const [segment] = await db
        .insert(segments)
        .values({ name: "B", slug: env().id("b-segment") })
        .returning({ id: segments.id });
      return segment!.id;
    });
    const inB = await call("POST", `/quills/${env().b}/surveys`, {
      user: users.outsider,
      body: { type: "nps", question: "B only" },
    });
    expect(inB.status).toBe(200);
    const id: string = inB.body.id;
    for (const [method, path, body] of [
      ["PATCH", `/surveys/${id}`, { question: "Taken" }],
      ["PUT", `/surveys/${id}/status`, { status: "active" }],
      ["DELETE", `/surveys/${id}`, undefined],
      ["GET", `/surveys/${id}/results`, undefined],
    ] as const)
      expect((await team(method, path, { body })).status).toBe(404);
    expect(
      (
        await team("POST", "/surveys", {
          body: { type: "nps", question: "Q?", targetSegmentIds: [foreign] },
        })
      ).status,
    ).toBe(404);
    const draft = await team("POST", "/surveys", {
      body: { type: "nps", question: "Mine?" },
    });
    const retarget = (targetSegmentIds: unknown) =>
      team("PATCH", `/surveys/${draft.body.id}`, {
        body: { targetSegmentIds },
      });
    expect((await retarget([foreign])).status).toBe(404);
    const everyone = await retarget(null);
    expect([everyone.status, everyone.body.targetSegmentIds]).toEqual([
      200,
      null,
    ]);
    const list = await team("GET", "/surveys?limit=100");
    expect(JSON.stringify(list.body)).not.toContain("B only");
    // The outsider of B is not a member of A.
    expect([403, 404]).toContain(
      (await team("GET", "/surveys", { user: users.outsider })).status,
    );
    expect((await answer(id, { score: 9 })).status).toBe(404);
    const [stored] = (
      await pool.query(
        "SELECT status FROM quills.surveys WHERE workspace_id=$1",
        [env().b],
      )
    ).rows;
    expect(stored).toEqual({ status: "draft" });
  });

  it("shows a targeted survey only to members of its live segments", async () => {
    const member = await env().portalCustomer(env().a, env().customerA);
    const visitor = await env().widgetVisitor(env().a);
    const segment = await env().scoped(env().a, async (db) => {
      const [row] = await db
        .insert(segments)
        .values({ name: "Beta", slug: env().id("beta") })
        .returning({ id: segments.id });
      await db.insert(userSegments).values({
        segmentId: row!.id,
        principalId: member.principalId as TypeId<"principal">,
      });
      return row!.id;
    });
    const id = await activeSurvey({
      type: "csat",
      question: "How was the beta?",
      targetSegmentIds: [segment],
    });
    const seen = await portal("GET", "/surveys/active");
    expect(seen.body.survey).toEqual({
      id,
      type: "csat",
      question: "How was the beta?",
      options: [],
      scale: { min: 1, max: 5 },
    });
    // Customer B and an identified visitor outside the segment get nothing and cannot answer.
    const outside = await portal("GET", "/surveys/active", {
      user: env().customerB,
    });
    expect(outside.body.survey).toBeNull();
    expect(
      (await answer(id, { score: 4 }, { user: env().customerB })).status,
    ).toBe(404);
    expect(
      (await widget("GET", "/surveys/active", visitor.token)).body.survey,
    ).toBeNull();
    await env().scoped(env().a, (db) =>
      db.insert(userSegments).values({
        segmentId: segment,
        principalId: visitor.principalId as TypeId<"principal">,
      }),
    );
    expect(
      (await widget("GET", "/surveys/active", visitor.token)).body.survey?.id,
    ).toBe(id);
    expect(
      (
        await widget("POST", `/surveys/${id}/responses`, visitor.token, {
          score: 5,
        })
      ).status,
    ).toBe(200);
    // An anonymous widget session never gets a survey.
    const anonymous = await call(
      "POST",
      `/quills-public/${env().a}/widget/anonymous-session`,
    );
    expect(
      (await widget("GET", "/surveys/active", anonymous.body.sessionToken)).body
        .survey,
    ).toBeNull();
    // A deleted segment no longer admits its members.
    await pool.query(
      "UPDATE quills.segments SET deleted_at=now() WHERE workspace_id=$1 AND id=(SELECT id FROM quills.segments WHERE workspace_id=$1 AND slug LIKE '%beta%' ORDER BY created_at DESC LIMIT 1)",
      [env().a],
    );
    expect((await portal("GET", "/surveys/active")).body.survey).toBeNull();
  });

  it("gives a customer the latest active survey that they did not answer", async () => {
    const first = await activeSurvey({ type: "nps", question: "First?" });
    const second = await team("POST", "/surveys", {
      body: { type: "csat", question: "Second?" },
    });
    await team("PUT", `/surveys/${second.body.id}/status`, {
      body: { status: "active" },
    });
    expect((await portal("GET", "/surveys/active")).body.survey?.id).toBe(
      second.body.id,
    );
    expect(
      (await answer(second.body.id, { score: 5, comment: "  Quick setup  " }))
        .status,
    ).toBe(200);
    expect((await portal("GET", "/surveys/active")).body.survey?.id).toBe(
      first,
    );
    // The stored answer reaches the results, trimmed and with the person's name.
    const results = (await team("GET", `/surveys/${second.body.id}/results`))
      .body;
    expect(results).toMatchObject({ total: 1, score: 100 });
    expect(results.comments).toEqual([
      expect.objectContaining({
        comment: "Quick setup",
        score: 5,
        choice: null,
        respondent: env().customerA,
      }),
    ]);
    // An anonymous widget session never answers, also an untargeted survey.
    const anonymous = await call(
      "POST",
      `/quills-public/${env().a}/widget/anonymous-session`,
    );
    expect(
      (
        await widget(
          "POST",
          `/surveys/${first}/responses`,
          anonymous.body.sessionToken,
          {
            score: 3,
          },
        )
      ).status,
    ).toBe(404);
  });

  it("keeps one answer per person, also for parallel submits", async () => {
    const id = await activeSurvey({ type: "nps", question: "How likely?" });
    expect((await portal("GET", "/surveys/active")).body.survey?.id).toBe(id);
    const results = await Promise.all(
      Array.from({ length: 6 }, () => answer(id, { score: 10 })),
    );
    expect(results.map((r) => r.status).sort()).toEqual([
      200, 409, 409, 409, 409, 409,
    ]);
    expect(results.find((r) => r.status === 409)!.body.message).toBe(
      "You already answered this survey",
    );
    const stored = await pool.query(
      "SELECT count(*)::int AS n FROM quills.survey_responses WHERE workspace_id=$1 AND survey_id=(SELECT id FROM quills.surveys WHERE workspace_id=$1 AND status='active')",
      [env().a],
    );
    expect(stored.rows[0].n).toBe(1);
    expect(
      (await eventsOf(id)).filter((e) => e.type === "survey.responded"),
    ).toHaveLength(1);
    // Answered: the survey no longer waits for this customer.
    expect((await portal("GET", "/surveys/active")).body.survey).toBeNull();
  });

  it("checks the answer against the scale or options of each type", async () => {
    const cases: [Record<string, unknown>, unknown[], unknown][] = [
      [
        { type: "nps", question: "NPS?" },
        [{}, { score: 11 }, { score: -1 }, { score: 5.5 }, { choice: "A" }],
        { score: 0 },
      ],
      [
        { type: "csat", question: "CSAT?" },
        [{ score: 0 }, { score: 6 }],
        { score: 5, comment: "Good" },
      ],
      [
        { type: "ces", question: "CES?" },
        [{ score: 0 }, { score: 8 }],
        { score: 7 },
      ],
      [
        { type: "pmf", question: "PMF?" },
        [
          { choice: "Maybe" },
          { score: 3 },
          { choice: "Very disappointed", score: 1 },
        ],
        { choice: "Very disappointed" },
      ],
      [
        { type: "poll", question: "Poll?", options: ["CSV", "PDF"] },
        [{ choice: "XLS" }, {}],
        { choice: "PDF" },
      ],
      [
        { type: "open", question: "Open?" },
        [{}, { comment: "  " }, { score: 3, comment: "Hi" }],
        { comment: "More exports" },
      ],
    ];
    for (const [survey, bad, good] of cases) {
      const id = await activeSurvey(survey);
      for (const body of bad)
        expect([survey.type, (await answer(id, body)).status]).toEqual([
          survey.type,
          400,
        ]);
      expect([survey.type, (await answer(id, good)).status]).toEqual([
        survey.type,
        200,
      ]);
    }
  });

  it("computes the results of each type", async () => {
    const respond = async (
      id: string,
      rows: { score?: number; choice?: string; comment?: string }[],
    ) => {
      const ids = await people(rows.map((_, i) => `Person ${i}`));
      await env().scoped(env().a, (db) =>
        db.insert(surveyResponses).values(
          rows.map((row, i) => ({
            surveyId: id as TypeId<"survey">,
            principalId: ids[i]!,
            score: row.score ?? null,
            choice: row.choice ?? null,
            comment: row.comment ?? null,
            createdAt: new Date(Date.UTC(2026, 0, 1, 0, i)),
          })),
        ),
      );
      return (await team("GET", `/surveys/${id}/results`)).body;
    };
    const nps = await respond(
      await activeSurvey({ type: "nps", question: "NPS?" }),
      [10, 10, 9, 8, 0].map((score) => ({ score })),
    );
    expect(nps).toMatchObject({ total: 5, score: 40 });
    expect(nps.scores).toHaveLength(11);
    expect(nps.scores[10]).toEqual({ value: 10, count: 2 });
    expect(nps.survey.responseCount).toBe(5);
    // A 6 is a detractor and a 7 is passive: 2 promoters and 3 detractors of 7 give -14.
    const negative = await respond(
      await activeSurvey({ type: "nps", question: "NPS below zero?" }),
      [10, 9, 8, 7, 6, 0, 0].map((score) => ({ score })),
    );
    expect(negative).toMatchObject({ total: 7, score: -14 });
    const csat = await respond(
      await activeSurvey({ type: "csat", question: "CSAT?" }),
      [5, 4, 3, 1].map((score) => ({ score })),
    );
    expect(csat).toMatchObject({ total: 4, score: 50 });
    expect(csat.scores.map((s: { value: number }) => s.value)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    const ces = await respond(
      await activeSurvey({ type: "ces", question: "CES?" }),
      [7, 6, 2, 2].map((score) => ({ score })),
    );
    expect(ces).toMatchObject({ total: 4, score: 4.3 });
    const pmf = await respond(
      await activeSurvey({ type: "pmf", question: "PMF?" }),
      ["Very disappointed", "Very disappointed", "Not disappointed"].map(
        (choice) => ({ choice }),
      ),
    );
    expect(pmf).toMatchObject({ total: 3, score: 67 });
    expect(pmf.choices).toEqual([
      { label: "Very disappointed", count: 2 },
      { label: "Somewhat disappointed", count: 0 },
      { label: "Not disappointed", count: 1 },
    ]);
    const pollId = await activeSurvey({
      type: "poll",
      question: "Poll?",
      options: ["CSV", "PDF", "XLS"],
    });
    const comments = Array.from({ length: 22 }, (_, i) => ({
      choice: i % 2 ? "PDF" : "CSV",
      comment: `Comment ${i}`,
    }));
    const poll = await respond(pollId, comments);
    expect(poll).toMatchObject({ total: 22, score: null, scores: [] });
    expect(poll.choices).toEqual([
      { label: "CSV", count: 11 },
      { label: "PDF", count: 11 },
      { label: "XLS", count: 0 },
    ]);
    expect(poll.comments).toHaveLength(20);
    expect(poll.comments[0]).toMatchObject({
      comment: "Comment 21",
      choice: "PDF",
      respondent: "Person 21",
    });
    // A removed poll option counts only in the total.
    await team("PATCH", `/surveys/${pollId}`, {
      body: { options: ["PDF", "XLS"] },
    });
    const changed = (await team("GET", `/surveys/${pollId}/results`)).body;
    expect(changed.total).toBe(22);
    expect(changed.choices).toEqual([
      { label: "PDF", count: 11 },
      { label: "XLS", count: 0 },
    ]);
    const empty = (
      await team(
        "GET",
        `/surveys/${await activeSurvey({ type: "nps", question: "None?" })}/results`,
      )
    ).body;
    expect(empty).toMatchObject({ total: 0, score: null, comments: [] });
  });

  it("rolls back an answer when a later step fails", async () => {
    const id = await activeSurvey({ type: "nps", question: "Rollback?" });
    const declared = [...registry.keys()].find(
      (d) => d.operationId === "submitQuillsPortalSurveyResponse",
    )!;
    const failure: Partial<AnyQuillsRoute> = {
      handler: async (input) => {
        await declared.handler(input);
        throw new Error("Injected failure after the write");
      },
    };
    const failing = contractApp(
      apiRouter(),
      apiRouter<BaseVariables & { workspaceId: string }>().openapi(
        ...buildQuillsRoute({ ...declared, ...failure }),
      ),
    );
    const res = await answer(id, { score: 8 }, { target: failing });
    expect(res.status).toBe(500);
    const left = await pool.query(
      `SELECT (SELECT count(*) FROM quills.survey_responses WHERE workspace_id=$1 AND survey_id=$2)::int AS responses,
              (SELECT count(*) FROM quills.audit_log WHERE workspace_id=$1 AND target_id=$3 AND event_type='survey.responded')::int AS audit`,
      [env().a, toUuid(id), id],
    );
    expect(left.rows[0]).toEqual({ responses: 0, audit: 0 });
    expect((await answer(id, { score: 8 })).status).toBe(200);
  });

  it("refuses a role without the action and an API key without the scope", async () => {
    await pool.query(
      "UPDATE public.workspace_role SET permission=$1 WHERE workspace_id=$2 AND role=$3",
      [
        JSON.stringify({ workspace: ["read"], quills: ["read"] }),
        env().a,
        role,
      ],
    );
    const body = { type: "nps", question: "Denied?" };
    expect(
      (await team("GET", "/surveys", { user: users.limited })).status,
    ).toBe(200);
    expect(
      (await team("POST", "/surveys", { user: users.limited, body })).status,
    ).toBe(403);
    const scope = { workspace: ["read"], quills: ["read"] };
    expect((await team("GET", "/surveys", { scope })).status).toBe(200);
    const keyed = await team("POST", "/surveys", { scope, body });
    expect([keyed.status, keyed.body.code]).toEqual([403, "API_KEY_SCOPE"]);
    const list = await team("GET", "/surveys?limit=100");
    expect(JSON.stringify(list.body)).not.toContain("Denied?");
  });
});
