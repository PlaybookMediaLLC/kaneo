import {
  articlePublished,
  backfillEmbeddings,
  backfillTags,
  checkDuplicates,
  classifySentiment,
  summarizeConversation,
  summarizeTicket,
  translateRequested,
} from "./content";
import { answerRun } from "./runs";
import type { Work } from "./shared";
import { fetchWebSource } from "./web-source";

export type { Work, Write } from "./shared";

/** Event type → the assistant work that the quills.ai queue runs for it after commit. */
export const assistantWork: Record<string, Work> = {
  "assistant_run.requested": answerRun,
  "assistant_web_source.added": fetchWebSource,
  "assistant.embeddings_requested": backfillEmbeddings,
  "post.created": checkDuplicates,
  "post.merge_check_requested": checkDuplicates,
  "post.sentiment_requested": classifySentiment,
  "post.tags_backfill_requested": backfillTags,
  "conversation.summary_requested": summarizeConversation,
  "ticket.summary_requested": summarizeTicket,
  "help_center.article_translation_requested": translateRequested,
  "help_center.article_published": articlePublished,
};
