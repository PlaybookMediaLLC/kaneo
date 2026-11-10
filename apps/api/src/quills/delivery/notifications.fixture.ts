import {
  withQuillsWorkspace,
  type Database,
  type QuillsActor,
} from "../../database/quills/client";
import { inAppNotifications } from "../../database/quills/schema/notifications";
import { fixture, type ContractEnv } from "../framework/contract";

const insert = async (db: Database, actor: QuillsActor) => {
  const [row] = await db
    .insert(inAppNotifications)
    .values({
      principalId: actor.principalId,
      type: "contract",
      title: "Contract",
    })
    .returning({ id: inAppNotifications.id });
  return row!.id;
};
/** A notification of the caller in A (the inbox is per person), and one of B's owner. */
const seed = async (env: ContractEnv, caller: string) => ({
  a: await withQuillsWorkspace({ workspaceId: env.a, userId: caller }, insert),
  b: await env.scoped(env.b, insert),
});
type Ids = Awaited<ReturnType<typeof seed>>;
const one = fixture({
  seed,
  valid: ({ a }: Ids) => ({ params: { notificationId: a } }),
  foreign: ({ b }: Ids) => ({ notificationId: b }),
});
const inbox = fixture({ seed, valid: () => ({}) });

export const listQuillsNotifications = inbox;
export const getQuillsNotificationUnreadCount = inbox;
export const markQuillsNotificationRead = one;
export const archiveQuillsNotification = one;
export const markQuillsAllNotificationsRead = inbox;
export const archiveQuillsReadNotifications = inbox;
