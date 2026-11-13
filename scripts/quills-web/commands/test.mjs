import { generateMissingTest } from "../lib/generate.mjs";
export const run = (root, args) => generateMissingTest(root, args[0]);
