import { surveys } from "../../database/quills/schema/surveys";
import { fixture, type ContractEnv } from "../framework/contract";

type Status = "draft" | "active" | "closed";

/** A fresh NPS survey in one workspace. */
const surveyIn = async (
  env: ContractEnv,
  workspaceId: string,
  status: Status,
) =>
  (
    await env.scoped(workspaceId, (db) =>
      db
        .insert(surveys)
        .values({ type: "nps", question: env.id("question"), status })
        .returning({ id: surveys.id }),
    )
  )[0]!.id;
const seed = (status: Status) => async (env: ContractEnv) => ({
  a: await surveyIn(env, env.a, status),
  b: await surveyIn(env, env.b, status),
});
type Ids = Awaited<ReturnType<ReturnType<typeof seed>>>;
const byId = (status: Status, body?: object) =>
  fixture({
    seed: seed(status),
    valid: ({ a }: Ids) => ({ params: { surveyId: a }, body }),
    foreign: ({ b }: Ids) => ({ surveyId: b }),
  });

export const listQuillsSurveys = fixture({
  seed: seed("draft"),
  valid: () => ({ query: { status: "draft" } }),
});
export const createQuillsSurvey = fixture({
  seed: async () => ({}),
  valid: () => ({
    body: { type: "poll", question: "Which first?", options: ["CSV", "PDF"] },
  }),
});
export const updateQuillsSurvey = byId("draft", { question: "How likely?" });
export const setQuillsSurveyStatus = byId("draft", { status: "active" });
export const deleteQuillsSurvey = byId("draft");
export const getQuillsSurveyResults = byId("active");
