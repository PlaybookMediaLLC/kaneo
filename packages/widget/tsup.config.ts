import { copyFileSync, mkdirSync } from "node:fs";
import { defineConfig } from "tsup";

const BANNER =
  "/*! @quills/widget | Based on @quackback/widget, Copyright (c) 2026 Quackback Ltd | MIT License: https://github.com/QuackbackIO/quackback/blob/main/packages/widget/LICENSE */";

export default defineConfig([
  // Library build — ESM + CJS + declarations.
  // Both module formats share chunks, including the singleton used by React.
  {
    entry: {
      index: "src/index.ts",
      "react/index": "src/react/index.ts",
      "ui/index": "src/ui/index.ts",
      version: "src/version.ts",
    },
    format: ["esm", "cjs"],
    splitting: true,
    // Declarations come from `tsc --emitDeclarationOnly` (TypeScript 7).
    // tsup's dts worker still imports the old compiler API (`ts.sys`).
    dts: false,
    sourcemap: true,
    target: "es2020",
    clean: true,
    env: { QUILLS_BROWSER_IIFE: "false" },
    external: ["react", "react/jsx-runtime"],
  },
  // Browser IIFE facade — served verbatim by /api/quills-public/{workspace}/widget/sdk.js (#316).
  // Zero runtime dependencies bundled: html-to-image loads on demand from capture.js.
  {
    entry: { browser: "src/browser-queue.ts" },
    format: ["iife"],
    globalName: "QuillsBundle",
    env: { QUILLS_BROWSER_IIFE: "true" },
    esbuildPlugins: [
      {
        name: "strip-html-to-image",
        setup(build) {
          build.onResolve({ filter: /^html-to-image$/ }, () => ({
            path: "html-to-image",
            namespace: "quills-lazy-capture",
          }));
          build.onLoad(
            { filter: /.*/, namespace: "quills-lazy-capture" },
            () => ({
              contents: "export const toCanvas = undefined;",
              loader: "js",
            }),
          );
        },
      },
    ],
    minify: true,
    banner: { js: BANNER },
    sourcemap: false,
    target: "es2020",
    outExtension: () => ({ js: ".js" }),
  },
  // On-demand screenshot capture chunk — loaded only when the visitor clicks "Capture screenshot" (#316).
  {
    entry: { capture: "src/core/capture-chunk.ts" },
    format: ["iife"],
    env: { QUILLS_BROWSER_IIFE: "false" },
    noExternal: [/^html-to-image$/],
    minify: true,
    banner: { js: BANNER },
    sourcemap: false,
    target: "es2020",
    outExtension: () => ({ js: ".js" }),
  },
  // The iframe page — served with host.css by /api/quills-public/{workspace}/widget.
  // Font is emitted as an external immutable asset (dist/fonts/inter-latin.woff2) instead of
  // base64-inlined into host.css (#316).
  {
    entry: { host: "src/adapter/host.tsx" },
    format: ["iife"],
    platform: "browser",
    noExternal: [/./],
    env: { NODE_ENV: "production" },
    minify: true,
    esbuildOptions: (options) => {
      options.charset = "utf8";
      options.external = [...(options.external ?? []), "*.woff2"];
    },
    banner: { js: BANNER },
    sourcemap: false,
    target: "es2020",
    outExtension: () => ({ js: ".js" }),
    onSuccess: async () => {
      mkdirSync("dist/fonts", { recursive: true });
      copyFileSync(
        "src/ui/fonts/inter-latin.woff2",
        "dist/fonts/inter-latin.woff2",
      );
    },
  },
]);
