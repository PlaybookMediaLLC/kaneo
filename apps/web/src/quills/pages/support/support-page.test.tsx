import { describe, expect, it } from "vite-plus/test";
import { listMyConversationsFixture } from "../../api/support/list-my-conversations.fixture";
import { startMyConversationFixture } from "../../api/support/start-my-conversation.fixture";
import { fill, press } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { SupportPage } from "./support-page";

describe("SupportPage", () => {
  const signedIn = { viewer: { kind: "user" as const, id: "account_test_1" } };
  const prepareWriteProblem = (status: number, headers?: HeadersInit) => {
    const api = mockApi();
    api.reply(listMyConversationsFixture.ok());
    api.reply({ message: "Request could not be completed" }, status, headers);
  };
  const submit = async (view: ReturnType<typeof renderPage>) => {
    await view.findByLabelText("How can we help?");
    fill("How can we help?", "Please help");
    press("Send message");
  };
  describePageContract(meta, SupportPage, {
    loading: {
      prepare: () => {
        mockApi().defer(() => undefined);
        return signedIn;
      },
    },
    empty: {
      prepare: () => {
        mockApi().reply(listMyConversationsFixture.ok());
        return signedIn;
      },
    },
    conflict: {
      prepare: () => {
        prepareWriteProblem(409);
        return signedIn;
      },
      act: submit,
    },
    rateLimited: {
      prepare: () => {
        prepareWriteProblem(429, { "retry-after": "60" });
        return signedIn;
      },
      act: submit,
    },
    failed: {
      prepare: () => {
        mockApi().fail();
        return signedIn;
      },
    },
    ready: {
      prepare: () => {
        const conversation = startMyConversationFixture.ok().conversation;
        mockApi().reply(
          listMyConversationsFixture.ok({
            items: [{ ...conversation, subject: "Account help" }],
          }),
        );
        return signedIn;
      },
      assert: async (view) => {
        await view.findByRole("link", { name: /account help/i });
      },
    },
    done: {
      prepare: () => {
        const api = mockApi();
        api.reply(listMyConversationsFixture.ok());
        api.reply(startMyConversationFixture.ok());
        api.reply(listMyConversationsFixture.ok());
        return signedIn;
      },
      act: submit,
      assert: async (view) => {
        await view.findByText("Conversation started");
      },
    },
  });
  describe("behavior", () => {
    it("keeps create available in the empty state and sends one idempotent write", async () => {
      const api = mockApi();
      api.reply(listMyConversationsFixture.ok());
      api.reply(startMyConversationFixture.ok());
      api.reply(listMyConversationsFixture.ok());
      const view = renderPage(SupportPage, meta, {
        viewer: { kind: "user", id: "account_test_1" },
      });
      expect(await view.findByText("Nothing is here yet.")).toBeInTheDocument();
      fill("How can we help?", "Please help");
      press("Send message");
      expect(await view.findByText("Conversation started")).toBeInTheDocument();
      expect(api.calls("startQuillsMyConversation")).toHaveLength(1);
    });
  });
});
