import { useNavigate } from "@tanstack/react-router";

/** Updates search values in place; an empty value removes its key. */
export function useSearchPatch() {
  const navigate = useNavigate();
  return (patch: Record<string, string | undefined>) =>
    void navigate({
      to: ".",
      search: (previous: Record<string, unknown>) => ({
        ...previous,
        ...Object.fromEntries(
          Object.entries(patch).map(([key, value]) => [
            key,
            value || undefined,
          ]),
        ),
      }),
      replace: true,
      resetScroll: false,
    });
}
