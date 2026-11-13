import { mkdir } from "node:fs/promises";
import { launchBrowser, saveFailure } from "@kaneo/browser-test";

export const tls = process.env.KANEO_E2E_TLS === "true";
export const origin = tls
  ? "https://localhost:18174"
  : "http://localhost:18173";
export async function runBrowser(name, run) {
  const browser = await launchBrowser({ ignoreHTTPSErrors: tls });
  let page;
  try {
    page = await browser.newPage();
    await run({ browser, page });
  } catch (error) {
    const directory = new URL(`../../.cache/e2e/${name}/`, import.meta.url)
      .pathname;
    await mkdir(directory, { recursive: true });
    if (page) await saveFailure(browser, page, directory);
    throw error;
  } finally {
    await browser.close();
  }
}
