import type { Database, QuillsActor } from "../../../database/quills/client";
import { changelogEntries } from "../../../database/quills/schema/changelog";
import { feedbackGroups, releaseTitles } from "./content";

export async function seedShowcaseUpdates(db: Database, actor: QuillsActor) {
  await db.insert(changelogEntries).values(
    releaseTitles.map((title, index) => ({
      title,
      principalId: actor.principalId,
      publishedAt: new Date(Date.now() - (index * 14 + 1) * 86400000),
      displayDate: new Date(Date.now() - (index * 14 + 1) * 86400000),
      content: `This week we are sharing improvements across feedback, roadmaps, and the customer portal. These release notes are example content for the local demo.\n\n## What is new\n\n- **${feedbackGroups[0]!.titles[index]}.** Keep customer requests connected to the work your team is planning. The portal gives everyone a shared place to follow progress.\n- **${feedbackGroups[2]!.titles[index]}.** Small improvements make everyday actions easier to discover and more comfortable to use.\n- **Clearer conversations.** Replies stay close to their context, and longer discussions are easier to scan.\n\n## Improvements\n\nWe refined loading states, made filters easier to understand, and improved the experience on smaller screens. Long titles and detailed descriptions now have more room to breathe.\n\n1. Open the feedback page and choose a board.\n2. Explore a request and read the conversation.\n3. Follow the request to keep up with the next update.\n\n## Fixes\n\n- ${feedbackGroups[1]!.titles[index]}.\n- Better feedback when a request takes longer than expected.\n- More consistent keyboard focus when moving between views.\n\n## Thank you\n\nYour examples help us understand the work behind each request. Keep sharing your ideas, questions, and the small details that would make your day easier.`,
    })),
  );
  return { updates: releaseTitles.length };
}
