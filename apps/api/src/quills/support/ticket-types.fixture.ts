import { fixture } from "../framework/contract";
import { seed, type Ids } from "./seed.fixture";

const onType = (
  extra: object = {},
  key: "ticketTypeId" | "archivedTypeId" = "ticketTypeId",
) =>
  fixture({
    seed,
    valid: (ids: Ids) => ({ params: { ticketTypeId: ids.a[key] }, ...extra }),
    foreign: (ids: Ids) => ({ ticketTypeId: ids.b[key] }),
  });

export const listQuillsTicketTypes = fixture({
  seed,
  valid: () => ({ query: { includeArchived: "true" } }),
});
export const createQuillsTicketType = fixture({
  seed,
  valid: () => ({
    body: {
      name: "Question",
      category: "back_office",
      isDefault: true,
      fields: [
        {
          key: "area",
          label: "Area",
          type: "text",
          required: false,
          visibleToCustomer: false,
          order: 0,
        },
      ],
    },
  }),
});
export const updateQuillsTicketType = onType({
  body: { name: "Defect", isDefault: true },
});
export const archiveQuillsTicketType = onType();
export const restoreQuillsTicketType = onType({}, "archivedTypeId");
