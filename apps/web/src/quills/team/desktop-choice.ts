const KEY = "quills.desktop-notifications";

/** The desktop notification choice of this device. A blocked storage reads as off. */
export function readDesktopChoice() {
  try {
    return window.localStorage.getItem(KEY) === "on";
  } catch {
    return false;
  }
}

export function writeDesktopChoice(on: boolean) {
  try {
    window.localStorage.setItem(KEY, on ? "on" : "off");
  } catch {
    // ponytail: a blocked storage keeps the choice for this page only.
  }
}

/** True when this device chose desktop notifications and the browser allows them. */
export const desktopAllowed = () =>
  "Notification" in window &&
  Notification.permission === "granted" &&
  readDesktopChoice();
