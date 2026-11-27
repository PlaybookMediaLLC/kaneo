"use client";

import { useSearchContext } from "fumadocs-ui/contexts/search";
import { useEffect } from "react";

export function DocsSearchQuerySync() {
  const { setOpenSearch } = useSearchContext();

  useEffect(() => {
    const checkQuery = () => {
      const params = new URLSearchParams(window.location.search);
      const q = (params.get("q") ?? params.get("search") ?? "").trim();
      if (q) {
        setOpenSearch(true);
      }
    };

    checkQuery();
    window.addEventListener("popstate", checkQuery);
    return () => window.removeEventListener("popstate", checkQuery);
  }, [setOpenSearch]);

  return null;
}
