import { fixture } from "../framework/contract";
import { seed, type Ids } from "./seed.fixture";

const all = fixture({ seed, valid: () => ({}) });
const onAddress = (extra: object = {}) =>
  fixture({
    seed,
    valid: (ids: Ids) => ({
      params: { channelAccountId: ids.a.addressId },
      ...extra,
    }),
    foreign: (ids: Ids) => ({ channelAccountId: ids.b.addressId }),
  });
const onDomain = (key: "domainId" | "unusedDomainId") =>
  fixture({
    seed,
    valid: (ids: Ids) => ({ params: { sendingDomainId: ids.a[key] } }),
    foreign: (ids: Ids) => ({ sendingDomainId: ids.b[key] }),
  });

export const getQuillsEmailChannelConfig = all;
export const setQuillsInboundForwarding = fixture({
  seed,
  valid: () => ({ body: { forwardingTarget: "Help@Example.test" } }),
});
export const clearQuillsInboundForwarding = all;
export const setQuillsInboundTrust = fixture({
  seed,
  valid: () => ({ body: { inboundTrust: "lenient" } }),
});
export const createQuillsSendingAddress = fixture({
  seed,
  valid: ({ a }: Ids) => ({
    body: { address: `news@new-${a.domainName}`, module: "changelog" },
  }),
});
export const setQuillsSendingAddressSmtp = onAddress({
  body: {
    smtp: {
      host: "smtp.example.test",
      port: 587,
      secure: false,
      user: "mailer",
    },
  },
});
export const deleteQuillsChannelAccount = onAddress();
export const deleteQuillsSendingDomain = onDomain("unusedDomainId");
export const restartQuillsSendingDomainChecks = onDomain("domainId");
export const listQuillsRecentEmailLog = all;
