"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  resolveIsDark,
  setSiteTheme,
  THEME_CHANGE_EVENT,
  THEME_STORAGE_KEY,
} from "@/lib/theme";
import { cn } from "@/lib/utils";

export function DocsThemeToggle({ className }: { className?: string }) {
  const [isDark, setIsDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setIsDark(resolveIsDark());
    const onStorage = (event: StorageEvent) => {
      if (event.key === null || event.key === THEME_STORAGE_KEY) {
        sync();
      }
    };

    sync();
    setMounted(true);
    media.addEventListener("change", sync);
    window.addEventListener(THEME_CHANGE_EVENT, sync);
    window.addEventListener("storage", onStorage);
    return () => {
      media.removeEventListener("change", sync);
      window.removeEventListener(THEME_CHANGE_EVENT, sync);
      window.removeEventListener("storage", onStorage);
    };
  }, []);

  const handleToggle = () => {
    const nextIsDark = setSiteTheme(isDark ? "light" : "dark");
    setIsDark(nextIsDark);
  };

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={
        mounted
          ? isDark
            ? "Switch to light mode"
            : "Switch to dark mode"
          : "Toggle theme"
      }
      onClick={handleToggle}
      className={cn("text-muted-foreground hover:text-foreground", className)}
    >
      {mounted && isDark ? (
        <Sun className="size-4" />
      ) : (
        <Moon className="size-4" />
      )}
    </Button>
  );
}
