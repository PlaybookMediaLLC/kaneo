import { describe } from "vite-plus/test";
import { describeRouteContract } from "./contracts";

describe("route contract", () => {
  describeRouteContract({
    Route: {
      options: {
        component: () => null,
        validateSearch: {
          parse: (value: unknown) => ({
            offset: Number((value as { offset: string }).offset),
          }),
        },
      },
    },
    validSearch: { offset: "20" },
    expectedSearch: { offset: 20 },
  });
});
