const { brand, brandResources, brandText } = require("./index.cjs");

const omittedDocs = new Set([
  "core/deployments/railway",
  "core/installation/drim",
  "core/installation/drim-migration",
]);

function isOmittedDoc(page) {
  return (
    omittedDocs.has(page) ||
    (!brand.npmScope && page === "core/integrations/mcp")
  );
}

function brandDocsConfig(config) {
  const result = brandResources(config);
  if (/kaneo/i.test(JSON.stringify(config.analytics ?? {})))
    delete result.analytics;
  if (/kaneo/i.test(JSON.stringify(config.integrations?.plausible ?? {})))
    delete result.integrations.plausible;
  if (/usekaneo/i.test(result.footer?.socials?.x ?? ""))
    delete result.footer.socials.x;
  if (/usekaneo/i.test(result.seo?.metatags?.["twitter:site"] ?? ""))
    delete result.seo.metatags["twitter:site"];
  function navigation(value) {
    if (Array.isArray(value))
      return value
        .filter((item) => !isOmittedDoc(item))
        .map(navigation)
        .filter((item) => !item?.pages || item.pages.length);
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, child]) => [key, navigation(child)]),
      );
    return value;
  }
  result.navigation = navigation(result.navigation);
  return result;
}

function brandMarkdown(source) {
  const markdown = brand.npmScope
    ? source
    : source.replace(/\n## Install with npm[\s\S]*?(?=\n## |$)/g, "");
  return brandText(
    markdown
      .replace(
        /^.*id6828574501.*$/gm,
        brand.appStoreUrl
          ? `Download the mobile app from the [App Store](${brand.appStoreUrl}).`
          : "Mobile app distribution is supplied by your instance operator.",
      )
      .replace(/\n## Install with Homebrew[\s\S]*?(?=\n## |$)/g, "")
      .replace(
        /^.*https:\/\/github\.com\/usekaneo\/homebrew-tap.*(?:\n|$)/gm,
        "",
      )
      .replace(
        /<Card\b[^>]*href=["'][^"']*(?:installation\/drim|deployments\/railway)[^"']*["'][^>]*>[\s\S]*?<\/Card>/g,
        "",
      )
      .replace(
        /^.*\]\([^)]*\/(?:installation\/drim(?:-migration)?|deployments\/railway)[^)]*\).*(?:\n|$)/gm,
        "",
      ),
  );
}

exports.omittedDocs = omittedDocs;
exports.isOmittedDoc = isOmittedDoc;
exports.brandDocsConfig = brandDocsConfig;
exports.brandMarkdown = brandMarkdown;
