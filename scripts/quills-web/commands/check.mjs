import { checkConformance } from "../lib/rules/check.mjs";

export async function run(root, _args, options = {}) {
  return checkConformance(root, options.rule);
}
