import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { useDataContext } from "../context/DataContext.jsx";
import * as api from "../services/api.js";
import { Input } from "../assets/ui/input.jsx";
import { Button } from "../assets/ui/button.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "../assets/ui/card.jsx";
import { Label } from "../assets/ui/label.jsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../assets/ui/select.jsx";
import { toast } from "react-hot-toast";
import { Loader2, Clock, Info, TrendingUp, TrendingDown, AlertCircle } from "lucide-react";
import priceUpdateService from "../services/priceUpdateService.js";
import { getSymbolVariants } from "../utils/symbolUtils.js";

const generateIdempotencyKey = () => {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `te-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const TradeForm = ({
  symbol: initialSymbol = "",
  onTradeSuccess,
  onClose,
  action: initialAction = "BUY",
  onLoadingChange,
  closeRequested,
  onCloseRequestHandled,
}) => {
  const { isAuthenticated } = useAuth();
  const { profileData } = useDataContext();
  const [action, setAction] = useState(initialAction);
  const [productType, setProductType] = useState(initialAction === "SELL" ? "MIS" : "CNC");
  const [quantity, setQuantity] = useState("");
  const [entryPrice, setEntryPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [target, setTarget] = useState("");
  const [timeframe, setTimeframe] = useState(initialAction === "SELL" ? "intraday" : "delivery");
  const [symbol, setSymbol] = useState(initialSymbol);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [marketStatus, setMarketStatus] = useState(null);
  const [stockData, setStockData] = useState(null);
  const [livePrice, setLivePrice] = useState(null);
  const [portfolioData, setPortfolioData] = useState(null);
  const [isPortfolioLoading, setIsPortfolioLoading] = useState(true);
  const cancelAfterCreateRef = useRef(false);
  const isMountedRef = useRef(true);
  const portfolioRequestIdRef = useRef(0);
  const stockRequestIdRef = useRef(0);
  // guard so the BUY/SELL action effect skips the initial mount run
  const actionChangedRef = useRef(false);

  const refreshPortfolioData = useCallback(async ({ silent = false } = {}) => {
    const requestId = portfolioRequestIdRef.current + 1;
    portfolioRequestIdRef.current = requestId;

    if (!silent && isMountedRef.current) {
      setIsPortfolioLoading(true);
    }

    try {
      const data = await api.fetchPortfolio();
      if (!isMountedRef.current || requestId !== portfolioRequestIdRef.current) {
        return;
      }

      if (data?.success) {
        setPortfolioData(data);
      }
    } catch {
    } finally {
      if (!silent && isMountedRef.current && requestId === portfolioRequestIdRef.current) {
        setIsPortfolioLoading(false);
      }
    }
  }, []);

  const resolvedExchange = stockData?.exchange || livePrice?.exchange || livePrice?.market || livePrice?.exchange_code;
  const subscriptionSymbols = useMemo(
    () => getSymbolVariants(symbol, resolvedExchange),
    [symbol, resolvedExchange]
  );

  useEffect(() => {
    setAction(initialAction);
    if (initialAction === 'SELL') {
      setTimeframe('intraday');
      setProductType('MIS');
    } else {
      setTimeframe('delivery');
      setProductType('CNC');
    }
  }, [initialAction]);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (typeof onLoadingChange === 'function') {
      onLoadingChange(isLoading);
    }
  }, [isLoading, onLoadingChange]);

  useEffect(() => {
    const onPortfolioReset = () => {
      setError("Portfolio reset detected. Please review quantity and submit again.");
      setQuantity("");
      setEntryPrice("");
      setStopLoss("");
      setTarget("");
      refreshPortfolioData();
    };

    window.addEventListener('te:portfolio-reset', onPortfolioReset);
    return () => window.removeEventListener('te:portfolio-reset', onPortfolioReset);
  }, [refreshPortfolioData]);

  useEffect(() => {
    if (!closeRequested) {
      return;
    }

    // Parent attempted to close the dialog.
    // If a trade is in-flight, mark it for cancellation once created so it shows in Orders.
    if (isLoading) {
      cancelAfterCreateRef.current = true;
      toast.error("Close requested: will cancel this order once it is placed.");
      if (typeof onCloseRequestHandled === 'function') {
        onCloseRequestHandled();
      }
      return;
    }

    if (typeof onCloseRequestHandled === 'function') {
      onCloseRequestHandled();
    }
    if (typeof onClose === 'function') {
      onClose();
    }
  }, [closeRequested, isLoading, onClose, onCloseRequestHandled]);

  const holdingsForSymbol = useMemo(() => {
    const list = Array.isArray(portfolioData?.holdings)
      ? portfolioData.holdings
      : [
          ...(Array.isArray(portfolioData?.cnc_holdings) ? portfolioData.cnc_holdings : []),
          ...(Array.isArray(portfolioData?.mis_holdings) ? portfolioData.mis_holdings : []),
        ];

    const base = (value) => String(value || "").toUpperCase().split(".")[0];
    const target = base(symbol);
    if (!target) {
      return [];
    }

    return list.filter((holding) => base(holding?.symbol) === target);
  }, [portfolioData, symbol]);

  const cncHoldingQty = useMemo(() => {
    return holdingsForSymbol
      .filter((h) => (h?.product_type || "CNC").toUpperCase() === "CNC")
      .reduce((sum, h) => sum + (Number(h?.quantity) || 0), 0);
  }, [holdingsForSymbol]);

  const misHoldingQty = useMemo(() => {
    return holdingsForSymbol
      .filter((h) => (h?.product_type || "CNC").toUpperCase() === "MIS")
      .reduce((sum, h) => sum + (Number(h?.quantity) || 0), 0);
  }, [holdingsForSymbol]);

  const hasPositionalHolding = cncHoldingQty > 0;
  const hasIntradayHolding = misHoldingQty > 0;

  const fetchStockData = useCallback(async (stockSymbol) => {
    const requestId = stockRequestIdRef.current + 1;
    stockRequestIdRef.current = requestId;

    try {
      const response = await api.getStockDetails(stockSymbol);
      if (!isMountedRef.current || requestId !== stockRequestIdRef.current) {
        return;
      }

      const priceData = response?.price_data;
      if (!priceData) {
        return;
      }

      setStockData(priceData);
      setLivePrice({
        ltp: priceData.ltp,
        change: priceData.change,
        percent_change: priceData.percent_change,
        exchange: priceData.exchange,
      });

      if (priceData && priceData.provider_available === false) {
        toast.error('Price provider is currently unavailable. Showing cached or EOD prices. Live updates may be delayed.');
      } else if (priceData && priceData.is_stale) {
        toast('Showing fallback price (EOD or previous close). Live prices may be unavailable.', { icon: 'ℹ️' });
      }

      setSymbol((prev) => prev || (priceData.symbol || '').toUpperCase());
    } catch {
    }
  }, []);

  // Update symbol if the initial prop changes
  useEffect(() => {
    const normalized = (initialSymbol || "").toUpperCase();
    setSymbol(normalized);
    if (normalized) {
      fetchStockData(normalized);
    }
    refreshPortfolioData();
  }, [initialSymbol, fetchStockData, refreshPortfolioData]);

  useEffect(() => {
    // Keep holdings snapshot fresh when user switches BUY/SELL.
    if (actionChangedRef.current) {
      refreshPortfolioData({ silent: true });
    } else {
      actionChangedRef.current = true;
    }
  }, [action, refreshPortfolioData]);

  // Subscribe to live price updates
  useEffect(() => {
    if (!subscriptionSymbols.length) return undefined;

    const unsubscribe = priceUpdateService.subscribe(update => {
      if (!update) return;
      for (const key of subscriptionSymbols) {
        if (update?.changedPrices?.[key]) {
          setLivePrice(update.changedPrices[key]);
          return;
        }
        if (update?.allPrices?.[key]) {
          setLivePrice(update.allPrices[key]);
          return;
        }
      }
    });

    return () => unsubscribe();
  }, [subscriptionSymbols]);

  // Fetch market status on mount
  useEffect(() => {
    let isCancelled = false;

    const fetchMarketStatus = async () => {
      try {
        const data = await api.getMarketStatus();
        if (!isCancelled && data.success) {
          setMarketStatus({
            session: data.session || (data.is_market_open ? 'REGULAR' : 'CLOSED'),
            is_holiday: data.is_holiday || false,
            status_message: data.status_message
          });
        }
      } catch (err) {
      }
    };
    fetchMarketStatus();
    // Refresh every minute
    const interval = setInterval(fetchMarketStatus, 60000);
    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, []);

  // Calculate margin required and charges
  const calculateMarginAndCharges = () => {
    const qty = parseInt(quantity, 10) || 0;
    const price = parseFloat(entryPrice) || (livePrice?.ltp || 0);
    const baseAmount = qty * price;
    
    // For now, charges are 0 as per requirements
    const charges = 0;
    
    // Margin required
    let marginRequired = baseAmount;
    if (action === "BUY") {
      marginRequired = baseAmount; // Full amount for buy
    } else if (action === "SELL") {
      // For sell, we're receiving money, so no margin required
      marginRequired = 0;
    }
    
    return { marginRequired, charges, totalAmount: baseAmount };
  };

  // Handle timeframe change
  const handleTimeframeChange = useCallback((value) => {
    if (action === "SELL" && !isPortfolioLoading && value === "delivery" && !hasPositionalHolding) {
      toast.error("No delivery (positional) holding available to sell.");
      return;
    }

    if (action === "SELL" && !isPortfolioLoading && value === "intraday" && hasPositionalHolding && !hasIntradayHolding) {
      toast.error("Intraday short-sell is disabled when you already hold this stock as delivery.");
      return;
    }

    setTimeframe(value);
    setProductType(value === "intraday" ? "MIS" : "CNC");
  }, [action, hasIntradayHolding, hasPositionalHolding, isPortfolioLoading]);

  useEffect(() => {
    // Keep timeframe/productType consistent when action or symbol changes.
    if (action === "BUY") {
      if (timeframe !== "intraday" && timeframe !== "delivery") {
        setTimeframe("delivery");
        setProductType("CNC");
      }
      return;
    }

    if (isPortfolioLoading) {
      return;
    }

    // SELL defaults:
    // - If delivery holding exists, default to delivery sell.
    // - Otherwise default to intraday (square-off or short-sell).
    if (timeframe === "delivery" && !hasPositionalHolding) {
      setTimeframe("intraday");
      setProductType("MIS");
      return;
    }

    if (timeframe === "intraday" && hasPositionalHolding && !hasIntradayHolding) {
      setTimeframe("delivery");
      setProductType("CNC");
    }
  }, [action, hasIntradayHolding, hasPositionalHolding, timeframe, isPortfolioLoading]);

  const mapTradeErrorMessage = useCallback((err) => {
    const status =
      err?.status
      ?? err?.response?.status
      ?? err?.originalError?.response?.status
      ?? err?.data?.status;
    const text = String(err?.message || "").trim();

    if (status === 402) {
      return "Insufficient available funds or margin for this order.";
    }
    if (status === 409) {
      return text || "This order was already processed or conflicts with another request.";
    }
    if (status === 423) {
      return "Portfolio reset in progress. Please wait a moment and retry.";
    }
    if (status === 400) {
      return text || "Invalid order parameters. Please review quantity, price, and timeframe.";
    }
    return text || "An unexpected error occurred.";
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isAuthenticated) {
      toast.error("You must be logged in to trade.");
      return;
    }
    setError(null);
    cancelAfterCreateRef.current = false;
    setIsLoading(true);

    const qty = Number.parseInt(quantity, 10);
    if (!Number.isInteger(qty) || qty <= 0) {
      toast.error("Enter a valid quantity greater than 0.");
      setIsLoading(false);
      return;
    }

    const symbolValue = String(symbol || "").trim().toUpperCase();
    if (!symbolValue) {
      toast.error("Symbol is required.");
      setIsLoading(false);
      return;
    }

    const hasLimitInput = String(entryPrice || "").trim().length > 0;
    const parsedEntryPrice = hasLimitInput ? Number.parseFloat(entryPrice) : null;
    if (hasLimitInput && (!Number.isFinite(parsedEntryPrice) || parsedEntryPrice <= 0)) {
      toast.error("Enter a valid limit price greater than 0.");
      setIsLoading(false);
      return;
    }

    const hasUnsupportedExitInputs = String(stopLoss || "").trim().length > 0 || String(target || "").trim().length > 0;
    if (hasUnsupportedExitInputs) {
      toast.error("Stop Loss / Target from this ticket are not active for simple MARKET/LIMIT orders. Use Modify Exit Plan after entry.");
      setIsLoading(false);
      return;
    }

    const currentLtp = livePrice?.ltp || stockData?.ltp || 0;
    if (!hasLimitInput && (!Number.isFinite(currentLtp) || currentLtp <= 0)) {
      toast.error("Live market price is unavailable. Add a valid limit price or retry.");
      setIsLoading(false);
      return;
    }
    
    // Determine order type and price
    let orderType = "MARKET";
    let orderPrice = currentLtp;
    
    if (hasLimitInput) {
      orderType = "LIMIT";
      orderPrice = parsedEntryPrice;
    }

    const holdingsSnapshotReady = !isPortfolioLoading && portfolioData?.success;
    if (action === "SELL" && productType === "MIS" && !holdingsSnapshotReady) {
      toast.error("Holdings are still syncing. Please wait a moment before placing MIS sell.");
      setIsLoading(false);
      return;
    }

    const inferredShortSell = action === "SELL" && productType === "MIS" && holdingsSnapshotReady && !hasPositionalHolding && !hasIntradayHolding;
    const allowShortIntent = inferredShortSell;

    // Short selling support is only implemented for immediate execution.
    // Prevent creating a pending MIS short-sell order that would later be cancelled by the processor.
    const session = marketStatus?.session;
    const isMarketRegular = session === 'REGULAR';
    if (inferredShortSell) {
      if (session && !isMarketRegular) {
        toast.error("Intraday short sell is only allowed during regular market hours.");
        setIsLoading(false);
        return;
      }
      if (hasLimitInput) {
        toast.error("Short sell supports MARKET orders only. Remove the limit price.");
        setIsLoading(false);
        return;
      }
      if (!session) {
        toast("Market status is currently unavailable. Server will validate short-sell eligibility.", { icon: "ℹ️" });
      }
    }

    if (action === "SELL" && productType === "MIS" && holdingsSnapshotReady && !inferredShortSell && !hasIntradayHolding) {
      toast.error("No intraday position available to sell.");
      setIsLoading(false);
      return;
    }
    
    if (inferredShortSell) {
      const confirmShortSell = window.confirm(
        `Confirm short sell for ${symbol}?\n\nThis is an intraday (MIS) short position and must be covered by 3:25 PM.`
      );
      if (!confirmShortSell) {
        toast.error("Short sell cancelled.");
        setIsLoading(false);
        return;
      }
    }

    const tradeData = {
      symbol: symbolValue,
      quantity: qty,
      order_type: orderType,
      action: action,
      product_type: productType,
      price: orderType === "LIMIT" ? orderPrice : undefined,
      allow_short: allowShortIntent,
    };

    const toastId = toast.loading("Placing order...");

    try {
      const requestPayload = {
        ...tradeData,
        idempotency_key: generateIdempotencyKey(),
      };
      const result = await api.placeTrade(requestPayload);
      if (result.success) {
        let successMessage = result.message || "Trade executed successfully!";
        
        if (result.status === "PENDING" || result.status === "pending") {
          successMessage = result.message || `Order placed successfully and is pending execution.`;
          toast.success(successMessage, { id: toastId, duration: 5000 });
        } else if (result.duplicate) {
          toast.success(successMessage + " (Duplicate request)", { id: toastId });
        } else {
          toast.success(successMessage, { id: toastId });
        }
        
        const orderId = result.order_id || result.orderId || result.transaction_id || result.transactionId || result.id;
        const statusValue = String(result.status || "").toUpperCase();
        const isPending = statusValue === 'PENDING' || (!statusValue && !!result.transaction_id && (result.price == null));

        // If user requested close while loading, auto-cancel only PENDING orders.
        if (cancelAfterCreateRef.current && orderId && isPending) {
          try {
            await api.cancelOrder(orderId);
            toast.success("Order cancelled.", { id: toastId });
          } catch (cancelErr) {
            toast.error(cancelErr?.message || "Failed to cancel order.", { id: toastId });
          } finally {
            cancelAfterCreateRef.current = false;
          }
        }

        const optimisticOrder = {
          id: orderId || `${symbolValue}-${Date.now()}`,
          symbol: symbolValue,
          transaction_type: action,
          quantity: qty,
          price: Number.isFinite(orderPrice) ? orderPrice : (Number(livePrice?.ltp) || Number(stockData?.ltp) || 0),
          status: isPending ? 'PENDING' : 'EXECUTED',
          date: new Date().toISOString(),
        };

        window.dispatchEvent(new CustomEvent('te:trade-success', { detail: { orderId, optimisticOrder } }));

        // Refresh holdings snapshot for accurate intraday/positional gating.
        refreshPortfolioData({ silent: true });

        // Reset form state after successful trade
        setQuantity("");
        setEntryPrice("");
        setStopLoss("");
        setTarget("");
        if (onTradeSuccess) onTradeSuccess(result);
        if (onClose) onClose();
      } else {
        const submitErr = new Error(result?.message || 'Order failed.');
        submitErr.status = result?.status_code || result?.status || result?.code;
        submitErr.data = result;
        throw submitErr;
      }
    } catch (err) {
      const errorMessage = mapTradeErrorMessage(err);
      setError(errorMessage);
      toast.error(errorMessage, { id: toastId });
    } finally {
      setIsLoading(false);
    }
  };

  const getMarketStatusBadge = () => {
    if (!marketStatus) return null;
    
    const statusColors = {
      'PRE_MARKET': 'bg-blue-100 text-blue-800',
      'REGULAR': 'bg-green-100 text-green-800',
      'POST_MARKET': 'bg-orange-100 text-orange-800',
      'CLOSED': 'bg-red-100 text-red-800',
    };

    const statusLabels = {
      'PRE_MARKET': 'Pre-Market',
      'REGULAR': 'Market Open',
      'POST_MARKET': 'Post-Market',
      'CLOSED': 'Market Closed',
    };

    return (
      <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-medium ${statusColors[marketStatus.session]}`}>
        <Clock className="h-3 w-3" />
        {statusLabels[marketStatus.session]}
        {marketStatus.is_holiday && <span className="ml-1">(Holiday)</span>}
      </div>
    );
  };

  const formatCurrency = (value) => {
    if (typeof value !== 'number') return '₹0.00';
    return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const getPriceChangeColor = (change) => {
    if (change > 0) return 'text-green-600';
    if (change < 0) return 'text-red-600';
    return 'text-gray-600';
  };

  const { marginRequired, charges, totalAmount } = calculateMarginAndCharges();
  const currentLtp = livePrice?.ltp || stockData?.ltp || 0;
  const priceChange = livePrice?.change || stockData?.change || 0;
  const percentChange = livePrice?.percent_change || stockData?.percent_change || 0;
  const portfolioAvailableBalanceRaw = portfolioData?.summary?.available_balance ?? portfolioData?.summary?.cash_balance;
  const profileAvailableBalanceRaw = profileData?.available_balance ?? profileData?.balance;

  const availableBalance = useMemo(() => {
    const portfolioBalance = Number(portfolioAvailableBalanceRaw);
    if (Number.isFinite(portfolioBalance)) {
      return portfolioBalance;
    }

    const profileBalance = Number(profileAvailableBalanceRaw);
    if (Number.isFinite(profileBalance)) {
      return profileBalance;
    }

    return 0;
  }, [portfolioAvailableBalanceRaw, profileAvailableBalanceRaw]);

  const isBalanceReady = useMemo(() => {
    const portfolioBalance = Number(portfolioAvailableBalanceRaw);
    if (Number.isFinite(portfolioBalance)) {
      return true;
    }

    const profileBalance = Number(profileAvailableBalanceRaw);
    return Number.isFinite(profileBalance);
  }, [portfolioAvailableBalanceRaw, profileAvailableBalanceRaw]);

  return (
    <Card className="w-full max-w-none rounded-3xl border border-slate-100 bg-white shadow-sm">
      <CardHeader className="gap-2 pb-0 px-4 pt-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.3em] text-slate-400">Smart Ticket</p>
            <CardTitle className="text-xl font-semibold text-slate-900">Trade Form</CardTitle>
          </div>
          {symbol && (
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-slate-600">
              {symbol}
            </span>
          )}
        </div>
        {getMarketStatusBadge()}
      </CardHeader>
      <CardContent className="px-4 pb-4 pt-4">
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_240px]">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  { key: "BUY", label: "Buy", helper: "Delivery / Long", accent: "emerald", icon: TrendingUp },
                  { key: "SELL", label: "Sell", helper: "Exit / Short", accent: "red", icon: TrendingDown },
                ].map((option) => {
                  const isActive = action === option.key;
                  const accentClasses = option.accent === "emerald"
                    ? {
                        border: "border-emerald-200",
                        icon: "bg-emerald-50 text-emerald-600",
                        text: "text-emerald-700",
                        glow: "shadow-[0_18px_45px_rgba(16,185,129,0.18)]",
                        active: "border-emerald-600 bg-emerald-600",
                        activeIcon: "bg-white/15 text-white",
                      }
                    : {
                        border: "border-red-200",
                        icon: "bg-red-50 text-red-600",
                        text: "text-red-700",
                        glow: "shadow-[0_18px_45px_rgba(239,68,68,0.18)]",
                        active: "border-red-600 bg-red-600",
                        activeIcon: "bg-white/15 text-white",
                      };

                  return (
                    <button
                      key={option.key}
                      type="button"
                      disabled={isLoading}
                      onClick={() => setAction(option.key)}
                      className={`rounded-2xl border p-3 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/10 ${
                        isActive
                          ? `${accentClasses.active} ${accentClasses.glow}`
                          : "border-slate-200 bg-white/95 hover:border-slate-300"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div
                          className={`flex h-10 w-10 items-center justify-center rounded-2xl ${
                            isActive ? accentClasses.activeIcon : accentClasses.icon
                          }`}
                        >
                          <option.icon className="h-4 w-4" />
                        </div>
                        <div>
                          <p className={`text-sm font-semibold ${isActive ? "text-white" : "text-slate-900"}`}>
                            {option.label}
                          </p>
                          <p className={`text-xs ${isActive ? "text-white/80" : "text-slate-500"}`}>{option.helper}</p>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="symbol" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Symbol</Label>
                  <Input
                    id="symbol"
                    value={symbol}
                    onChange={(e) => {
                      const newSymbol = e.target.value.toUpperCase();
                      setSymbol(newSymbol);
                      if (newSymbol.length >= 2) {
                        fetchStockData(newSymbol);
                      }
                    }}
                    placeholder="e.g. RELIANCE"
                    required
                    disabled={isLoading || !!initialSymbol}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="quantity" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quantity</Label>
                  <Input
                    id="quantity"
                    type="number"
                    value={quantity}
                    onChange={(e) => {
                      const cleaned = String(e.target.value || '').replace(/\D+/g, '');
                      setQuantity(cleaned);
                    }}
                    placeholder="0"
                    required
                    min="1"
                    disabled={isLoading}
                  />
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="entryPrice" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Price (Optional)</Label>
                  <Input
                    id="entryPrice"
                    type="number"
                    value={entryPrice}
                    onChange={(e) => {
                      const raw = String(e.target.value || '');
                      const sanitized = raw
                        .replace(/[^\d.]/g, '')
                        .replace(/(\..*)\./g, '$1');
                      setEntryPrice(sanitized);
                    }}
                    placeholder="Market Price"
                    min="0.01"
                    step="0.01"
                    disabled={isLoading}
                  />
                  {!entryPrice && (
                    <p className="text-xs text-slate-500">Executes at live price {formatCurrency(currentLtp)}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="timeframe" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Timeframe</Label>
                  <Select onValueChange={handleTimeframeChange} value={timeframe} disabled={isLoading}>
                    <SelectTrigger id="timeframe">
                      <SelectValue placeholder="Select timeframe" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="intraday">Intraday (auto square-off 3:25 PM)</SelectItem>
                      <SelectItem value="delivery" disabled={isLoading || (action === "SELL" && !isPortfolioLoading && !hasPositionalHolding)}>
                        {action === "SELL" ? "Delivery (positional exit)" : "Delivery (positional)"}
                      </SelectItem>
                    </SelectContent>
                  </Select>
                  {action === "SELL" && hasPositionalHolding && !hasIntradayHolding && (
                    <p className="text-xs text-slate-500">
                      Intraday short-sell is disabled for this symbol because you already hold it as delivery.
                    </p>
                  )}
                </div>
              </div>

              <div className="grid gap-4 md:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="stopLoss" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stop Loss</Label>
                  <Input
                    id="stopLoss"
                    type="number"
                    value={stopLoss}
                    onChange={(e) => setStopLoss(e.target.value)}
                    placeholder="0.00"
                    min="0.01"
                    step="0.01"
                    disabled
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="target" className="text-xs font-semibold uppercase tracking-wide text-slate-500">Target</Label>
                  <Input
                    id="target"
                    type="number"
                    value={target}
                    onChange={(e) => setTarget(e.target.value)}
                    placeholder="0.00"
                    min="0.01"
                    step="0.01"
                    disabled
                  />
                  <p className="flex items-start gap-1 text-xs text-slate-500">
                    <Info className="mt-0.5 h-3 w-3" />
                    Stop Loss / Target are managed via Modify Exit Plan after order execution.
                  </p>
                </div>
              </div>
            </div>

            <aside className="space-y-3 rounded-2xl border border-slate-100 bg-slate-50/60 p-3">
              {currentLtp > 0 ? (
                <div className="rounded-2xl border border-white/70 bg-white/80 p-3">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Live LTP</p>
                  <p className="text-2xl font-bold text-slate-900">{formatCurrency(currentLtp)}</p>
                  <div className={`mt-2 flex items-center gap-2 text-sm font-semibold ${getPriceChangeColor(priceChange)}`}>
                    {priceChange > 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    {formatCurrency(Math.abs(priceChange))}
                    <span className="text-xs">({percentChange > 0 ? '+' : ''}{percentChange?.toFixed(2)}%)</span>
                  </div>
                </div>
              ) : (
                <div className="rounded-2xl border border-dashed border-slate-200 p-3 text-sm text-slate-500">
                  LTP will appear once a valid symbol is selected.
                </div>
              )}

              <div className="space-y-2.5 rounded-2xl border border-slate-200/80 bg-white/70 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Available</span>
                  <span className="text-base font-semibold text-slate-900">
                    {isBalanceReady ? formatCurrency(availableBalance) : "Loading..."}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">{action === "BUY" ? "Margin Req" : "Proceeds"}</span>
                  <span className="text-base font-semibold text-slate-900">{formatCurrency(action === "BUY" ? marginRequired : totalAmount)}</span>
                </div>
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>Charges</span>
                  <span className="font-semibold text-slate-900">{formatCurrency(charges)}</span>
                </div>
              </div>
            </aside>
          </div>

          {action === "BUY" && isBalanceReady && marginRequired > availableBalance && (
            <div className="rounded-2xl border border-rose-200 bg-rose-50/70 p-3 text-sm text-rose-700">
              <div className="flex items-center gap-2">
                <AlertCircle className="h-4 w-4" />
                <span>Insufficient balance. Required: {formatCurrency(marginRequired)}</span>
              </div>
            </div>
          )}

          {error && (
            <p className="text-center text-sm font-semibold text-rose-600">{error}</p>
          )}

          <Button
            type="submit"
            className="w-full rounded-2xl py-4 text-sm font-semibold"
            disabled={isLoading || (action === "BUY" && (!isBalanceReady || marginRequired > availableBalance))}
          >
            {isLoading ? <Loader2 className="mx-auto animate-spin" /> : `Place ${action} Order`}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};

export default TradeForm;
