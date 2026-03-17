import { useEffect, useMemo, useRef, useState } from "react";
import { getSymbolVariants, pickLivePriceForSymbol } from "../utils/symbolUtils.js";

const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const buildBaseRows = (holdings = [], shortPositions = []) => {
  const longRows = (Array.isArray(holdings) ? holdings : []).map((holding) => ({
    symbol: holding?.symbol || "",
    exchange: holding?.exchange,
    quantity: toNumber(holding?.quantity),
    invested: toNumber(holding?.investment_value, toNumber(holding?.average_price) * toNumber(holding?.quantity)),
    ltp: toNumber(holding?.ltp),
    prevClose: toNumber(holding?.prev_close, toNumber(holding?.ltp)),
    isShort: false,
  }));

  const shortRowsNormalized = (Array.isArray(shortPositions) ? shortPositions : []).map((position) => ({
    symbol: position?.symbol || "",
    exchange: position?.exchange,
    quantity: toNumber(position?.quantity),
    invested: 0,
    ltp: toNumber(position?.ltp),
    prevClose: toNumber(position?.prev_close, toNumber(position?.ltp)),
    isShort: true,
  }));

  return [...longRows, ...shortRowsNormalized].filter((row) => row.symbol && row.quantity > 0);
};

const resolveQuote = (row, livePriceMap = {}) => {
  const live = pickLivePriceForSymbol(livePriceMap, row.symbol, row.exchange);

  const ltp = toNumber(live?.ltp ?? live?.price, row.ltp);
  const change = toNumber(live?.change ?? live?.net_change, NaN);
  const prevCloseFromLive = toNumber(live?.prev_close ?? live?.close, NaN);
  const prevClose = Number.isFinite(prevCloseFromLive)
    ? prevCloseFromLive
    : (Number.isFinite(change) ? (ltp - change) : row.prevClose);

  return {
    ltp: Number.isFinite(ltp) ? ltp : 0,
    prevClose: Number.isFinite(prevClose) ? prevClose : 0,
  };
};

const toContribution = (row, quote) => {
  const qty = row.quantity;
  const current = quote.ltp * qty;

  if (row.isShort) {
    const todays = quote.prevClose > 0 ? ((quote.prevClose - quote.ltp) * qty) : 0;
    return {
      current: 0,
      invested: 0,
      shortUnrealized: current * -1,
      todays,
      prevCloseExposure: quote.prevClose > 0 ? quote.prevClose * qty : 0,
    };
  }

  const todays = quote.prevClose > 0 ? ((quote.ltp - quote.prevClose) * qty) : 0;
  return {
    current,
    invested: row.invested,
    shortUnrealized: 0,
    todays,
    prevCloseExposure: quote.prevClose > 0 ? quote.prevClose * qty : 0,
  };
};

const addContribution = (acc, contribution) => ({
  current: acc.current + contribution.current,
  invested: acc.invested + contribution.invested,
  shortUnrealized: acc.shortUnrealized + contribution.shortUnrealized,
  todays: acc.todays + contribution.todays,
  prevCloseExposure: acc.prevCloseExposure + contribution.prevCloseExposure,
});

const subtractContribution = (acc, contribution) => ({
  current: acc.current - contribution.current,
  invested: acc.invested - contribution.invested,
  shortUnrealized: acc.shortUnrealized - contribution.shortUnrealized,
  todays: acc.todays - contribution.todays,
  prevCloseExposure: acc.prevCloseExposure - contribution.prevCloseExposure,
});

const emptyAggregates = () => ({
  current: 0,
  invested: 0,
  shortUnrealized: 0,
  todays: 0,
  prevCloseExposure: 0,
});

const sameAggregates = (a, b) => (
  a.current === b.current
  && a.invested === b.invested
  && a.shortUnrealized === b.shortUnrealized
  && a.todays === b.todays
  && a.prevCloseExposure === b.prevCloseExposure
);

export const usePortfolioSummary = ({
  baseSummary,
  holdings,
  shortPositions,
  livePriceMap,
  marketStatus,
  lastPriceUpdate,
}) => {
  const [aggregates, setAggregates] = useState(emptyAggregates());
  const rowsRef = useRef([]);
  const contributionBySymbolRef = useRef(new Map());
  const rowKeysByVariantRef = useRef(new Map());

  const marketSession = String(marketStatus?.session || "").toUpperCase();
  const isPreMarket = marketSession === "PRE_MARKET";
  const isMarketOpen = Boolean(marketStatus?.is_market_open) && !Boolean(marketStatus?.is_holiday);

  const rebuildAggregates = (priceMap = {}) => {
    const rows = rowsRef.current;
    contributionBySymbolRef.current = new Map();
    rowKeysByVariantRef.current = new Map();

    const totals = rows.reduce((acc, row) => {
      const quote = resolveQuote(row, priceMap);
      const contribution = toContribution(row, quote);
      acc = addContribution(acc, contribution);

      const key = `${row.isShort ? "S" : "L"}:${row.symbol}`;
      contributionBySymbolRef.current.set(key, { row, contribution });

      const variants = getSymbolVariants(row.symbol, row.exchange);
      variants.forEach((variant) => {
        const bucket = rowKeysByVariantRef.current.get(variant) || [];
        bucket.push(key);
        rowKeysByVariantRef.current.set(variant, bucket);
      });

      return acc;
    }, emptyAggregates());

    setAggregates((previous) => (sameAggregates(previous, totals) ? previous : totals));
  };

  useEffect(() => {
    rowsRef.current = buildBaseRows(holdings, shortPositions);
    rebuildAggregates(livePriceMap);
  }, [holdings, shortPositions]);

  useEffect(() => {
    if (lastPriceUpdate?.type === "snapshot" && lastPriceUpdate?.allPrices) {
      rebuildAggregates(lastPriceUpdate.allPrices);
    }
  }, [lastPriceUpdate]);

  useEffect(() => {
    const changed = lastPriceUpdate?.changedPrices;
    if (!changed || Object.keys(changed).length === 0) {
      return;
    }

    setAggregates((previous) => {
      let next = { ...previous };
      let touched = false;

      const touchedRowKeys = new Set();
      Object.keys(changed).forEach((symbolKey) => {
        const rowKeys = rowKeysByVariantRef.current.get(symbolKey) || [];
        rowKeys.forEach((rowKey) => touchedRowKeys.add(rowKey));
      });

      touchedRowKeys.forEach((key) => {
        const value = contributionBySymbolRef.current.get(key);
        if (!value) {
          return;
        }

        const row = value.row;
        const live = pickLivePriceForSymbol(changed, row.symbol, row.exchange);
        if (!live) {
          return;
        }

        const oldContribution = value.contribution;
        const quote = resolveQuote(row, changed);
        const newContribution = toContribution(row, quote);

        next = subtractContribution(next, oldContribution);
        next = addContribution(next, newContribution);
        contributionBySymbolRef.current.set(key, { row, contribution: newContribution });
        touched = true;
      });

      return touched ? next : previous;
    });
  }, [lastPriceUpdate]);

  return useMemo(() => {
    const summaryInvested = toNumber(baseSummary?.invested_amount, toNumber(baseSummary?.total_investment));
    const summaryCurrent = toNumber(baseSummary?.current_value, toNumber(baseSummary?.holdings_value));
    const summaryTotal = toNumber(baseSummary?.total_pnl);
    const summaryTodays = toNumber(baseSummary?.todays_pnl);
    const summaryPrevCloseExposure = toNumber(baseSummary?.prev_close_exposure);

    if (!isMarketOpen) {
      const investedAmount = summaryInvested;
      const currentValue = summaryCurrent;
      const totalPnl = summaryTotal;
      const todaysPnl = isPreMarket ? 0 : summaryTodays;
      const prevCloseExposure = summaryPrevCloseExposure;

      const totalPnlPct = investedAmount > 0
        ? (totalPnl / investedAmount) * 100
        : toNumber(baseSummary?.total_pnl_pct);
      const todaysPnlPct = prevCloseExposure > 0
        ? (todaysPnl / prevCloseExposure) * 100
        : toNumber(baseSummary?.todays_pnl_pct);

      return {
        currentValue,
        investedAmount,
        todaysPnl,
        todaysPnlPct,
        totalPnl,
        totalPnlPct,
        realizedPnl: toNumber(baseSummary?.realized_pnl),
        unrealizedPnl: toNumber(baseSummary?.unrealized_pnl),
        prevCloseExposure,
        hasStalePrices: Boolean(baseSummary?.has_stale_prices),
        priceAsof: baseSummary?.price_asof || null,
        marketSession,
        isPreMarket,
      };
    }

    const hasAggregateRows = rowsRef.current.length > 0;
    const investedAmount = hasAggregateRows
      ? aggregates.invested
      : summaryInvested;
    const currentValue = hasAggregateRows
      ? aggregates.current
      : summaryCurrent;
    const realized = toNumber(baseSummary?.realized_pnl);
    const shortPnl = toNumber(baseSummary?.unrealized_pnl) - (toNumber(baseSummary?.holdings_value) - toNumber(baseSummary?.total_investment));

    const effectiveShort = Number.isFinite(shortPnl) ? shortPnl : aggregates.shortUnrealized;
    const unrealized = (currentValue - investedAmount) + effectiveShort;
    const totalPnl = realized + unrealized;

    const backendTodays = toNumber(baseSummary?.todays_pnl);
    const todaysPnl = isPreMarket ? 0 : (Number.isFinite(backendTodays) ? backendTodays : aggregates.todays);

    const prevCloseExposure = toNumber(baseSummary?.prev_close_exposure, aggregates.prevCloseExposure);
    const todaysPnlPct = prevCloseExposure > 0 ? (todaysPnl / prevCloseExposure) * 100 : 0;
    const totalPnlPct = investedAmount > 0 ? (totalPnl / investedAmount) * 100 : 0;

    return {
      currentValue,
      investedAmount,
      todaysPnl,
      todaysPnlPct,
      totalPnl,
      totalPnlPct,
      realizedPnl: realized,
      unrealizedPnl: unrealized,
      prevCloseExposure,
      hasStalePrices: Boolean(baseSummary?.has_stale_prices),
      priceAsof: baseSummary?.price_asof || null,
      marketSession,
      isPreMarket,
    };
  }, [aggregates, baseSummary, isMarketOpen, isPreMarket, marketSession]);
};

export default usePortfolioSummary;
