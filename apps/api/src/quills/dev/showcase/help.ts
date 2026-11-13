import { eq } from "drizzle-orm";
import type { Database, QuillsActor } from "../../../database/quills/client";
import {
  helpCenterArticles,
  helpCenterCategories,
} from "../../../database/quills/schema/kb";
import { helpGroups } from "./content";

export async function seedShowcaseHelp(db: Database, actor: QuillsActor) {
  for (const [position, group] of helpGroups.entries()) {
    let [category] = await db
      .select({ id: helpCenterCategories.id })
      .from(helpCenterCategories)
      .where(eq(helpCenterCategories.slug, group.slug));
    if (!category)
      [category] = await db
        .insert(helpCenterCategories)
        .values({
          name: group.name,
          slug: group.slug,
          description: group.description,
          position,
        })
        .returning({ id: helpCenterCategories.id });
    await db.insert(helpCenterArticles).values(
      group.titles.map((title, articlePosition) => ({
        categoryId: category!.id,
        title,
        slug: `demo-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
        description: `A practical guide to ${title.toLowerCase()}, with examples and common questions.`,
        position: articlePosition,
        principalId: actor.principalId,
        publishedAt: new Date(Date.now() - (position + 1) * 86400000),
        content: `This example guide walks through **${title.toLowerCase()}**. It is synthetic content for exploring the local Quills demo.\n\n## Before you begin\n\nOpen the correct workspace and check that you have the access needed for the action. ${group.description}\n\n## Step by step\n\n1. Open the relevant page from the portal navigation.\n2. Review the current information before making a change.\n3. Make one change and check the confirmation.\n4. Return to the page to see the saved result.\n\n## Working with your team\n\nKeep names short and descriptions specific. A teammate should be able to understand the purpose without asking who created it. Use a shared convention when several people contribute to the same workspace.\n\n> Start with a small, clear example. You can add more detail as your team begins using the workflow.\n\n## Common questions\n\n### Why can I not see an action?\n\nAvailable actions depend on your account, workspace role, and the visibility of the content. Ask a workspace owner if the access does not match what you expected.\n\n### Can I use this on my phone?\n\nThe portal supports a narrow screen. Open the navigation menu to move between collections while reading an article.\n\n### Where can I get more help?\n\nOpen Support from the portal navigation. Describe what you tried, what you expected, and what appeared instead. Include a screenshot if it helps explain the issue.\n\n## Next steps\n\nBrowse another article in **${group.name}**, or return to the help center to explore a different topic.`,
      })),
    );
  }
  return {
    collections: helpGroups.length,
    articles: helpGroups.reduce(
      (total, group) => total + group.titles.length,
      0,
    ),
  };
}
