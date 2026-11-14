import { afterEach, describe, expect, it, vi } from "vite-plus/test";
import {
  desktopAllowed,
  readDesktopChoice,
  writeDesktopChoice,
} from "./desktop-choice";

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("desktop choice", () => {
  it("keeps the choice of this device", () => {
    expect(readDesktopChoice()).toBe(false);
    writeDesktopChoice(true);
    expect(readDesktopChoice()).toBe(true);
    writeDesktopChoice(false);
    expect(readDesktopChoice()).toBe(false);
  });

  it("allows desktop notifications only with the choice and the browser permission", () => {
    vi.stubGlobal("Notification", { permission: "granted" });
    expect(desktopAllowed()).toBe(false);
    writeDesktopChoice(true);
    expect(desktopAllowed()).toBe(true);
    vi.stubGlobal("Notification", { permission: "denied" });
    expect(desktopAllowed()).toBe(false);
  });
});
