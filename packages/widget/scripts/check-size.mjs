import { readFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { fileURLToPath } from "node:url";

// Published host-page budget (#316): launcher facade must stay under 15 KB gzipped.
const MAX_SDK_GZIP_BYTES = 15 * 1024;
const sdkPath = fileURLToPath(new URL("../dist/browser.js", import.meta.url));
const raw = readFileSync(sdkPath);
const gzipped = gzipSync(raw, { level: 9 });

console.log(
  `@quills/widget sdk.js: ${raw.byteLength} B raw, ${gzipped.byteLength} B gzipped (budget: ${MAX_SDK_GZIP_BYTES} B)`,
);

if (gzipped.byteLength > MAX_SDK_GZIP_BYTES) {
  console.error(
    `FAIL: sdk.js gzipped size (${gzipped.byteLength} B) exceeds 15 KB budget (${MAX_SDK_GZIP_BYTES} B).`,
  );
  process.exit(1);
}
