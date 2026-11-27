import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { getAwayReplyFixture } from "../../api/team/get-away-reply.fixture";
import { getConversationRoutingFixture } from "../../api/team/get-conversation-routing.fixture";
import { getDefaultSlaPolicyFixture } from "../../api/team/get-default-sla-policy.fixture";
import { getEmailAutoAckFixture } from "../../api/team/get-email-auto-ack.fixture";
import { getOfficeHoursFixture } from "../../api/team/get-office-hours.fixture";
import { getPortalSettingsFixture } from "../../api/team/get-portal-settings.fixture";
import { getWorkflowAbandonedAutoCloseFixture } from "../../api/team/get-workflow-abandoned-auto-close.fixture";
import { getWorkflowCloseSpamFixture } from "../../api/team/get-workflow-close-spam.fixture";
import { listSlaPolicyOptionsFixture } from "../../api/team/list-sla-policy-options.fixture";
import { setDefaultSlaPolicyFixture } from "../../api/team/set-default-sla-policy.fixture";
import { updatePortalSettingsFixture } from "../../api/team/update-portal-settings.fixture";
import { choose } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { SettingsConversationsGeneralPage } from "./settings-conversations-general-page";

let api: ReturnType<typeof mockApi>;
const ready = () => {
  api = mockApi();
  api.reply(getOfficeHoursFixture.ok({ timezone: "Europe/Berlin" }));
  api.reply(getConversationRoutingFixture.ok({ enabled: true }));
  api.reply(getEmailAutoAckFixture.ok());
  api.reply(getWorkflowAbandonedAutoCloseFixture.ok({ waitMinutes: 10 }));
  api.reply(getWorkflowCloseSpamFixture.ok());
  api.reply(getDefaultSlaPolicyFixture.ok());
  api.reply(
    listSlaPolicyOptionsFixture.ok({
      items: [
        {
          id: "policy_1",
          name: "Priority",
          targetsSummary: "1h",
          hasTimeToResolveTarget: false,
        },
      ],
    }),
  );
  api.reply(getPortalSettingsFixture.ok({ supportEnabled: true }));
  api.reply(getAwayReplyFixture.ok());
  api.reply({ enabled: false, delaySeconds: 10 });
};

describe("SettingsConversationsGeneralPage", () => {
  describePageContract(meta, SettingsConversationsGeneralPage, {
    loading: {
      prepare: () => {
        const api = mockApi();
        for (let index = 0; index < 10; index += 1) api.defer(() => undefined);
      },
    },
    failed: {
      prepare: () => {
        const api = mockApi();
        for (let index = 0; index < 10; index += 1) api.fail();
      },
    },
    ready: {
      prepare: ready,
      assert: async (view) => {
        expect(
          await view.findByRole("switch", { name: "Assign new conversations" }),
        ).toBeChecked();
        expect(
          view.getByRole("switch", { name: "Support in the portal" }),
        ).toBeChecked();
        expect(
          view.getByRole("combobox", { name: "Default SLA policy" }),
        ).toHaveTextContent("None");
      },
    },
    done: {
      prepare: () => {
        ready();
        api.reply(updatePortalSettingsFixture.ok());
        api.reply(getPortalSettingsFixture.ok({ supportEnabled: false }));
      },
      act: async (view) => {
        fireEvent.click(
          await view.findByRole("switch", { name: "Support in the portal" }),
        );
      },
      assert: async (view) => {
        await waitFor(() =>
          expect(
            view.getByRole("switch", { name: "Support in the portal" }),
          ).not.toBeChecked(),
        );
        expect(
          await api.calls("updateQuillsPortalSettings")[0]!.json(),
        ).toEqual({ supportEnabled: false });
      },
    },
  });

  it("sets the default SLA policy", async () => {
    ready();
    api.reply(setDefaultSlaPolicyFixture.ok({ policyId: "policy_1" }));
    api.reply(getDefaultSlaPolicyFixture.ok({ policyId: "policy_1" }));
    const view = renderPage(SettingsConversationsGeneralPage, meta);
    await view.findByRole("combobox", { name: "Default SLA policy" });
    await choose("Default SLA policy", "Priority");
    await waitFor(() =>
      expect(api.calls("setQuillsDefaultSlaPolicy")).toHaveLength(1),
    );
    expect(await api.calls("setQuillsDefaultSlaPolicy")[0]!.json()).toEqual({
      policyId: "policy_1",
    });
  });
});
