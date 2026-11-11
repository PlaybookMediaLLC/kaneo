import type { TypeId } from "@kaneo/ids";
import { z } from "../../openapi";
import { postActivity } from "../../database/quills/schema/activity";
import type { Database, QuillsActor } from "../framework/define-route";

type Text = string | null;

/** The source's activity types and their metadata, as the post timeline reads them. */
type Activity =
  | { type: "post.created"; metadata: { boardName: string } }
  | { type: "post.deleted" | "post.restored"; metadata?: undefined }
  | {
      type: "status.changed";
      metadata: {
        fromName: Text;
        fromColor: Text;
        toName: string;
        toSlug: string;
        toColor: Text;
      };
    }
  | {
      type: "post.board_changed";
      metadata: {
        fromBoardId: string;
        fromBoardName: string;
        toBoardId: string;
        toBoardName: string;
      };
    }
  | {
      type: "owner.assigned";
      metadata: { ownerName: Text; previousOwnerName?: Text };
    }
  | { type: "owner.unassigned"; metadata: { previousOwnerName: Text } }
  | { type: "tags.added" | "tags.removed"; metadata: { tagNames: string[] } }
  | { type: "comments.locked" | "comments.unlocked"; metadata?: undefined }
  | {
      type: "vote.proxy" | "vote.removed";
      metadata: { voterPrincipalId: string; voterName: Text };
    }
  | { type: "comment.pinned"; metadata: { commentId: string } }
  | { type: "comment.unpinned"; metadata?: undefined }
  | {
      type: "comment.deleted" | "comment.removed" | "comment.restored";
      metadata: { commentId: string; commentAuthorPrincipalId: string };
    };

/** Records one post activity row in the request transaction. */
export async function recordActivity(
  db: Database,
  actor: QuillsActor,
  postId: TypeId<"post">,
  activity: Activity,
) {
  await db.insert(postActivity).values({
    postId,
    principalId: actor.principalId,
    type: activity.type,
    metadata: activity.metadata ?? {},
  });
}

const text = z.string().nullable().optional();
/** Every metadata key above. Rows written by other modules keep only these keys; a row that does not fit reads as {}. */
export const activityMetadata = z.object({
  boardName: text,
  fromName: text,
  fromColor: text,
  toName: text,
  toSlug: text,
  toColor: text,
  fromBoardId: text,
  fromBoardName: text,
  toBoardId: text,
  toBoardName: text,
  ownerName: text,
  previousOwnerName: text,
  tagNames: z.array(z.string()).optional(),
  voterPrincipalId: text,
  voterName: text,
  commentId: text,
  commentAuthorPrincipalId: text,
});
