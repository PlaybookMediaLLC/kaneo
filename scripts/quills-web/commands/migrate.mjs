import { migrations, runMigrations } from "../lib/migrate.mjs";
export const run = (root, _args, options = {}) =>
  options.list ? migrations() : runMigrations(root);
