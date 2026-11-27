import { brandResources } from "@kaneo/branding";
import { i18n } from "../ui/upstream";

const bundles = import.meta.glob<Record<string, unknown>>("./en-US/*.json", {
  eager: true,
  import: "default",
});

// Every feature contributes its own translation file; compute the branded bundle once.
let cachedBundle: Record<string, unknown> | null = null;

function getBundle(): Record<string, unknown> {
  if (!cachedBundle) {
    cachedBundle = Object.fromEntries(
      Object.entries(bundles).map(([path, value]) => [
        path.slice(path.lastIndexOf("/") + 1, -5),
        brandResources(value),
      ]),
    );
  }
  return cachedBundle;
}

export function ensureQuillsI18n(): Promise<void> {
  const bundle = getBundle();
  // The shared i18n instance can retain an empty or partial namespace after a
  // test or host reload. Skip deep-merging when every feature chunk is present.
  if (
    Object.keys(bundle).every(
      (feature) => i18n.getResource("en-US", "quills", feature) !== undefined,
    )
  ) {
    return Promise.resolve();
  }
  i18n.addResourceBundle("en-US", "quills", bundle, true, true);
  return Promise.resolve();
}

i18n.on("languageChanged", () => {
  void ensureQuillsI18n();
});
