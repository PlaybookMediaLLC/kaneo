import { empty, fixture } from "../framework/contract";

export const getQuillsBrandingSettings = empty;
export const updateQuillsBrandingSettings = fixture({
  seed: async () => ({}),
  valid: () => ({
    body: {
      customCss: ".portal { color: red; }",
      headerDisplayMode: "logo_only",
    },
  }),
});
