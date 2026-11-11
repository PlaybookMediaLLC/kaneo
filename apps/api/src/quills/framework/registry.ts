import type { AnyQuillsRoute } from "./define-route";

/** Every Quills route declaration and the handler mounted for it. Route modules fill it when they load. */
export const registry = new Map<AnyQuillsRoute, unknown>();
