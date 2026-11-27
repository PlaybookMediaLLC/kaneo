import { fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vite-plus/test";
import { getWidgetSettingsFixture } from "../../api/team/get-widget-settings.fixture";
import { updateWidgetSettingsFixture } from "../../api/team/update-widget-settings.fixture";
import { choose } from "../../test/actions";
import { describePageContract } from "../../test/contracts";
import { mockApi } from "../../test/mock-api";
import { renderPage } from "../../test/render";
import { meta } from "./meta";
import { SettingsConversationsWidgetPage } from "./settings-conversations-widget-page";

const base = getWidgetSettingsFixture.ok();
const settings = getWidgetSettingsFixture.ok({
  enabled: true,
  position: "bottom-right",
  launcherLabel: "Help",
  launcherGreeting: "Hi",
  tabs: { ...base.tabs, home: true },
  home: { ...base.home, headerStyle: "plain" },
});

let api: ReturnType<typeof mockApi>;

describe("SettingsConversationsWidgetPage", () => {
  describePageContract(meta, SettingsConversationsWidgetPage, {
    loading: { prepare: () => mockApi().defer(() => undefined) },
    failed: { prepare: () => mockApi().fail() },
    ready: {
      prepare: () => mockApi().reply(settings),
      assert: async (view) => {
        expect(
          await view.findByRole("switch", { name: "Widget" }),
        ).toBeChecked();
        expect(view.getByLabelText("Launcher label")).toHaveValue("Help");
        expect(view.getByRole("switch", { name: "Home" })).toBeChecked();
        expect(
          view.getByRole("combobox", { name: "Header style" }),
        ).toHaveTextContent("Plain");
        expect(
          view.getByRole("link", { name: "Open embed & AI setup" }),
        ).toHaveAttribute(
          "href",
          "/feedback/workspace_test_1/share#widget-embed",
        );
      },
    },
    done: {
      prepare: () => {
        api = mockApi();
        api.reply(settings);
        api.reply(updateWidgetSettingsFixture.ok());
        api.reply({ ...settings, tabs: { ...settings.tabs, tickets: true } });
      },
      act: async (view) => {
        fireEvent.click(await view.findByRole("switch", { name: "Tickets" }));
      },
      assert: async (view) => {
        await waitFor(() =>
          expect(view.getByRole("switch", { name: "Tickets" })).toBeChecked(),
        );
        // The API merges the tabs, so one tab is enough.
        expect(
          await api.calls("updateQuillsWidgetSettings")[0]!.json(),
        ).toEqual({ tabs: { tickets: true } });
      },
    },
  });

  it("moves the launcher to the left", async () => {
    api = mockApi();
    api.reply(settings);
    api.reply(updateWidgetSettingsFixture.ok());
    api.reply({ ...settings, position: "bottom-left" });
    const view = renderPage(SettingsConversationsWidgetPage, meta);
    await view.findByRole("combobox", { name: "Position" });
    await choose("Position", "Bottom left");
    await waitFor(() =>
      expect(api.calls("updateQuillsWidgetSettings")).toHaveLength(1),
    );
    expect(await api.calls("updateQuillsWidgetSettings")[0]!.json()).toEqual({
      position: "bottom-left",
    });
  });

  it("sets and clears the team's reply time", async () => {
    api = mockApi();
    api.reply(settings);
    api.reply(updateWidgetSettingsFixture.ok());
    api.reply({ ...settings, replyTime: "hours" });
    const view = renderPage(SettingsConversationsWidgetPage, meta);
    expect(
      await view.findByRole("combobox", { name: "Reply time" }),
    ).toHaveTextContent("Do not show");
    await choose("Reply time", "Within a few hours");
    await waitFor(() =>
      expect(api.calls("updateQuillsWidgetSettings")).toHaveLength(1),
    );
    expect(await api.calls("updateQuillsWidgetSettings")[0]!.json()).toEqual({
      replyTime: "hours",
    });
  });
});
