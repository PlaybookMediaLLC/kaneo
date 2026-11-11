import { fixture } from "../../framework/contract";
import { bothSides, finishedExport, finishedImport } from "./seed.fixture";

export const listQuillsExportRuns = fixture({
  seed: (env, caller) => bothSides(env, caller, finishedExport),
  valid: () => ({ query: { limit: "10" } }),
});
export const listQuillsImportRuns = fixture({
  seed: (env, caller) => bothSides(env, caller, finishedImport),
  valid: () => ({ query: { limit: "10" } }),
});
