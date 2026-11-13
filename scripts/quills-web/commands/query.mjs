import { generateOperation } from "../lib/generate.mjs";
export const run = (root, args, options) =>
  generateOperation(root, "query", args[0], options);
