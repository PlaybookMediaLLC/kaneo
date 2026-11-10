import { vi } from "vite-plus/test";

/**
 * The provider HTTP edge for contract checks: a credential check to a fixed provider API host gets a
 * small JSON answer. Every other request goes to the real fetch.
 */
const real = globalThis.fetch;
vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (
    /^(api\.stripe\.com|api\.app\.shortcut\.com|[a-z0-9-]+\.freshdesk\.com)$/.test(
      url.hostname,
    )
  )
    return Response.json({
      name: "Contract desk",
      workspace2: { name: "Contract", url_slug: "contract" },
    });
  return real(input, init);
});
