import { expect, it, vi } from "vite-plus/test";
import { renderQuillsHook } from "../test/render";
import { useSearchPatch } from "./use-search-patch";

const navigate = vi.hoisted(() => vi.fn());
vi.mock("@tanstack/react-router", async () => ({
  ...(await vi.importActual<typeof import("@tanstack/react-router")>(
    "@tanstack/react-router",
  )),
  useNavigate: () => navigate,
}));

it("sets and removes search values in place", () => {
  const { result } = renderQuillsHook(() => useSearchPatch(), {
    initialProps: {},
  });
  result.current({ sort: "newest", title: "", stage: undefined });
  const options = navigate.mock.calls.at(-1)![0];
  expect(
    options.search({ sort: "votes", title: "Dark mode", stage: "planned" }),
  ).toEqual({ sort: "newest", title: undefined, stage: undefined });
  expect(options).toMatchObject({ replace: true, resetScroll: false });
});
