import { fixture } from "../framework/contract";
import "./seed.fixture";

/** A TEST-NET-3 literal: a public address that needs no DNS lookup. */
export const saveQuillsNtfy = fixture({
  seed: async () => ({}),
  valid: () => ({
    body: { url: "https://203.0.113.10/contract_topic", token: "tk_contract" },
  }),
});
