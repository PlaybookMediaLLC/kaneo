import { fixture } from "../framework/contract";
import { seed, type Ids } from "./seed.fixture";

const all = fixture({ seed, valid: () => ({}) });
const onPolicy = (
  extra: object = {},
  key: "policyId" | "archivedPolicyId" = "policyId",
) =>
  fixture({
    seed,
    valid: (ids: Ids) => ({ params: { slaPolicyId: ids.a[key] }, ...extra }),
    foreign: (ids: Ids) => ({ slaPolicyId: ids.b[key] }),
  });

export const listQuillsSlaPolicies = all;
export const listQuillsSlaPolicyOptions = all;
export const getQuillsSlaOfficeHours = all;
export const createQuillsSlaPolicy = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    body: {
      name: "Gold",
      firstResponseTargetSecs: 600,
      officeHoursScheduleId: a.scheduleId,
    },
  }),
  foreign: ({ b }: Ids) => ({ officeHoursScheduleId: b.scheduleId }),
});
export const updateQuillsSlaPolicy = onPolicy({
  body: { nextResponseTargetSecs: 7200 },
});
export const archiveQuillsSlaPolicy = onPolicy();
export const restoreQuillsSlaPolicy = onPolicy({}, "archivedPolicyId");
export const getQuillsDefaultSlaPolicy = all;
export const setQuillsDefaultSlaPolicy = fixture({
  seed,
  valid: ({ a }: Ids) => ({ body: { policyId: a.policyId } }),
  foreign: ({ b }: Ids) => ({ policyId: b.policyId }),
});
