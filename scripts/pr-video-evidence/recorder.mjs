import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  clearAnnotations,
  highlightLocator,
  installOverlay,
  moveAndClick,
} from "./overlay.mjs";
import { renderEvidenceVideo } from "./render.mjs";
import { synthesizeSteps } from "./tts.mjs";

const SYSTEM_BROWSERS = [
  process.env.PR_VIDEO_CHROME_PATH,
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
].filter(Boolean);

function resolveBrowserExecutable() {
  for (const candidate of SYSTEM_BROWSERS) {
    if (existsSync(candidate)) return candidate;
  }
  return undefined;
}

export async function recordScenario({
  scenario,
  baseUrl,
  outputDir,
  ttsProvider = "kokoro",
  ttsVoice,
  ttsFallback,
  width = 1920,
  height = 1080,
  fps = 30,
}) {
  if (
    !scenario ||
    !Array.isArray(scenario.steps) ||
    scenario.steps.length === 0
  ) {
    throw new Error("Scenario must export a non-empty steps array.");
  }

  const rawDir = join(outputDir, "raw");
  const audioDir = join(outputDir, "audio");
  const tracePath = join(outputDir, "trace.zip");
  const rawVideoPath = join(rawDir, "raw-capture.webm");
  await mkdir(rawDir, { recursive: true });
  await mkdir(audioDir, { recursive: true });

  console.log(
    `[video-evidence] Synthesizing ${scenario.steps.length} narration clips via ${ttsProvider}...`,
  );
  const clips = await synthesizeSteps(scenario.steps, audioDir, {
    provider: ttsProvider,
    voice: ttsVoice,
    fallback: ttsFallback,
  });

  const { chromium } = await import("playwright-core");
  const executablePath = resolveBrowserExecutable();
  const useNoSandbox =
    Boolean(process.env.CI) ||
    process.env.PR_VIDEO_NO_SANDBOX === "1" ||
    existsSync("/.dockerenv") ||
    process.getuid?.() === 0;

  const browser = await chromium.launch({
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: [
      ...(useNoSandbox ? ["--no-sandbox"] : []),
      "--disable-dev-shm-usage",
    ],
  });

  const onSignal = () => {
    void browser.close().catch(() => {});
  };
  process.once("SIGINT", onSignal);
  process.once("SIGTERM", onSignal);

  let context = null;
  let page = null;
  let videoHandle = null;
  let tracingStarted = false;
  let videoSaved = false;
  const timeline = [];
  const assertionLog = [];
  const state = {};
  let passedAssertions = 0;
  let failedAssertions = 0;

  const assert = (condition, description) => {
    if (!condition) {
      failedAssertions += 1;
      assertionLog.push({ description, status: "failed" });
      throw new Error(`Live verification assertion failed: ${description}`);
    }
    passedAssertions += 1;
    assertionLog.push({ description, status: "passed" });
  };

  try {
    context = await browser.newContext({
      viewport: { width, height },
      deviceScaleFactor: 1,
      colorScheme: "light",
      locale: "en-US",
      timezoneId: "UTC",
      recordVideo: {
        dir: rawDir,
        size: { width, height },
      },
    });

    await installOverlay(context);
    await context.tracing.start({
      screenshots: true,
      snapshots: true,
      sources: true,
    });
    tracingStarted = true;

    page = await context.newPage();
    videoHandle = page.video();
    const recordStartMs = Date.now();

    const helpers = {
      assert,
      highlight: (locator, label) => highlightLocator(page, locator, label),
      moveAndClick: (locator, opts) => moveAndClick(page, locator, opts),
      clearAnnotations: () => clearAnnotations(page),
    };

    if (typeof scenario.setup === "function") {
      await scenario.setup({ page, context, baseUrl, state, helpers });
    }

    for (let i = 0; i < scenario.steps.length; i += 1) {
      const step = scenario.steps[i];
      const clip = clips[i];
      if (typeof step.prepare === "function") {
        await step.prepare({ page, context, baseUrl, state, helpers });
      }
      const stepStartMs = Date.now() - recordStartMs;
      console.log(
        `[video-evidence] Step ${i + 1}/${scenario.steps.length} (${step.id}) at ${(stepStartMs / 1000).toFixed(1)}s — audio ${clip.durationSeconds.toFixed(1)}s`,
      );

      await step.run({ page, context, baseUrl, state, helpers });

      const elapsedMs = Date.now() - recordStartMs - stepStartMs;
      const targetMs = Math.ceil(clip.durationSeconds * 1000) + 450;
      if (elapsedMs < targetMs) {
        await page.waitForTimeout(targetMs - elapsedMs);
      }

      timeline.push({
        stepId: step.id,
        narration: clip.narration,
        audioPath: clip.path,
        startMs: stepStartMs,
        durationSeconds: clip.durationSeconds,
      });
    }

    await clearAnnotations(page);
    await page.waitForTimeout(600);
  } finally {
    process.off("SIGINT", onSignal);
    process.off("SIGTERM", onSignal);
    if (tracingStarted && context) {
      await context.tracing.stop({ path: tracePath }).catch(() => {});
    }
    if (page) {
      await page.close().catch(() => {});
    }
    if (videoHandle) {
      await videoHandle
        .saveAs(rawVideoPath)
        .then(async () => {
          videoSaved = true;
          await videoHandle.delete().catch(() => {});
        })
        .catch(() => {});
    }
    if (context) {
      await context.close().catch(() => {});
    }
    await browser.close().catch(() => {});
  }

  if (!videoSaved) {
    throw new Error(
      "Playwright did not produce a finalized raw video recording.",
    );
  }

  console.log(
    "[video-evidence] Rendering narrated 1920x1080 H.264/AAC MP4 with burned-in captions...",
  );
  const rendered = await renderEvidenceVideo({
    rawVideoPath,
    timeline,
    outputDir,
    width,
    height,
    fps,
  });

  const firstClip = clips[0];
  return {
    ...rendered,
    rawVideoPath,
    tracePath,
    timeline,
    assertions: {
      passed: passedAssertions,
      failed: failedAssertions,
      skipped: 0,
      live: assertionLog,
    },
    video: {
      ...rendered.video,
      path: rendered.mp4Path,
      ttsProvider: firstClip.provider,
      ttsVoice: firstClip.voice,
    },
  };
}
