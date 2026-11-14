import {
  chatReply,
  fallback,
  provider,
} from "../../assistant/provider-edge.fixture";
import { fixture } from "../../framework/contract";
import { probe, scene, type Scene } from "./seed.fixture";

/** Answers for the portal AI prompts (this route and ../translations.ts); other calls get the defaults. */
export const portalAiReply = (request: Parameters<typeof fallback>[0]) => {
  const system = String(request.body?.messages?.[0]?.content ?? "");
  if (system.startsWith("You help a customer write a feedback post"))
    return chatReply({
      title: "Export reports as CSV",
      problem: "I cannot share a report with my team.",
      boardId: null,
    });
  if (system.startsWith("Translate customer feedback"))
    return chatReply({ title: "Titel", content: "Inhalt" });
  return fallback(request);
};
provider.reply(portalAiReply);

/** Values that no response may contain: hidden rows of A and every row of B. */
export const hiddenOf = (s: Scene) => [
  ...s.a.hidden,
  ...s.b.hidden,
  s.b.postTitle,
  s.b.postId,
];

export const improveQuillsPortalPostDraft = fixture<Scene>({
  seed: (env) => scene(env, "portal"),
  valid: (s) => ({
    body: {
      title: "csv export",
      details: "need to send reports to my boss",
      boardId: s.a.boardId,
    },
  }),
  foreign: (s) => ({ boardId: s.b.boardId }),
  hidden: hiddenOf,
  own: (s) => s.a.own,
  probe,
});
