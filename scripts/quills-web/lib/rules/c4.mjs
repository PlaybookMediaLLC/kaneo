import { valueOf, nameOf } from "./ast.mjs";
function flatten(value, prefix = "") {
  return Object.entries(value).flatMap(([k, v]) =>
    v && typeof v === "object"
      ? flatten(v, `${prefix}${k}.`)
      : [`${prefix}${k}`],
  );
}
// i18next resolves t("feature.key", { count }) to key_one, key_other and the other CLDR forms.
const plural = /_(?:zero|one|two|few|many|other)$/;
export function check({ documents, report }) {
  const keys = new Map(),
    used = new Set();
  for (const d of documents.filter((d) =>
    /\/i18n\/en-US\/[^/]+\.json$/.test(d.file),
  )) {
    const feature = d.file.split("/").at(-1).slice(0, -5);
    for (const key of flatten(JSON.parse(d.code)))
      keys.set(`${feature}.${key}`, d);
  }
  for (const d of documents.filter((d) => d.kind !== "test"))
    for (const { node } of d.nodes) {
      let key;
      const literal = valueOf(node);
      if (
        typeof literal === "string" &&
        (literal.startsWith("quills:") ||
          [...keys.keys()].some((k) =>
            literal.startsWith(k.split(".")[0] + "."),
          ))
      )
        key = literal;
      if (node.type === "CallExpression" && nameOf(node.callee) === "t")
        key = valueOf(node.arguments[0]);
      if (
        node.type === "JSXAttribute" &&
        /(?:Key|i18nKey)$/.test(node.name.name)
      )
        key = valueOf(node.value?.expression ?? node.value);
      if (typeof key !== "string") continue;
      key = key.replace(/^quills:/, "");
      used.add(key);
      if (!keys.has(key) && !keys.has(`${key}_other`))
        report("C4", d, node, `Add the translation key ${key}.`);
    }
  for (const [key, d] of keys)
    if (!used.has(key) && !used.has(key.replace(plural, "")))
      report("C4", d, 1, `Use or remove the translation key ${key}.`);
}
