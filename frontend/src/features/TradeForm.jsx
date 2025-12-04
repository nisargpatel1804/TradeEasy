import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import * as api from "../services/api.js";
import { Input } from "../assets/ui/input.jsx";
import { Button } from "../assets/ui/button.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "../assets/ui/card.jsx";
import { Label } from "../assets/ui/label.jsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../assets/ui/select.jsx";
import { toast } from "react-hot-toast";
import { Loader2, Clock, Info, TrendingUp, TrendingDown, AlertCircle } from "lucide-react";
import priceUpdateService from "../services/priceUpdateService.js";

const generateIdempotencyKey = () => {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `te-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const TradeForm = ({ symbol: initialSymbol = "", onTradeSuccess, onClose, action: initialAction = "BUY" }) => {
  const { isAuthenticated } = useAuth();
  const [action, setAction] = useState(initialAction);
  const [productType, setProductType] = useState("CNC");
  const [quantity, setQuantity] = useState("");
  const [entryPrice, setEntryPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [target, setTarget] = useState("");
  const [timeframe, setTimeframe] = useState("delivery");
  const [symbol, setSymbol] = useState(initialSymbol);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [marketStatus, setMarketStatus] = useState(null);
  const [stockData, setStockData] = useState(null);
  const [livePrice, setLivePrice] = useState(null);
  const [portfolioData, setPortfolioData] = useState(null);
  
  // Update symbol if the initial prop changes
  useEffect(() => {
    setSymbol(initialSymbol.toUpperCase());
    if (initialSymbol) {
      fetchStockData(initialSymbol);
    }
  }, [initialSymbol]);

  // Fetch portfolio data on mount
  useEffect(() => {
    const fetchPortfolio = async () => {
      try {
        const data = await api.fetchPortfolio();
        if (data.success) {
          setPortfolioData(data);
        }
      } catch (err) {
        console.error('Failed to fetch portfolio:', err);
      }
    };
    fetchPortfolio();
  }, []);

  // Subscribe to live price updates
  useEffect(() => {
    if (!symbol) return;
    
    const unsubscribe = priceUpdateService.subscribe(update => {
      if (update?.changedPrices && update.changedPrices[symbol]) {
        setLivePrice(update.changedPrices[symbol]);
      } else if (update?.allPrices && update.allPrices[symbol]) {
        setLivePrice(update.allPrices[symbol]);
      }
    });
    
    return () => unsubscribe();
  }, [symbol]);

  // Fetch stock data
  const fetchStockData = async (stockSymbol) => {
    try {
      const data = await api.getStockDetails(stockSymbol);
      if (data && data.ltp) {
        setStockData(data);
        setLivePrice({ ltp: data.ltp, change: data.change, percent_change: data.percent_change });
      }
    } catch (err) {
      console.error('Failed to fetch stock data:', err);
    }
  };

  // Fetch market status on mount
  useEffect(() => {
    const fetchMarketStatus = async () => {
      try {
        const data = await api.getMarketStatus();
        if (data.success) {
          setMarketStatus({
            session: data.session || (data.is_market_open ? 'REGULAR' : 'CLOSED'),
            is_holiday: data.is_holiday || false,
            status_message: data.status_message
          });
        }
      } catch (err) {
        console.error('Failed to fetch market status:', err);
      }
    };
    fetchMarketStatus();
    // Refresh every minute
    const interval = setInterval(fetchMarketStatus, 60000);
    return () => clearInterval(interval);
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
  const handleTimeframeChange = (value) => {
    setTimeframe(value);
    // Map timeframe to product type
    if (value === "intraday") {
      setProductType("MIS");
    } else {
      setProductType("CNC");
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isAuthenticated) {
      toast.error("You must be logged in to trade.");
      return;
    }
    setError(null);
    setIsLoading(true);

    const qty = parseInt(quantity, 10);
    const currentLtp = livePrice?.ltp || stockData?.ltp || 0;
    
    // Determine order type and price
    let orderType = "MARKET";
    let orderPrice = currentLtp;
    
    if (entryPrice && parseFloat(entryPrice) > 0) {
      orderType = "LIMIT";
      orderPrice = parseFloat(entryPrice);
    }

    // For SELL with MIS, check if it's a short sell
    const isShortSell = action === "SELL" && productType === "MIS";
    
    if (isShortSell) {
      // Show confirmation toast for short sell
      const confirmShortSell = await new Promise((resolve) => {
        toast((t) => (
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-orange-600" />
              <span className="font-semibold">Confirm Short Sell</span>
            </div>
            <p className="text-sm">You are placing a short sell order for {symbol}. This position must be covered by 3:25 PM.</p>
            <div className="flex gap-2 mt-2">
              <Button size="sm" onClick={() => { toast.dismiss(t.id); resolve(true); }}>
                Confirm
              </Button>
              <Button size="sm" variant="outline" onClick={() => { toast.dismiss(t.id); resolve(false); }}>
                Cancel
              </Button>
            </div>
          </div>
        ), { duration: 10000 });
      });
      
      if (!confirmShortSell) {
        setIsLoading(false);
        return;
      }
    }

    const tradeData = {
      symbol,
      quantity: qty,
      order_type: orderType,
      action: action,
      product_type: productType,
      price: orderType === "LIMIT" ? orderPrice : undefined,
      stop_loss_price: stopLoss && parseFloat(stopLoss) > 0 ? parseFloat(stopLoss) : undefined,
      target_price: target && parseFloat(target) > 0 ? parseFloat(target) : undefined,
      allow_short: isShortSell,
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
        
        // Reset form state after successful trade
        setQuantity("");
        setEntryPrice("");
        setStopLoss("");
        setTarget("");
        if (onTradeSuccess) onTradeSuccess(result);
        if (onClose) onClose();
      } else {
        throw new Error(result.message);
      }
    } catch (err) {
      const errorMessage = err.message || "An unexpected error occurred.";
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
  const availableBalance = portfolioData?.summary?.available_balance || portfolioData?.summary?.cash_balance || 0;

  return (
    <Card className="w-full max-w-2xl mx-auto shadow-lg">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-2xl font-bold">Place Order</CardTitle>
          {getMarketStatusBadge()}
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Buy/Sell Action Buttons */}
          <div className="grid grid-cols-2 gap-2">
            <Button
              type="button"
              onClick={() => setAction("BUY")}
              className={action === "BUY" ? "bg-green-600 hover:bg-green-700 text-white" : "bg-gray-200 text-gray-800"}
            >
              Buy
            </Button>
            <Button
              type="button"
              onClick={() => setAction("SELL")}
              className={action === "SELL" ? "bg-red-600 hover:bg-red-700 text-white" : "bg-gray-200 text-gray-800"}
            >
              Sell
            </Button>
          </div>

          {/* Symbol */}
          <div>
            <Label htmlFor="symbol">Symbol</Label>
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
              disabled={!!initialSymbol}
            />
          </div>

          {/* LTP with Change */}
          {currentLtp > 0 && (
            <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-gray-500">Last Traded Price</p>
                  <p className="text-2xl font-bold">{formatCurrency(currentLtp)}</p>
                </div>
                <div className="text-right">
                  <div className={`flex items-center gap-1 ${getPriceChangeColor(priceChange)}`}>
                    {priceChange > 0 ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
                    <span className="font-semibold">{formatCurrency(Math.abs(priceChange))}</span>
                  </div>
                  <p className={`text-sm ${getPriceChangeColor(priceChange)}`}>
                    ({percentChange > 0 ? '+' : ''}{percentChange?.toFixed(2)}%)
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* Quantity */}
          <div>
            <Label htmlFor="quantity">Quantity</Label>
            <Input
              id="quantity"
              type="number"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder="0"
              required
              min="1"
            />
          </div>

          {/* Entry Price (Optional) */}
          <div>
            <Label htmlFor="entryPrice">Entry Price (Optional - Leave blank for Market Order)</Label>
            <Input
              id="entryPrice"
              type="number"
              value={entryPrice}
              onChange={(e) => setEntryPrice(e.target.value)}
              placeholder="Market Price"
              min="0.01"
              step="0.01"
            />
            {!entryPrice && (
              <p className="text-xs text-gray-500 mt-1">
                Will execute at market price: {formatCurrency(currentLtp)}
              </p>
            )}
          </div>

          {/* Timeframe */}
          <div>
            <Label htmlFor="timeframe">Timeframe</Label>
            <Select onValueChange={handleTimeframeChange} value={timeframe}>
              <SelectTrigger id="timeframe">
                <SelectValue placeholder="Select timeframe" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="intraday">Intraday (Auto square-off at 3:25 PM)</SelectItem>
                {action === "BUY" && <SelectItem value="delivery">Delivery</SelectItem>}
                {action === "SELL" && (
                  <>
                    <SelectItem value="delivery">Permanent (Until Exit)</SelectItem>
                    <SelectItem value="1month">1 Month</SelectItem>
                    <SelectItem value="1year">1 Year</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Stop Loss (Optional) */}
          <div>
            <Label htmlFor="stopLoss">Stop Loss (Optional)</Label>
            <Input
              id="stopLoss"
              type="number"
              value={stopLoss}
              onChange={(e) => setStopLoss(e.target.value)}
              placeholder="0.00"
              min="0.01"
              step="0.01"
            />
          </div>

          {/* Target (Optional) */}
          <div>
            <Label htmlFor="target">Target (Optional)</Label>
            <Input
              id="target"
              type="number"
              value={target}
              onChange={(e) => setTarget(e.target.value)}
              placeholder="0.00"
              min="0.01"
              step="0.01"
            />
          </div>

          {/* Available Balance / Margin */}
          <div className="grid grid-cols-2 gap-4 p-3 bg-blue-50 rounded-lg border border-blue-200">
            <div>
              <p className="text-sm text-gray-600">Available Balance</p>
              <p className="font-semibold text-lg">{formatCurrency(availableBalance)}</p>
            </div>
            <div>
              <p className="text-sm text-gray-600">{action === "BUY" ? "Margin Required" : "Estimated Proceeds"}</p>
              <p className="font-semibold text-lg">{formatCurrency(action === "BUY" ? marginRequired : totalAmount)}</p>
            </div>
          </div>

          {/* Charges */}
          <div className="p-3 bg-gray-50 rounded-lg border border-gray-200">
            <div className="flex justify-between items-center">
              <span className="text-sm text-gray-600">Charges</span>
              <span className="font-semibold">{formatCurrency(charges)}</span>
            </div>
          </div>

          {/* Warning for insufficient funds */}
          {action === "BUY" && marginRequired > availableBalance && (
            <div className="p-3 bg-red-50 border border-red-200 rounded-lg flex items-center gap-2 text-red-700">
              <AlertCircle className="h-5 w-5" />
              <span className="text-sm">Insufficient balance. Required: {formatCurrency(marginRequired)}</span>
            </div>
          )}
          
          {error && <p className="text-sm text-red-500 text-center">{error}</p>}

          <Button 
            type="submit" 
            className="w-full" 
            disabled={isLoading || (action === "BUY" && marginRequired > availableBalance)}
          >
            {isLoading ? <Loader2 className="animate-spin mx-auto" /> : `Place ${action} Order`}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};

export default TradeForm;
