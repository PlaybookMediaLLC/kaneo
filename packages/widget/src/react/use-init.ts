import { useEffect, useRef } from "react";
import Quills from "../index.js";
import type { InitOptions, Identity } from "../types.js";

export interface UseQuillsInitOptions extends Omit<InitOptions, "identity"> {
  identity?: Identity;
  /** Skip init while `false`. Flipping to `true` later inits on that render. */
  shouldInitialize?: boolean;
  /** Defer init by N milliseconds after mount (for perf). */
  initializeDelay?: number;
}

/**
 * Boots the Quills widget when the host component mounts, and tears it
 * down on unmount. Identity changes (by structural equality via JSON key) fire
 * a follow-up `identify` call, and `theme`, `locale`, and `tracking` changes
 * sync live without remounting. Instance URL, workspace, enablement, and delay
 * changes restart initialization. Other options are read when startup runs.
 * Identity removal selects anonymous mode.
 */
export function useQuillsInit(options: UseQuillsInitOptions): void {
  const {
    identity,
    shouldInitialize,
    initializeDelay,
    instanceUrl,
    workspace,
    theme,
    locale,
    tracking,
  } = options;
  const shouldInit = shouldInitialize !== false;
  const startedRef = useRef(false);
  const appliedIdentity = useRef<string | null>(null);
  const appliedTheme = useRef(theme);
  const appliedLocale = useRef(locale);
  const appliedTracking = useRef(tracking);

  // Latest options live in a ref so the effect below can read current values
  // at startup time without adding every field to its dependency array.
  const optsRef = useRef(options);
  optsRef.current = options;

  useEffect(() => {
    if (!shouldInit) return;

    let cancelled = false;
    let started = false;

    const start = () => {
      if (cancelled) return;
      const latest = optsRef.current;
      const { shouldInitialize: _s, initializeDelay: _d, ...init } = latest;
      Quills.init(init);
      started = true;
      startedRef.current = true;
      appliedIdentity.current =
        latest.identity === undefined ? null : JSON.stringify(latest.identity);
      appliedTheme.current = latest.theme;
      appliedLocale.current = latest.locale;
      appliedTracking.current = latest.tracking;
    };

    if (initializeDelay && initializeDelay > 0) {
      const id = setTimeout(start, initializeDelay);
      return () => {
        cancelled = true;
        clearTimeout(id);
        startedRef.current = false;
        if (started) Quills.destroy();
      };
    }
    start();
    return () => {
      startedRef.current = false;
      if (started) Quills.destroy();
    };
  }, [instanceUrl, workspace, shouldInit, initializeDelay]);

  // Structural key for identity — a stable-shape object won't retrigger even
  // if the reference changes each render.
  const identityKey = identity === undefined ? null : JSON.stringify(identity);
  const identityRef = useRef(identity);
  identityRef.current = identity;

  useEffect(() => {
    if (
      !shouldInit ||
      !startedRef.current ||
      identityKey === appliedIdentity.current
    )
      return;
    Quills.identify(identityRef.current);
    appliedIdentity.current = identityKey;
  }, [identityKey, shouldInit]);

  useEffect(() => {
    if (!shouldInit || !startedRef.current || theme === appliedTheme.current)
      return;
    appliedTheme.current = theme;
    if (theme !== undefined) Quills.setTheme(theme);
  }, [theme, shouldInit]);

  useEffect(() => {
    if (!shouldInit || !startedRef.current || locale === appliedLocale.current)
      return;
    appliedLocale.current = locale;
    if (locale !== undefined) Quills.setLocale(locale);
  }, [locale, shouldInit]);

  useEffect(() => {
    if (
      !shouldInit ||
      !startedRef.current ||
      tracking === appliedTracking.current
    )
      return;
    appliedTracking.current = tracking;
    if (tracking !== undefined) Quills.tracking(tracking);
  }, [tracking, shouldInit]);
}
