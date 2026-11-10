import { fixture } from "../framework/contract";
import { image } from "./seed.fixture";

export const createQuillsUpload = fixture({
  seed: async () => ({}),
  valid: () => ({
    body: { purpose: "post_image", filename: "image.png", ...image },
  }),
});

export const createQuillsSettingsUpload = fixture({
  seed: async () => ({}),
  valid: () => ({ body: { purpose: "logo", filename: "logo.png", ...image } }),
});
