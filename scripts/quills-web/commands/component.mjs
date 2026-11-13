import { generateComponent } from "../lib/generate.mjs";
export const run = (root, args, options) =>
  generateComponent(root, "component", args[0], options);
