import { brandResources } from "@kaneo/branding";
import { i18n } from "../ui/upstream";

const bundles = import.meta.glob<Record<string, unknown>>("./en-US/*.json", {
  eager: true,
  import: "default",
});

// Every feature contributes its own translation file.
function buildBundle(): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(bundles).map(([path, value]) => [
      path.slice(path.lastIndexOf("/") + 1, -5),
      brandResources(value),
    ]),
  );
}

export function ensureQuillsI18n(): Promise<void> {
  // The shared i18n instance can retain an empty or partial namespace after a
  // test or host reload. Merge every feature chunk so namespace presence alone
  // cannot leave portal copy unresolved.
  i18n.addResourceBundle("en-US", "quills", buildBundle(), true, true);
  return Promise.resolve();
}

i18n.on("languageChanged", () => {
  void ensureQuillsI18n();
});
