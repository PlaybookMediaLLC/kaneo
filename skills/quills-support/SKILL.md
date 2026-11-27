---
name: quills-support
description: Integrate Kaneo's Quills support & feedback widget (live chat, help center, feedback, roadmap, changelog, signed identity, and portal SSO) into any web application safely and verify it end-to-end. Use when the user asks to add Kaneo or Quills support, feedback widget, help widget, or customer portal integration to an app, or gives you a `qbi_` widget install pairing code.
---

# Quills Support & Feedback Integration

Integrate Kaneo's embeddable Quills widget into a host web app cleanly, securely, and with full verification.

## 1. Gather or redeem workspace configuration

- If the user gave a short-lived pairing code (`qbi_…`), redeem it immediately (works twice, expires in 15 minutes, and turns the widget on):

  ```sh
  curl -fsS -X POST "<API_BASE>/quills-public/<WORKSPACE>/widget/install-context" \
    -H "Content-Type: application/json" \
    -d '{"code":"<PAIRING_CODE>"}'
  ```

  The JSON response contains:
  - `signingSecret` — HMAC-SHA256 key (`wgt_…`) for server-side JWT signing
  - `tabs` — which widget surfaces are enabled (`home`, `messenger`, `feedback`, `changelog`, `help`, `tickets`)
  - `portalEnabled`, `widgetSignIn` — whether customer portal handoff is on
  - `userAttributes` — defined custom attributes (`[{ key, label, type }]`)
  - `manualSegments` — defined manual segments (`[{ slug, name }]`)

- If the user did not provide a pairing code, check existing env vars or ask for the Kaneo API URL, workspace slug, and either a pairing code (from **Share › Widget embed › Create install code**) or the server-only widget secret (from **Settings › Login**).

## 2. Secret hygiene (non-negotiable)

- Store `signingSecret` **only** in a server-side environment variable (`QUILLS_WIDGET_SECRET`) inside a gitignored file (e.g. `.env.local`).
- Store non-secret public settings in `NEXT_PUBLIC_QUILLS_URL` / `VITE_QUILLS_URL` and `NEXT_PUBLIC_QUILLS_WORKSPACE` / `VITE_QUILLS_WORKSPACE`.
- Never place `QUILLS_WIDGET_SECRET` in `NEXT_PUBLIC_*`, `VITE_*`, `PUBLIC_*`, client components, git commits, or printed stdout/logs.
- Never call `Quills("identify", { id, email })` with unsigned claims — the widget refuses unsigned identity client-side and requires a server-signed HS256 JWT.

## 3. Wire server-side identity signing

Inspect the target app's authentication layer (Better Auth, Clerk, Auth.js / NextAuth, Supabase Auth, custom session middleware, or Go/Express backend) and add a dedicated, uncached endpoint (e.g. `GET /api/support/token`):

- Unauthenticated request → `204 No Content` with `Cache-Control: private, no-store`.
- Authenticated request → sign an HS256 JWT with `QUILLS_WIDGET_SECRET` using stdlib HMAC-SHA256 (`node:crypto` or Go `crypto/hmac` — avoid adding new JWT libraries):
  - Required claims: `sub` (stable user ID), `email`, `iat` (Unix seconds), `exp` (`<= iat + 3600`, prefer `iat + 600`).
  - Optional claims: `name`, `avatarURL`, `companies: [{ id, name, domain? }]` (`domain` is optional — omit if unavailable).
  - Custom attributes & segments: **only** include attribute keys present in `userAttributes` and segment slugs present in `manualSegments` from step 1 so `identify` emits zero warnings.
- Return `200` JSON `{ token }` with `Cache-Control: private, no-store`.

## 4. Mount the client widget

- Prefer the same-origin reverse-proxy pattern when the host framework supports rewrites (in Next.js, place `/api/quills-public/:path*` → `<API_BASE>/quills-public/:path*` in `rewrites().beforeFiles` so catch-all `app/api/[...unmatched]` routes do not intercept it). This bypasses ad blockers and avoids cross-origin CSP/COEP friction across all browsers.
- Otherwise load `<API_BASE>/quills-public/<WORKSPACE>/widget/sdk.js` directly (Kaneo serves `Cross-Origin-Resource-Policy: cross-origin` and adds `credentialless` to the iframe under `crossOriginIsolated` for Chromium; pages with `COEP: require-corp` in Firefox/Safari should use the same-origin proxy above).
- Create a single client component mounted in the root app layout:
  1. Exclude iframe-only/headless routes (such as `/embed/*` or `/preview/*`) where a floating launcher should not appear; on client-side navigation into excluded routes call `Quills("close")` and `Quills("hideLauncher")`, and `Quills("showLauncher")` when leaving them.
  2. Install the queue stub before loading `sdk.js`:
     `window.Quills = window.Quills || function(){ (window.Quills.q = window.Quills.q || []).push(arguments) };`
  3. Call `Quills("init", { placement, theme, locale, tracking })` (or let `sdk.js` auto-init when default options suffice).
  4. Sync live app state without re-initializing:
     - Theme toggle (`next-themes`, CSS class): `Quills("setTheme", "light" | "dark" | "auto")`
     - Language switcher (`next-intl`, i18next): `Quills("setLocale", locale)`
     - Cookie consent banner: `Quills("tracking", granted)`
  5. Sync auth state:
     - Signed in → fetch `/api/support/token` and call `Quills("identify", { ssoToken: token })`
     - Signed out → call `Quills("logout")`
  6. If the app sends a strict `Content-Security-Policy`, allow `style-src 'unsafe-inline'` for widget shell styles, `img-src data:` for screenshot feedback, and the Kaneo origin in `script-src`, `frame-src`, and `connect-src` when not using the same-origin proxy.

## 5. Verify before finishing

1. **Public widget availability:**
   ```sh
   curl -fsS "<API_BASE>/quills-public/<WORKSPACE>/widget/config.json"
   ```
   Confirm `"enabled": true`.
2. **Dry-run JWT verification (zero DB writes, creates no test user):**
   Sign a test payload using the app's new signing helper and verify it:
   ```sh
   curl -fsS -X POST "<API_BASE>/quills-public/<WORKSPACE>/widget/verify-token" \
     -H "Content-Type: application/json" \
     -d '{"ssoToken":"<SAMPLE_JWT>"}'
   ```
   Confirm HTTP `200`, `"valid": true`, and `"warnings": []`.
3. **App checks:** Run the app's typecheck/lint/unit tests and, when a dev server is running, verify the launcher appears, opens the panel, and logs zero console or CSP/COEP errors.
