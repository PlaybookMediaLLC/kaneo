import { generateOperation } from "../lib/generate.mjs";
export const run = (root, args, options) =>
  generateOperation(root, "mutation", args[0], options);
