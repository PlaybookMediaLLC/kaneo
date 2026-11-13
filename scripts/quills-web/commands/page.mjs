import { generatePage } from "../lib/generate.mjs";
export const run = (root, args, options) =>
  generatePage(root, args[0], options);
