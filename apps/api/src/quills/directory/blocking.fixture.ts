import { fixture } from "../framework/contract";
import { customers } from "./seed.fixture";

const person = fixture({
  seed: customers,
  valid: (ids) => ({ params: { principalId: ids.a } }),
  foreign: (ids) => ({ principalId: ids.b }),
});

export const getQuillsUserBlock = person;
export const blockQuillsUser = person;
export const unblockQuillsUser = person;
