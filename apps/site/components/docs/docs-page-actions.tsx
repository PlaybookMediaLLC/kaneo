"use client";

import { Check, Copy, FileText } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export function DocsPageActions({ rawUrl }: { rawUrl: string }) {
  const [status, setStatus] = useState<"idle" | "copied" | "error">("idle");

  const handleCopy = async () => {
    try {
      const response = await fetch(rawUrl);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const markdown = await response.text();
      await navigator.clipboard.writeText(markdown);
      setStatus("copied");
      window.setTimeout(() => setStatus("idle"), 2000);
    } catch {
      setStatus("error");
      window.setTimeout(() => setStatus("idle"), 2000);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        variant="outline"
        size="xs"
        onClick={handleCopy}
        className="text-muted-foreground hover:text-foreground"
      >
        {status === "copied" ? (
          <>
            <Check className="size-3.5" />
            Copied Markdown
          </>
        ) : status === "error" ? (
          <>
            <Copy className="size-3.5" />
            Copy failed
          </>
        ) : (
          <>
            <Copy className="size-3.5" />
            Copy Markdown
          </>
        )}
      </Button>
      <Button
        variant="ghost"
        size="xs"
        className="text-muted-foreground hover:text-foreground"
        render={<a href={rawUrl} target="_blank" rel="noopener noreferrer" />}
      >
        <FileText className="size-3.5" />
        View Markdown
      </Button>
    </div>
  );
}
