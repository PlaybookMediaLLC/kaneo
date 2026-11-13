import { generateRedirect } from "../lib/generate.mjs";
export const run = (root, args) => generateRedirect(root, args[0], args[1]);
