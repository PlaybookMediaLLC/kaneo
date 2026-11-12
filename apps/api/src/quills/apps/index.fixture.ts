import { vi } from "vite-plus/test";
import { softDeletes } from "../feedback/seeds.fixture";
import { fixture, type ContractEnv } from "../framework/contract";
import { appSeed, appSide, registeredApp, type AppIds } from "./seed.fixture";

// The registration route mints a real API key through the auth module, which needs a secret.
if (!process.env.AUTH_SECRET)
  vi.stubEnv("AUTH_SECRET", "contract-auth-secret-of-at-least-32-characters");

const requester = (env: ContractEnv) => ({
  email: `${env.id("requester")}@example.test`,
  name: "Requester",
});
const softDeletePost = softDeletes("posts", ({ a }: AppIds) => a.postId);

/** One board for the boards read, named to sort first, so the first page always holds it. */
const shared = new Map<string, Promise<Awaited<ReturnType<typeof appSide>>>>();
export const listQuillsAppBoards = fixture({
  seed: async (env) => {
    if (!shared.has(env.a))
      shared.set(env.a, appSide(env, env.a, "0 App board"));
    return shared.get(env.a)!;
  },
  valid: () => ({}),
  visible: (ids) => [ids.boardId],
});
export const searchQuillsAppPosts = fixture({
  seed: appSeed,
  valid: ({ a }: AppIds) => ({ query: { q: a.title } }),
  visible: ({ a }: AppIds) => [a.postId],
});
export const suggestQuillsAppPosts = fixture({
  seed: appSeed,
  valid: ({ a }: AppIds) => ({ query: { text: a.title, limit: "20" } }),
  visible: ({ a }: AppIds) => [a.postId],
});
export const listQuillsAppLinkedPosts = fixture({
  seed: appSeed,
  valid: ({ a }: AppIds) => ({
    query: { externalType: "zendesk", externalKey: a.key },
  }),
  visible: ({ a }: AppIds) => [a.postId],
});
export const createQuillsAppPost = fixture({
  seed: async (env) => ({
    ...(await appSeed(env)),
    requester: requester(env),
    ticket: env.id("ticket"),
  }),
  valid: (ids) => ({
    body: {
      boardId: ids.a.boardId,
      title: "Export to CSV",
      content: "From the sidebar",
      link: { externalType: "zendesk", externalKey: ids.ticket },
      requester: ids.requester,
    },
  }),
  foreign: ({ b }) => ({ boardId: b.boardId }),
  softDelete: softDeletes("boards", ({ a }: AppIds) => a.boardId),
});
export const linkQuillsAppPost = fixture({
  seed: async (env) => ({
    ...(await appSeed(env)),
    requester: requester(env),
    ticket: env.id("ticket"),
  }),
  valid: (ids) => ({
    body: {
      postId: ids.a.postId,
      externalType: "Zendesk",
      externalKey: ids.ticket,
      externalUrl: "https://example.test/tickets/1",
      requester: ids.requester,
    },
  }),
  foreign: ({ b }) => ({ postId: b.postId }),
  softDelete: softDeletePost,
});
export const unlinkQuillsAppPost = fixture({
  seed: appSeed,
  valid: ({ a }: AppIds) => ({
    query: { postId: a.postId, externalType: "zendesk", externalKey: a.key },
  }),
  foreign: ({ b }: AppIds) => ({ postId: b.postId }),
  softDelete: softDeletePost,
});

const apps = async (env: ContractEnv) => ({
  a: await registeredApp(env, env.a),
  b: await registeredApp(env, env.b),
});
export const listQuillsAppRegistrations = fixture({
  seed: apps,
  valid: () => ({}),
});
export const createQuillsAppRegistration = fixture({
  seed: async () => ({}),
  valid: () => ({
    body: { name: "Zendesk sidebar", grantedScopes: ["read:feedback"] },
  }),
});
export const updateQuillsAppRegistration = fixture({
  seed: apps,
  valid: (ids) => ({
    params: { appId: ids.a },
    body: { name: "Renamed", status: "disabled" },
  }),
  foreign: (ids) => ({ appId: ids.b }),
});
