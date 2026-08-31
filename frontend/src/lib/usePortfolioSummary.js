import { useMemo } from "react";
import { pickLivePriceForSymbol } from "./symbolUtils.js";

const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export const usePortfolioSummary = ({
  baseSummary,
  holdings = [],
  shortPositions = [],
  livePriceMap = {},
  marketStatus,
}) => {
  const marketSession = String(marketStatus?.session || "").toUpperCase();
  const isPreMarket = marketSession === "PRE_MARKET";

  return useMemo(() => {
    const summaryInvested = toNumber(baseSummary?.invested_amount, toNumber(baseSummary?.total_investment));
    const summaryCurrent = toNumber(baseSummary?.current_value, toNumber(baseSummary?.holdings_value));
    const summaryTotal = toNumber(baseSummary?.total_pnl);
    const backendTodays = toNumber(baseSummary?.todays_pnl);
    const summaryPrevCloseExposure = toNumber(baseSummary?.prev_close_exposure);
    const longRows = Array.isArray(holdings) ? holdings : [];
    const shortRows = Array.isArray(shortPositions) ? shortPositions : [];

    // Fall back to backend summary when rows are not available.
    if (longRows.length === 0 && shortRows.length === 0) {
      const investedAmount = summaryInvested;
      const currentValue = summaryCurrent;
      const totalPnl = summaryTotal;
      const todaysPnl = isPreMarket ? 0 : backendTodays;
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

    const longAgg = longRows.reduce((acc, holding) => {
      const qty = toNumber(holding?.quantity);
      if (qty <= 0 || !holding?.symbol) {
        return acc;
      }

      const invested = toNumber(
        holding?.investment_value,
        toNumber(holding?.average_price) * qty
      );

      const live = pickLivePriceForSymbol(livePriceMap, holding.symbol, holding.exchange);
      const ltp = toNumber(live?.ltp ?? live?.price, toNumber(holding?.ltp));
      const change = toNumber(live?.change, NaN);
      const prevCloseCandidate = toNumber(live?.prev_close ?? live?.close, NaN);
      const prevClose = Number.isFinite(prevCloseCandidate)
        ? prevCloseCandidate
        : (Number.isFinite(change) ? (ltp - change) : toNumber(holding?.prev_close, ltp));

      acc.currentValue += (ltp * qty);
      acc.investedAmount += invested;
      acc.prevCloseExposure += (prevClose > 0 ? prevClose * qty : 0);
      acc.todaysPnl += (prevClose > 0 ? (ltp - prevClose) * qty : 0);
      return acc;
    }, {
      currentValue: 0,
      investedAmount: 0,
      prevCloseExposure: 0,
      todaysPnl: 0,
    });

    const shortAgg = shortRows.reduce((acc, position) => {
      const qty = toNumber(position?.quantity);
      if (qty <= 0 || !position?.symbol) {
        return acc;
      }

      const live = pickLivePriceForSymbol(livePriceMap, position.symbol, position.exchange);
      const ltp = toNumber(live?.ltp ?? live?.price, toNumber(position?.ltp));
      const change = toNumber(live?.change, NaN);
      const prevCloseCandidate = toNumber(live?.prev_close ?? live?.close, NaN);
      const prevClose = Number.isFinite(prevCloseCandidate)
        ? prevCloseCandidate
        : (Number.isFinite(change) ? (ltp - change) : toNumber(position?.prev_close, ltp));

      const shortPrice = toNumber(position?.short_price);
      acc.shortUnrealized += ((shortPrice - ltp) * qty);
      acc.prevCloseExposure += (prevClose > 0 ? prevClose * qty : 0);
      acc.todaysPnl += (prevClose > 0 ? (prevClose - ltp) * qty : 0);
      return acc;
    }, {
      shortUnrealized: 0,
      prevCloseExposure: 0,
      todaysPnl: 0,
    });

    const investedAmount = longAgg.investedAmount;
    const currentValue = longAgg.currentValue;
    const realizedPnl = toNumber(baseSummary?.realized_pnl);
    const unrealizedPnl = (longAgg.currentValue - longAgg.investedAmount) + shortAgg.shortUnrealized;
    const totalPnl = realizedPnl + unrealizedPnl;
    const prevCloseExposure = longAgg.prevCloseExposure + shortAgg.prevCloseExposure;
    const todaysPnl = isPreMarket ? 0 : (longAgg.todaysPnl + shortAgg.todaysPnl);

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
      realizedPnl,
      unrealizedPnl,
      prevCloseExposure,
      hasStalePrices: Boolean(baseSummary?.has_stale_prices),
      priceAsof: baseSummary?.price_asof || null,
      marketSession,
      isPreMarket,
    };
  }, [baseSummary, holdings, isPreMarket, livePriceMap, marketSession, shortPositions]);
};

export default usePortfolioSummary;