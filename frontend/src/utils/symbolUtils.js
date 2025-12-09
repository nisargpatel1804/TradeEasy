const DEFAULT_SUFFIXES = ["", ".NSE", ".NS", ".BSE"];

export const normalizeSymbol = (symbol = "") => symbol.toUpperCase().trim();

export const getSymbolVariants = (rawSymbol = "", exchange) => {
  const variants = new Set();
  const normalized = normalizeSymbol(rawSymbol);
  if (!normalized) {
    return [];
  }

  const baseSymbol = normalized.includes(".") ? normalized.split(".")[0] : normalized;
  const sanitizedBase = baseSymbol.replace(/-EQ$/i, "");

  variants.add(normalized);
  variants.add(baseSymbol);
  variants.add(sanitizedBase);

  DEFAULT_SUFFIXES.forEach((suffix) => {
    if (suffix) {
      variants.add(`${sanitizedBase}${suffix}`);
    }
  });

  if (exchange) {
    variants.add(`${sanitizedBase}.${exchange.toUpperCase()}`);
  }

  return Array.from(variants).filter(Boolean);
};

export const pickLivePriceForSymbol = (priceMap = {}, rawSymbol = "", exchange) => {
  if (!priceMap) {
    return null;
  }

  const variants = getSymbolVariants(rawSymbol, exchange);
  for (const key of variants) {
    if (priceMap[key]) {
      return priceMap[key];
    }
  }

  return null;
};

export const mergePriceMapWithVariants = (currentMap = {}, incomingMap = {}) => {
  if (!incomingMap || Object.keys(incomingMap).length === 0) {
    return currentMap;
  }

  const next = { ...currentMap };
  Object.entries(incomingMap).forEach(([symbolKey, payload = {}]) => {
    if (!symbolKey) {
      return;
    }

    const variants = getSymbolVariants(symbolKey, payload.exchange || payload.market || payload.exchange_code);
    variants.forEach((variant) => {
      next[variant] = { ...payload, symbol: variant };
    });
  });
  return next;
};

export const seedPriceMapFromHoldings = (holdings = []) => {
  const seed = {};
  holdings.forEach((holding = {}) => {
    if (!holding.symbol) {
      return;
    }
    const variants = getSymbolVariants(holding.symbol, holding.exchange);
    variants.forEach((variant) => {
      seed[variant] = {
        symbol: variant,
        ltp: holding.ltp,
      };
    });
  });
  return seed;
};
