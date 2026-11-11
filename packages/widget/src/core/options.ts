import * as z from "zod/mini";

export function isSafeHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

/** A Kaneo workspace ID or slug: one URL path segment. */
export const isWorkspaceRef = (raw: string) =>
  /^[A-Za-z0-9_-]{1,200}$/.test(raw);

export const identitySchema = z.union([
  z.object({ ssoToken: z.string().check(z.minLength(1)) }),
  z.looseObject({
    id: z.string().check(z.minLength(1)),
    email: z.string().check(z.minLength(1)),
    name: z.optional(z.string()),
    avatarURL: z.optional(z.string()),
  }),
  z.object({ anonymous: z.literal(true) }),
]);

export const initOptionsSchema = z.object({
  instanceUrl: z
    .string()
    .check(
      z.refine(isSafeHttpUrl, "Quackback: instanceUrl must be an http(s) URL"),
    ),
  workspace: z
    .string()
    .check(
      z.refine(
        isWorkspaceRef,
        "Quackback: workspace must be a workspace ID or slug",
      ),
    ),
  placement: z.optional(z.enum(["left", "right"])),
  defaultBoard: z.optional(z.string()),
  launcher: z.optional(z.boolean()),
  locale: z.optional(z.string()),
  identity: z.optional(identitySchema),
  tracking: z.optional(z.boolean()),
});

export type RuntimeInitOptions = z.infer<typeof initOptionsSchema>;
