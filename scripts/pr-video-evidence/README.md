# PR Video Evidence Pipeline

Permanent asynchronous verification pipeline for Kaneo and Quills pull requests (see [`AGENTS.md`](../../AGENTS.md) and [`.agents/skills/pr-video-evidence/SKILL.md`](../../.agents/skills/pr-video-evidence/SKILL.md)).

## Setup

Requires Node 24, `ffmpeg`/`ffprobe`, and Chromium/Chrome.

```sh
ONNXRUNTIME_NODE_INSTALL_CUDA=skip npm --prefix scripts/pr-video-evidence ci
```

Setting `ONNXRUNTIME_NODE_INSTALL_CUDA=skip` (also configured in `.npmrc`) ensures local **Kokoro** TTS runs cleanly on CPU without CUDA libraries.

## Usage

1. Start the isolated seeded Kaneo + Quills stack:
   ```sh
   pnpm dev:demo
   ```
2. Record narrated, annotated 1920x1080 @ 30fps H.264/AAC MP4 evidence after independent engineering review completes:
   ```sh
   # Built-in Kaneo board + Quills workspace scenario
   pnpm devx:video-evidence --app kaneo --base-url http://127.0.0.1:5190 \
     --reviewer ponytail-review --reviewer senior-code-critic \
     --review-summary "Independent review completed with zero blocking defects."

   # Built-in Quills portal scenario
   pnpm devx:video-evidence --app quills --base-url http://127.0.0.1:5190 \
     --reviewer ponytail-review --review-summary "Independent review passed."

   # PR-specific Playwright or terminal scenario
   pnpm devx:video-evidence --script path/to/scenario.mjs --base-url http://127.0.0.1:5190 \
     --pr 123 --reviewer ponytail-review --review-summary "Independent review passed."
   ```
3. Outputs are written to `.cache/pr-video-evidence/<timestamp>/` (gitignored):
   - `evidence.mp4` (final 1920x1080 @ 30fps H.264 + AAC video with burned-in captions)
   - `raw/raw-capture.webm` (original raw Playwright capture)
   - `trace.zip` (Playwright trace, strictly local — never commit)
   - `transcript.txt`, `captions.srt`, `captions.vtt`
   - `evidence.json` (evidence manifest) and `evidence.md` (sanitized PR description block)

## TTS providers & human-sounding narration

- **Default**: Local Kokoro (`--tts kokoro`, Grade-A voice `af_heart`, `onnx-community/Kokoro-82M-v1.0-ONNX` full `fp32` precision, `--speed 0.98`), with sentence-level synthesis + natural 220ms breath pauses, spoken-text normalization (keeping written captions exact while expanding shorthand for speech), and broadcast voice loudness mastering (`-16 LUFS`).
- **Optional approved cloud fallback**: `--tts openai` or `--fallback openai` with `OPENAI_API_KEY` (uses `gpt-4o-mini-tts` with conversational engineering-walkthrough instructions and voice `marin`).
- Write narration copy in natural, conversational spoken English (contractions, clear everyday phrasing, no robotic boilerplate or hype).

## Validation & GitHub Actions check

```sh
node --test scripts/pr-video-evidence/*.test.mjs
pnpm devx:video-evidence:validate --manifest .cache/pr-video-evidence/<run>/evidence.json --allow-local-video
pnpm devx:video-evidence:validate --pr-body-file .cache/pr-video-evidence/<run>/evidence.md --pr 123 --head-sha "$(git rev-parse HEAD)"
```

`.github/workflows/pr-video-evidence.yml` exposes the `pr-video-evidence` check (checking out the target base branch's validator so PRs cannot tamper with the check). Once tested and approved by maintainers, add `pr-video-evidence` as a required status check in GitHub branch protection rules for `staging` and `main`.
