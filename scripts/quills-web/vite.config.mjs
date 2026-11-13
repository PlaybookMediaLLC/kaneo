import { defineConfig } from "vite-plus";

export default defineConfig({
  lint: {
    jsPlugins: ["./lib/rules/plugin.mjs"],
    rules: {
      "quills-web/capture-ast": "warn",
      "quills-web/c3-visible-text": "error",
      "quills-web/c7-raw-fetch": "error",
      "quills-web/c17-default-export": "error",
      "quills-web/c19-inline-style": "error",
    },
  },
});
