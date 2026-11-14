import { client } from "../api/client";

/** The public RSS feed of a workspace changelog, on the API origin. */
export const changelogFeedUrl = (workspace: string) =>
  client["quills-public"][":workspace"].changelog["rss.xml"]
    .$url({ param: { workspace } })
    .toString();
