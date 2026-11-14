import { useRef, type RefObject } from "react";
import type { ParentBridge } from "./bridge.js";

/** Long enough for a large page; an SDK without capture support never answers. */
const TIMEOUT_MS = 20_000;

/**
 * Asks the SDK in the host page for a screenshot of the page (RFC 0003 feature 6). The SDK
 * renders it without the widget and with private fields covered, and answers with a PNG.
 */
export function useHostCapture(bridge: RefObject<ParentBridge | null>) {
  const pending = useRef(new Map<string, (image: Blob | null) => void>());
  const counter = useRef(0);
  return {
    receive(id: string, image: Blob | null) {
      pending.current.get(id)?.(image);
    },
    request(signal: AbortSignal): Promise<File | null> {
      return new Promise((resolve, reject) => {
        if (signal.aborted) return resolve(null);
        const id = `capture-${++counter.current}`;
        const finish = () => {
          pending.current.delete(id);
          clearTimeout(timer);
          signal.removeEventListener("abort", cancel);
        };
        const cancel = () => {
          finish();
          resolve(null);
        };
        const timer = setTimeout(() => {
          finish();
          reject(
            new Error(
              "The page did not send a screenshot. Attach an image instead.",
            ),
          );
        }, TIMEOUT_MS);
        pending.current.set(id, (image) => {
          finish();
          if (image)
            resolve(new File([image], "screenshot.png", { type: "image/png" }));
          else
            reject(
              new Error("Could not capture the page. Attach an image instead."),
            );
        });
        signal.addEventListener("abort", cancel, { once: true });
        bridge.current?.post({ type: "quackback:capture", id });
      });
    },
  };
}
