import { useEffect, useRef, useState } from "react";
import type { SearchResults, SearchCategory } from "@/types";

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:8000";

const EMPTY: SearchResults = {
  q: "",
  vessels: [],
  events: [],
  locations: [],
  intelligence: [],
  places: [],
  counts: { vessels: 0, events: 0, locations: 0, intelligence: 0, places: 0 },
};

/** Debounced global search. With `type` set, fetches a deeper slice of one
 *  category (for that tab / "See more"); otherwise every group, capped. */
export function useSearch(
  q: string,
  type: SearchCategory | null,
): { results: SearchResults; loading: boolean } {
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [loading, setLoading] = useState(false);
  const reqId = useRef(0);

  useEffect(() => {
    const query = q.trim();
    if (query.length < 2) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    const id = ++reqId.current;
    setLoading(true);
    const timer = setTimeout(() => {
      const params = new URLSearchParams({ q: query });
      if (type) {
        params.set("type", type);
        params.set("limit", "30");
      }
      fetch(`${API_URL}/api/search?${params}`)
        .then((r) => r.json())
        .then((d: SearchResults) => {
          if (id !== reqId.current) return;
          setResults(d);
          setLoading(false);
        })
        .catch(() => {
          if (id === reqId.current) setLoading(false);
        });
    }, 180);
    return () => clearTimeout(timer);
  }, [q, type]);

  return { results, loading };
}
