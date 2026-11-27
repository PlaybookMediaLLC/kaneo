"use client";

import type { SharedProps } from "fumadocs-ui/contexts/search";
import { CornerDownLeft, FileText, Loader2, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Dialog,
  DialogDescription,
  DialogPopup,
  DialogTitle,
} from "@/components/ui/dialog";
import { Kbd } from "@/components/ui/kbd";
import {
  type DocsSearchEntry,
  DocsSearchEntrySchema,
  filterIndexedDocsPages,
  type IndexedDocsSearchEntry,
  indexDocsSearchEntries,
} from "@/lib/docs/search-filter";
import { cn } from "@/lib/utils";

let cachedIndexedEntries: IndexedDocsSearchEntry[] | null = null;
let inflightRequest: Promise<IndexedDocsSearchEntry[]> | null = null;

async function loadSearchIndex(): Promise<IndexedDocsSearchEntry[]> {
  if (cachedIndexedEntries) return cachedIndexedEntries;
  if (!inflightRequest) {
    inflightRequest = fetch("/docs/search-index.json")
      .then((res) => {
        if (!res.ok)
          throw new Error(`Failed to load search index (${res.status})`);
        return res.json();
      })
      .then((json) => {
        const parsed = DocsSearchEntrySchema.array().parse(json);
        cachedIndexedEntries = indexDocsSearchEntries(parsed);
        return cachedIndexedEntries;
      })
      .catch((error) => {
        inflightRequest = null;
        throw error;
      });
  }
  return inflightRequest;
}

function getInitialQueryFromUrl(): string {
  if (typeof window === "undefined") return "";
  const params = new URLSearchParams(window.location.search);
  return params.get("q") ?? params.get("search") ?? "";
}

function syncQueryToUrl(query: string) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  const trimmed = query.trim();
  if (trimmed) {
    url.searchParams.set("q", trimmed);
    url.searchParams.delete("search");
  } else {
    url.searchParams.delete("q");
    url.searchParams.delete("search");
  }
  window.history.replaceState(window.history.state, "", url.toString());
}

export default function DocsSearchDialog({ open, onOpenChange }: SharedProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState("");
  const [indexed, setIndexed] = useState<IndexedDocsSearchEntry[]>(
    () => cachedIndexedEntries ?? [],
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (!open) return;
    const urlQuery = getInitialQueryFromUrl();
    if (urlQuery) {
      setQuery(urlQuery);
    }

    if (!cachedIndexedEntries) {
      setLoading(true);
      setError(null);
      loadSearchIndex()
        .then((entries) => {
          setIndexed(entries);
        })
        .catch(() => {
          setError("Could not load search index. Please try again.");
        })
        .finally(() => {
          setLoading(false);
        });
    }

    const focusTimer = window.setTimeout(() => {
      inputRef.current?.focus();
    }, 10);
    return () => window.clearTimeout(focusTimer);
  }, [open]);

  const results: DocsSearchEntry[] = useMemo(() => {
    const matched = filterIndexedDocsPages(indexed, query);
    return query.trim() ? matched.slice(0, 20) : matched.slice(0, 10);
  }, [indexed, query]);

  useEffect(() => {
    setActiveIndex(0);
  }, [query, open]);

  const handleQueryChange = (next: string) => {
    setQuery(next);
    syncQueryToUrl(next);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      syncQueryToUrl("");
    }
    onOpenChange(nextOpen);
  };

  const navigateToResult = (entry: DocsSearchEntry) => {
    syncQueryToUrl("");
    onOpenChange(false);
    router.push(entry.url);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((prev) =>
        results.length > 0 ? (prev + 1) % results.length : 0,
      );
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((prev) =>
        results.length > 0 ? (prev - 1 + results.length) % results.length : 0,
      );
    } else if (event.key === "Enter" && results[activeIndex]) {
      event.preventDefault();
      navigateToResult(results[activeIndex]);
    }
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogPopup
        showCloseButton={false}
        className="max-w-xl gap-0 overflow-hidden p-0"
      >
        <DialogTitle className="sr-only">Search documentation</DialogTitle>
        <DialogDescription className="sr-only">
          Search across documentation pages, guides, and API references.
        </DialogDescription>

        <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
          <Search
            aria-hidden="true"
            className="size-4 shrink-0 text-muted-foreground"
          />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => handleQueryChange(event.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search documentation..."
            aria-label="Search documentation"
            className="h-8 w-full bg-transparent text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
          />
          {query ? (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => handleQueryChange("")}
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
          <Kbd className="shrink-0 border border-border bg-muted px-1.5 text-[0.6875rem]">
            Esc
          </Kbd>
        </div>

        <div className="fd-scroll-container max-h-[min(24rem,60vh)] overflow-y-auto p-2">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
              <Loader2 className="size-4 animate-spin" />
              <span>Loading search index...</span>
            </div>
          ) : error ? (
            <div className="py-10 text-center text-sm text-destructive-foreground">
              {error}
            </div>
          ) : results.length === 0 ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              No documentation pages matched &ldquo;{query.trim()}&rdquo;.
            </div>
          ) : (
            <ul aria-label="Search results" className="space-y-1">
              {results.map((entry, idx) => {
                const selected = idx === activeIndex;
                return (
                  <li key={entry.id}>
                    <button
                      type="button"
                      aria-current={selected ? "true" : undefined}
                      onMouseEnter={() => setActiveIndex(idx)}
                      onClick={() => navigateToResult(entry)}
                      className={cn(
                        "flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors",
                        selected
                          ? "bg-accent text-accent-foreground"
                          : "hover:bg-accent/60",
                      )}
                    >
                      <FileText
                        aria-hidden="true"
                        className="mt-0.5 size-4 shrink-0 text-muted-foreground"
                      />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <span className="truncate text-sm font-medium text-foreground">
                            {entry.title}
                          </span>
                          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[0.6875rem] font-medium text-muted-foreground">
                            {entry.section}
                          </span>
                        </div>
                        {entry.description ? (
                          <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                            {entry.description}
                          </p>
                        ) : null}
                      </div>
                      {selected ? (
                        <CornerDownLeft
                          aria-hidden="true"
                          className="mt-1 size-3.5 shrink-0 text-muted-foreground"
                        />
                      ) : null}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-border bg-muted/40 px-3.5 py-2 text-[0.6875rem] text-muted-foreground">
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1">
              <Kbd className="h-4 min-w-4 border border-border bg-background px-1 text-[0.625rem]">
                ↑
              </Kbd>
              <Kbd className="h-4 min-w-4 border border-border bg-background px-1 text-[0.625rem]">
                ↓
              </Kbd>
              Navigate
            </span>
            <span className="inline-flex items-center gap-1">
              <Kbd className="h-4 min-w-4 border border-border bg-background px-1 text-[0.625rem]">
                ↵
              </Kbd>
              Open
            </span>
          </div>
          <span>{results.length} results</span>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
