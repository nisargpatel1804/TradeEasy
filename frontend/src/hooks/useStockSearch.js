import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import debounce from "lodash.debounce";
import * as api from "../services/api.js";

const normalizeQuery = (value) => (value || "").trim().replace(/\s+/g, " ");

export const useStockSearch = ({
  minLength = 2,
  maxQueryLength = 64,
  onError,
} = {}) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const controllerRef = useRef(null);
  const requestIdRef = useRef(0);

  const clearResults = useCallback(() => {
    setResults([]);
  }, []);

  const fetchSearch = useCallback(async (rawQuery, { silent = false } = {}) => {
    const normalized = normalizeQuery(rawQuery);
    const q = normalized.length > maxQueryLength ? normalized.slice(0, maxQueryLength) : normalized;
    if (!q || q.length < minLength) {
      if (!silent) {
        clearResults();
        setIsLoading(false);
      }
      return { results: [] };
    }

    if (!silent) {
      setIsLoading(true);
    }

    const requestId = ++requestIdRef.current;
    if (!silent) {
      try {
        controllerRef.current?.abort();
      } catch (err) {
        console.debug("Search abort failed", err);
      }
      controllerRef.current = new AbortController();
    }

    try {
      const response = await api.searchStocks(
        q,
        { signal: silent ? undefined : controllerRef.current?.signal }
      );

      if (!silent && requestId !== requestIdRef.current) {
        return { results: [] };
      }

      const items = Array.isArray(response) ? response : (response.results || []);

      if (!silent) {
        setResults(items);
      }

      return response;
    } catch (error) {
      const isAbort = error?.name === "AbortError" || error?.code === "ERR_CANCELED" || error?.name === "CanceledError";
      if (isAbort) {
        return { results: [] };
      }
      if (typeof onError === "function") {
        onError(error);
      }
      if (!silent) {
        clearResults();
      }
      if (!silent) {
        setIsLoading(false);
      }
      return { results: [] };
    } finally {
      if (!silent) {
        setIsLoading(false);
      }
    }
  }, [clearResults, maxQueryLength, minLength, onError]);

  const debouncedSearch = useMemo(() => debounce((value) => {
    fetchSearch(value);
  }, 300), [fetchSearch]);

  useEffect(() => {
    debouncedSearch(query);
    return () => debouncedSearch.cancel();
  }, [query, debouncedSearch]);

  // Listen for global clear event to reset results when auth or app state changes.
  useEffect(() => {
    const onClear = () => clearResults();
    window.addEventListener('clear-local-search-caches', onClear);
    return () => window.removeEventListener('clear-local-search-caches', onClear);
  }, [clearResults]);

  return {
    query,
    setQuery,
    results,
    isLoading,
    clearResults,
  };
};
