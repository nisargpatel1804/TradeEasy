import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import debounce from "lodash.debounce";
import * as api from "../services/api.js";
import {
  SEARCH_CACHE_MAX_ENTRIES,
  SEARCH_DEFAULT_LIMIT,
  SEARCH_MAX_QUERY_LENGTH,
  SEARCH_MIN_QUERY_LENGTH,
  buildSearchCacheKey,
  normalizeSearchQuery,
} from "../constants/search.js";

export const useStockSearch = ({
  minLength = SEARCH_MIN_QUERY_LENGTH,
  maxQueryLength = SEARCH_MAX_QUERY_LENGTH,
  pageSize = SEARCH_DEFAULT_LIMIT,
  onError,
} = {}) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [page, setPage] = useState(1);
  const controllerRef = useRef(null);
  const requestIdRef = useRef(0);
  const cacheRef = useRef(new Map());
  const isLoadingMoreRef = useRef(false);

  const clearResults = useCallback(() => {
    setResults([]);
    setHasMore(false);
    setPage(1);
  }, []);

  const clearSearchCache = useCallback(() => {
    cacheRef.current.clear();
  }, []);

  const setCacheEntry = useCallback((key, value) => {
    const map = cacheRef.current;
    if (map.has(key)) {
      map.delete(key);
    }
    map.set(key, value);
    if (map.size > SEARCH_CACHE_MAX_ENTRIES) {
      const oldestKey = map.keys().next().value;
      if (oldestKey) {
        map.delete(oldestKey);
      }
    }
  }, []);

  const fetchSearch = useCallback(async (rawQuery, { silent = false, targetPage = 1, append = false } = {}) => {
    const q = normalizeSearchQuery(rawQuery, maxQueryLength);
    if (!q || q.length < minLength) {
      if (!silent) {
        clearResults();
        setIsLoading(false);
        setIsLoadingMore(false);
        isLoadingMoreRef.current = false;
      }
      return { success: true, results: [], has_next: false, page: 1, limit: pageSize };
    }

    const cacheKey = buildSearchCacheKey(q, targetPage, pageSize);
    const cached = cacheRef.current.get(cacheKey);
    if (cached) {
      cacheRef.current.delete(cacheKey);
      cacheRef.current.set(cacheKey, cached);
      if (!silent) {
        const items = Array.isArray(cached?.results) ? cached.results : [];
        setResults((prev) => (append ? [...prev, ...items] : items));
        setHasMore(Boolean(cached?.has_next));
        setPage(targetPage);
        if (append) {
          setIsLoadingMore(false);
          isLoadingMoreRef.current = false;
        } else {
          setIsLoading(false);
        }
      }
      return cached;
    }

    if (!silent) {
      if (append) {
        isLoadingMoreRef.current = true;
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }
    }

    const requestId = ++requestIdRef.current;
    if (!silent && !append) {
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
        {
          page: targetPage,
          limit: pageSize,
          signal: silent ? undefined : controllerRef.current?.signal,
        }
      );

      if (!silent && requestId !== requestIdRef.current) {
        return { success: true, results: [], has_next: false, page: targetPage, limit: pageSize };
      }

      const items = Array.isArray(response?.results) ? response.results : [];
      const nextHasMore = Boolean(response?.has_next);

      setCacheEntry(cacheKey, {
        success: response?.success !== false,
        results: items,
        has_next: nextHasMore,
        page: targetPage,
        limit: response?.limit || pageSize,
      });

      if (!silent) {
        setResults((prev) => (append ? [...prev, ...items] : items));
        setHasMore(nextHasMore);
        setPage(targetPage);
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
        setIsLoadingMore(false);
        isLoadingMoreRef.current = false;
      }
      return { success: true, results: [], has_next: false, page: targetPage, limit: pageSize };
    } finally {
      if (!silent) {
        if (append) {
          setIsLoadingMore(false);
          isLoadingMoreRef.current = false;
        } else {
          setIsLoading(false);
        }
      }
    }
  }, [clearResults, maxQueryLength, minLength, onError, pageSize, setCacheEntry]);

  const debouncedSearch = useMemo(() => debounce((value) => {
    fetchSearch(value, { targetPage: 1, append: false });
  }, 300), [fetchSearch]);

  useEffect(() => {
    debouncedSearch(query);
    return () => debouncedSearch.cancel();
  }, [query, debouncedSearch]);

  const loadMore = useCallback(() => {
    if (isLoading || isLoadingMore || isLoadingMoreRef.current || !hasMore) {
      return;
    }
    fetchSearch(query, { targetPage: page + 1, append: true });
  }, [fetchSearch, hasMore, isLoading, isLoadingMore, page, query]);

  // Listen for global clear event to reset results when auth or app state changes.
  useEffect(() => {
    const onClear = () => {
      clearSearchCache();
      clearResults();
    };
    window.addEventListener('clear-local-search-caches', onClear);
    return () => window.removeEventListener('clear-local-search-caches', onClear);
  }, [clearResults, clearSearchCache]);

  return {
    query,
    setQuery,
    results,
    isLoading,
    isLoadingMore,
    hasMore,
    loadMore,
    clearResults,
  };
};
