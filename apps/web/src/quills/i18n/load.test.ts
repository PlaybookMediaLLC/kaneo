import { describe, expect, it } from "vite-plus/test";
import { i18n } from "../ui/upstream";
import { ensureQuillsI18n } from "./load";

describe("ensureQuillsI18n", () => {
  it("registers the English bundle", async () => {
    await ensureQuillsI18n();
    expect(i18n.hasResourceBundle("en-US", "quills")).toBe(true);
  });

  it("loads integrated page translations", async () => {
    await ensureQuillsI18n();
    expect(i18n.getResource("en-US", "quills", "invite.accept")).toBe(
      "Accept invitation",
    );
    expect(i18n.getResource("en-US", "quills", "csat.ratingScale")).toBe(
      "Choose a rating",
    );
  });

  it("repairs a partial namespace without removing host resources", async () => {
    i18n.removeResourceBundle("en-US", "quills");
    i18n.addResourceBundle(
      "en-US",
      "quills",
      {
        invite: { accept: "Accept invitation" },
        host: { retained: "Host resource" },
      },
      true,
      true,
    );

    await ensureQuillsI18n();

    expect(i18n.getResource("en-US", "quills", "invite.accept")).toBe(
      "Accept invitation",
    );
    expect(i18n.getResource("en-US", "quills", "csat.ratingScale")).toBe(
      "Choose a rating",
    );
    expect(i18n.getResource("en-US", "quills", "host.retained")).toBe(
      "Host resource",
    );
  });
});
