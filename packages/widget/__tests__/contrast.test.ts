// @vitest-environment happy-dom
import { describe, expect, it, beforeEach } from "vite-plus/test";
import {
  contrastRatio,
  ensureAccessibleForeground,
  ensureSurfaceContrast,
  parseHexColor,
} from "../src/core/contrast";
import { createLauncher } from "../src/core/launcher";

describe("WCAG 2.2 AA color contrast helpers (#317)", () => {
  it("guarantees >= 4.5:1 contrast for any admin-picked brand color", () => {
    const brandColors = [
      "#ffff00", // bright yellow
      "#ffffff", // pure white
      "#000000", // pure black
      "#ff6b6b", // coral red
      "#38bdf8", // sky blue
      "#a855f7", // purple
      "#22c55e", // green
      "#f59e0b", // amber
      "#7c3aed", // violet
      "#e5e7eb", // light gray
    ];
    for (const bg of brandColors) {
      const fg = ensureAccessibleForeground(bg, "#9ca3af", 4.5);
      const ratio = contrastRatio(parseHexColor(fg)!, parseHexColor(bg)!);
      expect(ratio, `bg=${bg} fg=${fg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("preserves preferred foreground when it already passes AA", () => {
    expect(ensureAccessibleForeground("#111827", "#ffffff", 4.5)).toBe(
      "#ffffff",
    );
    expect(ensureAccessibleForeground("#ffffff", "#111827", 4.5)).toBe(
      "#111827",
    );
  });

  it("adjusts low-contrast surface accents to meet 3:1 UI contrast", () => {
    const adjusted = ensureSurfaceContrast("#d1d5db", "#ffffff", 3.0)!;
    const ratio = contrastRatio(
      parseHexColor(adjusted)!,
      parseHexColor("#ffffff")!,
    );
    expect(ratio).toBeGreaterThanOrEqual(3.0);
  });
});

describe("launcher WCAG 2.2 AA guarantees (#317)", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    sessionStorage.clear();
  });

  it("auto-adjusts launcher foreground color when admin picks low-contrast brand colors", () => {
    const launcher = createLauncher({ placement: "right", onClick: () => {} });
    launcher.setColors({
      backgroundColor: "#ffff00",
      foregroundColor: "#ffffff",
    });
    // Should never keep white on yellow (~1.07:1); auto-adjusts to high-contrast dark ink.
    const fg = launcher.el.style.color;
    expect(fg).not.toBe("rgb(255, 255, 255)");
    expect(fg).not.toBe("#ffffff");
  });

  it("gives the greeting dismiss button >= 24x24px target size and role=status", () => {
    const launcher = createLauncher({ placement: "right", onClick: () => {} });
    launcher.setGreeting("Need help?");
    const bubble = document.querySelector(".quackback-bubble") as HTMLElement;
    expect(bubble.getAttribute("role")).toBe("status");
    expect(bubble.getAttribute("aria-live")).toBe("polite");
    const closeBtn = bubble.lastElementChild as HTMLButtonElement;
    expect(Number.parseInt(closeBtn.style.width, 10)).toBeGreaterThanOrEqual(
      24,
    );
    expect(Number.parseInt(closeBtn.style.height, 10)).toBeGreaterThanOrEqual(
      24,
    );
  });

  it("announces unread count in launcher aria-label while closed", () => {
    const launcher = createLauncher({ placement: "right", onClick: () => {} });
    launcher.setUnread(3);
    expect(launcher.el.getAttribute("aria-label")).toContain("3 unread");
    launcher.setUnread(0);
    expect(launcher.el.getAttribute("aria-label")).toBe("Open feedback widget");
  });

  it("hides launcher/greeting when overlapping a focused host form input or error", () => {
    const launcher = createLauncher({ placement: "right", onClick: () => {} });
    launcher.reveal();
    launcher.setGreeting("Hi!");
    const bubble = document.querySelector(".quackback-bubble") as HTMLElement;
    const input = document.createElement("input");
    input.type = "email";
    document.body.appendChild(input);

    const overlapRect = {
      left: 100,
      top: 100,
      right: 160,
      bottom: 140,
      width: 60,
      height: 40,
    } as DOMRect;
    launcher.el.getBoundingClientRect = () => overlapRect;
    bubble.getBoundingClientRect = () => overlapRect;
    input.getBoundingClientRect = () => overlapRect;

    input.dispatchEvent(new FocusEvent("focusin", { bubbles: true }));
    expect(launcher.el.classList.contains("quackback-occluded")).toBe(true);
    expect(bubble.classList.contains("quackback-occluded")).toBe(true);

    input.dispatchEvent(new FocusEvent("focusout", { bubbles: true }));
    expect(launcher.el.classList.contains("quackback-occluded")).toBe(false);
    expect(bubble.classList.contains("quackback-occluded")).toBe(false);
  });
});
