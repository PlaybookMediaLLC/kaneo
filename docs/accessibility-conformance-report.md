# Accessibility Conformance Report (WCAG 2.2 AA) — Quills Widget & Portal

**Product:** Kaneo / Quills Support Widget (`@quills/widget`) and Customer Portal (`apps/web`)  
**Standard:** Web Content Accessibility Guidelines (WCAG) 2.2 Level A and Level AA  
**Last Updated:** 2026-11-26  
**Scope:** Embedded host launcher facade, widget iframe views (Home, Messages/Chat, Help Center, Feedback, Updates), and customer portal shell & pages.

---

## Summary of Controls & Conformance

| Criterion | Level | Status | Implementation Notes |
|---|---|---|---|
| **1.1.1 Non-text Content** | A | Supports | Decorative icons use `aria-hidden="true"`; interactive icon buttons carry localized `aria-label`s; portal logos include alt text. |
| **1.3.1 Info and Relationships** | A | Supports | Semantic `<header>`, `<nav>`, `<main>` / `role="main"`, `<footer>`, heading hierarchy, associated form labels, and `role="dialog"` / `role="status"`. |
| **1.4.3 Contrast (Minimum)** | AA | Supports | Automatic WCAG 2.x luminance contrast clamping (`ensureAccessibleForeground` / `ensurePortalThemeContrast`) enforces ≥ 4.5:1 text contrast regardless of workspace brand colors. |
| **1.4.10 Reflow & 1.4.13 Content on Hover or Focus** | AA | Supports | Widget reflows to full-viewport sheet on mobile (`<= 760px`); greeting bubble is dismissible via button (`28×28px`) or `Escape`; launcher and greeting automatically yield (`quackback-occluded`) when overlapping focused host inputs or `[aria-invalid="true"]` / `[role="alert"]` errors. |
| **2.1.1 Keyboard & 2.1.2 No Keyboard Trap** | A | Supports | Every widget and portal action operates via keyboard alone; floating dialog traps Tab/Shift+Tab within the panel while open, closes via `Escape` from anywhere, and restores focus to the triggering element. |
| **2.4.1 Bypass Blocks** | A | Supports | Portal shell renders a keyboard-focusable **Skip to main content** link targeting `#portal-main-content`. |
| **2.4.7 Focus Visible & 2.4.11 Focus Not Obscured** | AA | Supports | Explicit 2px `:focus-visible` rings on all interactive elements (buttons, links, inputs, textareas, selects, `[tabindex]`), plus `@media (forced-colors: active)` Highlight rings and host-form occlusion avoidance. |
| **2.5.8 Target Size (Minimum)** | AA | Supports | Launcher (`40×40px`), panel close (`32×32px`), greeting dismiss (`28×28px`), and widget icon/nav controls meet or exceed the `24×24px` AA target minimum. |
| **4.1.2 Name, Role, Value & 4.1.3 Status Messages** | AA | Supports | Conversation message threads use `role="log" aria-live="polite" aria-relevant="additions text"`; notices use `role="status"`; form errors use `role="alert"`; unread counts update launcher `aria-label`. |

## Automated & Manual Verification

- **Unit & DOM checks:** `packages/widget/__tests__/contrast.test.ts`, `packages/widget/__tests__/wcag.test.tsx`, `apps/web/src/quills/core/contrast.test.ts`.
- **Keyboard & Screen Reader Walkthrough:** Open launcher → dismiss greeting via `Escape` → open widget → tab through Home/Messages/Help/Feedback → submit message → hear incoming reply announced via polite live region → close via `Escape` → verify focus restored to launcher button.
