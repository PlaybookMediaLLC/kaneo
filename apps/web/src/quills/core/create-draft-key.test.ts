import { expect, it } from "vite-plus/test";
import { createDraftKey } from "./create-draft-key";
it("creates distinct keys without the secure-context UUID API", () => {
  const descriptor = Object.getOwnPropertyDescriptor(crypto, "randomUUID");
  Object.defineProperty(crypto, "randomUUID", {
    value: undefined,
    configurable: true,
  });
  try {
    const first = createDraftKey();
    expect(first).toMatch(/^[0-9a-f]{32}$/);
    expect(createDraftKey()).not.toBe(first);
  } finally {
    if (descriptor) Object.defineProperty(crypto, "randomUUID", descriptor);
    else Reflect.deleteProperty(crypto, "randomUUID");
  }
});
