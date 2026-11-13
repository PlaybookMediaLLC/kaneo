import { z } from "../../openapi";
import { parseJson, record, settingsArea, str } from "./area";

// Routes come from settingsArea, which declares them with ../framework/define-route.
// Theme, custom CSS and the header text. Logo and favicon keys belong to the files routes.

const colorKeys = [
  "background",
  "foreground",
  "card",
  "cardForeground",
  "popover",
  "popoverForeground",
  "primary",
  "primaryForeground",
  "secondary",
  "secondaryForeground",
  "muted",
  "mutedForeground",
  "accent",
  "accentForeground",
  "accentInk",
  "destructive",
  "destructiveForeground",
  "border",
  "input",
  "ring",
  "success",
  "sidebarBackground",
  "sidebarForeground",
  "sidebarPrimary",
  "sidebarPrimaryForeground",
  "sidebarAccent",
  "sidebarAccentForeground",
  "sidebarBorder",
  "sidebarRing",
  "chart1",
  "chart2",
  "chart3",
  "chart4",
  "chart5",
  "fontSans",
  "shadow2xs",
  "shadowXs",
  "shadowSm",
  "shadow",
  "shadowMd",
  "shadowLg",
  "shadowXl",
  "shadow2xl",
  "radius",
] as const;
// Theme values become CSS custom properties: they cannot close a declaration or a tag.
const cssValue = z
  .string()
  .max(300)
  .regex(/^[^;{}<>]*$/, "Not a CSS value");
/** The theme shape over one value schema: strict for writes, plain for stored reads. */
const themeOf = <V extends z.ZodString>(value: V, preset: z.ZodString) => {
  const colors = z.object(
    Object.fromEntries(colorKeys.map((key) => [key, value.optional()])) as {
      [K in (typeof colorKeys)[number]]: z.ZodOptional<V>;
    },
  );
  return z.object({
    preset: preset.optional(),
    themeMode: z.enum(["light", "dark", "user"]).optional(),
    light: colors.optional(),
    dark: colors.optional(),
  });
};
const theme = themeOf(cssValue, z.string().max(64));
const displayModes = ["logo_and_name", "logo_only", "custom_logo"] as const;

const readColors = (value: unknown) =>
  Object.fromEntries(
    colorKeys.flatMap((key) => {
      const color = str(record(value)[key]);
      return color === undefined ? [] : [[key, color]];
    }),
  );

/** Receipt fields: what this area writes. Logo and favicon keys belong to the files routes. */
export const brandingReceipt = [
  "brandingConfig",
  "customCss",
  "headerDisplayMode",
  "headerDisplayName",
] as const;

export default settingsArea({
  name: "branding",
  title: "Branding",
  label: "branding",
  response: z.object({
    theme: themeOf(z.string(), z.string()),
    customCss: z.string(),
    headerDisplayMode: z.string(),
    headerDisplayName: z.string().nullable(),
  }),
  read: (row) => {
    const config = parseJson(row.brandingConfig);
    const mode = config.themeMode;
    return {
      theme: {
        preset: str(config.preset),
        themeMode:
          mode === "light" || mode === "dark" || mode === "user"
            ? (mode as "light" | "dark" | "user")
            : undefined,
        light: config.light ? readColors(config.light) : undefined,
        dark: config.dark ? readColors(config.dark) : undefined,
      },
      customCss: row.customCss ?? "",
      headerDisplayMode: row.headerDisplayMode ?? "logo_and_name",
      headerDisplayName: row.headerDisplayName,
    };
  },
  patch: z.object({
    /** Replaces the whole theme. */
    theme: theme.optional(),
    customCss: z
      .string()
      .max(50 * 1024)
      .optional(),
    headerDisplayMode: z.enum(displayModes).optional(),
    headerDisplayName: z.string().trim().max(100).nullable().optional(),
  }),
  receipt: brandingReceipt,
  apply: (_row, patch) => ({
    brandingConfig: patch.theme && JSON.stringify(patch.theme),
    customCss: patch.customCss,
    headerDisplayMode: patch.headerDisplayMode,
    headerDisplayName:
      patch.headerDisplayName === undefined
        ? undefined
        : patch.headerDisplayName || null,
  }),
});
