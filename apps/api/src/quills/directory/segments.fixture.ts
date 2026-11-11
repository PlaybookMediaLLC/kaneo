import { fixture, type ContractEnv } from "../framework/contract";
import { customer, member, segment } from "./seed.fixture";

const side = async (
  env: ContractEnv,
  workspaceId: string,
  type: "manual" | "dynamic",
  joined: boolean,
) => {
  const segmentId = await segment(env, workspaceId, type);
  const principalId = await customer(env, workspaceId);
  if (joined) await member(env, workspaceId, segmentId, principalId);
  return { segmentId, principalId };
};
const seed =
  (type: "manual" | "dynamic" = "manual", joined = false) =>
  async (env: ContractEnv) => ({
    a: await side(env, env.a, type, joined),
    b: await side(env, env.b, type, joined),
  });
type Ids = Awaited<ReturnType<ReturnType<typeof seed>>>;
const bySegment = (
  body: ((ids: Ids) => unknown) | undefined,
  type?: "manual" | "dynamic",
  joined?: boolean,
) =>
  fixture({
    seed: seed(type, joined),
    valid: (ids: Ids) => ({
      params: { segmentId: ids.a.segmentId },
      body: body?.(ids),
    }),
    foreign: (ids: Ids) => ({ segmentId: ids.b.segmentId }),
  });
const members = ({ a }: Ids) => ({ principalIds: [a.principalId] });

export const listQuillsSegments = fixture({ seed: seed(), valid: () => ({}) });
export const listQuillsSegmentAttributeValues = fixture({
  seed: seed(),
  valid: () => ({ query: { attribute: "email", query: "contract" } }),
});
export const createQuillsSegment = fixture({
  seed: async (env) => ({ name: env.id("new-segment") }),
  valid: ({ name }) => ({ body: { name, type: "manual" } }),
});
export const evaluateQuillsAllSegments = fixture({
  seed: seed("dynamic"),
  valid: () => ({}),
});
export const updateQuillsSegment = bySegment(() => ({ name: "Renamed" }));
export const deleteQuillsSegment = bySegment(undefined);
export const addQuillsSegmentMembers = bySegment(members);
export const removeQuillsSegmentMembers = bySegment(members, "manual", true);
export const evaluateQuillsSegment = bySegment(undefined, "dynamic");
