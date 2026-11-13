import { generateType } from "../lib/generate.mjs";
export const run = (root, args, options) =>
  generateType(root, args[0], options);
