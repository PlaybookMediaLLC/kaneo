import { describe, expect, it } from "vite-plus/test";
import { ensureQuillsI18n } from "../i18n/load";
import { i18n } from "./upstream";
import { SURVEY_STATUS_KEYS, SURVEY_TYPE_KEYS } from "./survey-labels";

describe("survey labels", () => {
  it("names every survey type and status in English", async () => {
    await ensureQuillsI18n();
    const t = i18n.getFixedT("en-US", "quills");
    for (const key of [
      ...Object.values(SURVEY_TYPE_KEYS),
      ...Object.values(SURVEY_STATUS_KEYS),
    ])
      expect(t(key)).not.toBe(key);
    expect(Object.keys(SURVEY_TYPE_KEYS)).toEqual([
      "nps",
      "csat",
      "ces",
      "pmf",
      "poll",
      "open",
    ]);
  });
});
