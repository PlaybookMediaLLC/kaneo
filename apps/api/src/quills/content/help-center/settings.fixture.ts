import { empty, fixture } from "../../framework/contract";
import { germanEnabled } from "./seed.fixture";

const chrome = {
  homepageTitle: "Aide",
  homepageDescription: "",
  searchPlaceholder: "Rechercher",
};

export const getQuillsHelpCenterSettings = empty;
export const updateQuillsHelpCenterSettings = fixture({
  seed: germanEnabled,
  valid: () => ({
    body: { homepageTitle: "Help", autoTranslate: { enabled: true } },
  }),
});
export const enableQuillsHelpCenterLocale = fixture({
  seed: germanEnabled,
  valid: () => ({ body: { locale: "fr", chrome } }),
});
export const updateQuillsHelpCenterLocaleChrome = fixture({
  seed: germanEnabled,
  valid: () => ({
    body: { locale: "de", chrome: { homepageTitle: "Hilfe!" } },
  }),
});
export const disableQuillsHelpCenterLocale = fixture({
  seed: germanEnabled,
  valid: () => ({ query: { locale: "de" } }),
});
