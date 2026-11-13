import { describe, expect, it } from "vite-plus/test";
import { createMyTicketFixture } from "../../api/support/create-my-ticket.fixture";
import { getMyTicketsFixture } from "../../api/support/get-my-tickets.fixture";
import { fill, press } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { TicketsPage } from "./tickets-page";

describe("TicketsPage", () => {
  const signedIn = { viewer: { kind: "user" as const, id: "account_test_1" } };
  const prepareWriteProblem = (status: number, headers?: HeadersInit) => {
    const api = mockApi();
    api.reply(getMyTicketsFixture.ok());
    api.reply({ message: "Request could not be completed" }, status, headers);
  };
  const submit = async (view: ReturnType<typeof renderPage>) => {
    await view.findByLabelText("Title");
    fill("Title", "Cannot sign in");
    press("Create ticket");
  };
  describePageContract(meta, TicketsPage, {
    loading: {
      prepare: () => {
        mockApi().defer(() => undefined);
        return signedIn;
      },
    },
    empty: {
      prepare: () => {
        mockApi().reply(getMyTicketsFixture.ok());
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
        mockApi().reply(
          getMyTicketsFixture.ok({
            items: [
              createMyTicketFixture.ok({
                title: "Export unavailable",
                reference: "TICKET-12",
              }),
            ],
          }),
        );
        return signedIn;
      },
      assert: async (view) => {
        await view.findByText("Export unavailable");
      },
    },
    done: {
      prepare: () => {
        const api = mockApi();
        api.reply(getMyTicketsFixture.ok());
        api.reply(createMyTicketFixture.ok());
        api.reply(getMyTicketsFixture.ok());
        return signedIn;
      },
      act: submit,
      assert: async (view) => {
        await view.findByText("Ticket created");
      },
    },
  });
  describe("behavior", () => {
    it("keeps create available in the empty state and links the created conversation", async () => {
      const api = mockApi();
      api.reply(getMyTicketsFixture.ok());
      api.reply(
        createMyTicketFixture.ok({ conversationId: "conversation_test_1" }),
      );
      api.reply(getMyTicketsFixture.ok());
      const view = renderPage(TicketsPage, meta, {
        viewer: { kind: "user", id: "account_test_1" },
      });
      expect(await view.findByText("Nothing is here yet.")).toBeInTheDocument();
      fill("Title", "Cannot sign in");
      press("Create ticket");
      expect(await view.findByText("Ticket created")).toBeInTheDocument();
      expect(
        view.getByRole("link", {
          name: "Open ticket conversation: Ticket created",
        }),
      ).toHaveAttribute(
        "href",
        "/portal/workspace_test_1/conversations/conversation_test_1",
      );
      expect(api.calls("createQuillsMyTicket")).toHaveLength(1);
    });
  });
});
