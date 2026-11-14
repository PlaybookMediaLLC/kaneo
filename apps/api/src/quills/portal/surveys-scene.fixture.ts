import { createId } from "@kaneo/ids";
import { eq } from "drizzle-orm";
import type { TypeId } from "@kaneo/ids";
import { settings } from "../../database/quills/schema/auth";
import { surveyResponses, surveys } from "../../database/quills/schema/surveys";
import { fixture, type ContractEnv, type Fixture } from "../framework/contract";
import { title, type Customer } from "./feedback/viewer";

/** Workspace A's open survey for the caller, and surveys that no caller of A may see. */
async function scene(env: ContractEnv, who: Customer) {
  const me: { principalId: string; token?: string } =
    who === "portal"
      ? await env.portalCustomer(env.a, env.customerA)
      : await env.widgetVisitor(env.a);
  const hidden: string[] = [];
  const add = (
    workspaceId: string,
    values: Partial<typeof surveys.$inferInsert>,
  ) =>
    env.scoped(workspaceId, async (db) => {
      // A public portal: the widget ignores this flag, the portal needs it.
      await db
        .update(settings)
        .set({ portalConfig: JSON.stringify({ enabled: true }) });
      const question = env.id("survey");
      const [row] = await db
        .insert(surveys)
        .values({ type: "nps", status: "active", question, ...values })
        .returning({ id: surveys.id });
      return { id: row!.id, question };
    });
  for (const values of [
    { status: "draft" as const },
    { status: "closed" as const },
    { targetSegmentIds: [createId("segment")] },
  ] satisfies Partial<typeof surveys.$inferInsert>[])
    hidden.push((await add(env.a, values)).question);
  const b = await add(env.b, {});
  hidden.push(b.question, b.id);
  const a = await add(env.a, {});
  return { me, a: a.id, b: b.id, hidden, token: me.token };
}
type Scene = Awaited<ReturnType<typeof scene>>;

/** The caller's answers in A: another caller must not change them. */
const probe = (env: ContractEnv, s: Scene) =>
  env.scoped(env.a, (db) =>
    db
      .select({
        surveyId: surveyResponses.surveyId,
        score: surveyResponses.score,
        comment: surveyResponses.comment,
      })
      .from(surveyResponses)
      .where(
        eq(
          surveyResponses.principalId,
          s.me.principalId as TypeId<"principal">,
        ),
      )
      .orderBy(surveyResponses.surveyId),
  );

/** The fixtures of the survey routes of one audience, keyed by operationId. */
export function surveyFixtures(who: Customer): Record<string, Fixture> {
  const t = title(who);
  const make = (
    valid: (s: Scene) => { params?: Record<string, string>; body?: unknown },
    foreign?: (s: Scene) => Record<string, string>,
  ) =>
    fixture<Scene>({
      seed: (env) => scene(env, who),
      valid: (s) => ({ ...valid(s), ...(s.token && { bearer: s.token }) }),
      foreign,
      hidden: (s) => s.hidden,
      probe,
    });
  return {
    [`getQuills${t}ActiveSurvey`]: make(() => ({})),
    [`submitQuills${t}SurveyResponse`]: make(
      (s) => ({
        params: { surveyId: s.a },
        body: { score: 9, comment: "Fast and clear" },
      }),
      (s) => ({ surveyId: s.b }),
    ),
  };
}
