export const SEARCH_MIN_QUERY_LENGTH = 2;
export const SEARCH_MAX_QUERY_LENGTH = 64;
export const SEARCH_DEFAULT_LIMIT = 15;
export const SEARCH_CACHE_MAX_ENTRIES = 120;

export const normalizeSearchQuery = (value, maxLength = SEARCH_MAX_QUERY_LENGTH) => {
  const normalized = String(value || "").trim().replace(/\s+/g, " ");
  if (normalized.length > maxLength) {
    return normalized.slice(0, maxLength);
  }
  return normalized;
};

export const buildSearchCacheKey = (query, pageToken = "", limit = SEARCH_DEFAULT_LIMIT) => (
  `${normalizeSearchQuery(query)}::${String(pageToken || "")}::${Math.max(1, Number(limit) || SEARCH_DEFAULT_LIMIT)}`
);