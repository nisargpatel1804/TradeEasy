import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import * as api from "../services/api.js";
import { Input } from "../assets/ui/input.jsx";
import { Button } from "../assets/ui/button.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "../assets/ui/card.jsx";
import { Label } from "../assets/ui/label.jsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../assets/ui/select.jsx";
import { toast } from "react-hot-toast";
import { Loader2, Clock, Info } from "lucide-react";

const generateIdempotencyKey = () => {
  if (typeof window !== "undefined" && window.crypto?.randomUUID) {
    return window.crypto.randomUUID();
  }
  return `te-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
};

const TradeForm = ({ symbol: initialSymbol = "", onTradeSuccess, onClose }) => {
  const { isAuthenticated } = useAuth();
  const [action, setAction] = useState("BUY");
  const [orderType, setOrderType] = useState("MARKET");
  const [productType, setProductType] = useState("CNC");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [stopPrice, setStopPrice] = useState("");
  const [targetPrice, setTargetPrice] = useState("");
  const [trailingStopPct, setTrailingStopPct] = useState("");
  const [allowShort, setAllowShort] = useState(false);
  const [symbol, setSymbol] = useState(initialSymbol);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  const [marketStatus, setMarketStatus] = useState(null);
  
  // Update symbol if the initial prop changes
  useEffect(() => {
    setSymbol(initialSymbol.toUpperCase());
  }, [initialSymbol]);

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

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!isAuthenticated) {
      toast.error("You must be logged in to trade.");
      return;
    }
    setError(null);
    setIsLoading(true);

    const tradeData = {
      symbol,
      quantity: parseInt(quantity, 10),
      order_type: orderType,
      action: action,
      product_type: productType,
      price: orderType === "LIMIT" || orderType === "STOP_LIMIT" ? parseFloat(price) : undefined,
      stop_loss_price: (orderType === "STOP_LOSS" || orderType === "STOP_LIMIT" || orderType === "BRACKET") && stopPrice ? parseFloat(stopPrice) : undefined,
      target_price: orderType === "BRACKET" && targetPrice ? parseFloat(targetPrice) : undefined,
      trailing_stop_pct: orderType === "TRAILING_STOP" && trailingStopPct ? parseFloat(trailingStopPct) : undefined,
      allow_short: action === "SELL" && productType === "MIS" && allowShort,
    };

    const toastId = toast.loading("Placing order...");

    try {
      // The `placeTrade` function in `api.js` now correctly routes to /buy or /sell.
      const requestPayload = {
        ...tradeData,
        idempotency_key: generateIdempotencyKey(),
      };
      const result = await api.placeTrade(requestPayload);
      if (result.success) {
        // Handle different order statuses
        let successMessage = result.message || "Trade executed successfully!";
        
        // Show different messages based on order status
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
        setPrice("");
        setStopPrice("");
        setTargetPrice("");
        setTrailingStopPct("");
        setAllowShort(false);
        if (onTradeSuccess) onTradeSuccess(result);
        if (onClose) onClose();
      } else {
        // This handles validation errors returned from the backend.
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

  return (
    <Card className="w-full max-w-md mx-auto shadow-lg">
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="text-2xl font-bold">Place Order</CardTitle>
          {getMarketStatusBadge()}
        </div>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
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

          <div>
            <Label htmlFor="symbol">Symbol</Label>
            <Input
              id="symbol"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="e.g. RELIANCE"
              required
              disabled={!!initialSymbol}
            />
          </div>

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

          <div>
            <Label htmlFor="productType">Product Type</Label>
            <Select onValueChange={setProductType} value={productType}>
              <SelectTrigger id="productType">
                <SelectValue placeholder="Select product" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="CNC">CNC (Delivery)</SelectItem>
                <SelectItem value="MIS">MIS (Intraday)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-gray-500 mt-1">
              {productType === "MIS" ? "Auto square-off at 3:25 PM" : "No auto square-off"}
            </p>
          </div>
          
          <div>
            <Label htmlFor="orderType">Order Type</Label>
            <Select onValueChange={setOrderType} value={orderType}>
              <SelectTrigger id="orderType">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MARKET">Market</SelectItem>
                <SelectItem value="LIMIT">Limit</SelectItem>
                <SelectItem value="STOP_LOSS">Stop-Loss (SL)</SelectItem>
                <SelectItem value="STOP_LIMIT">Stop-Limit (SL-L)</SelectItem>
                <SelectItem value="BRACKET">Bracket Order (BO)</SelectItem>
                <SelectItem value="TRAILING_STOP">Trailing Stop</SelectItem>
              </SelectContent>
            </Select>
            {marketStatus?.session === 'POST_MARKET' && orderType === 'MARKET' && productType === 'CNC' && (
              <p className="text-xs text-blue-600 mt-1 flex items-center gap-1">
                <Info className="h-3 w-3" />
                Market order will be converted to Limit order at current price for AMO
              </p>
            )}
            {marketStatus?.session === 'POST_MARKET' && orderType === 'MARKET' && productType === 'MIS' && (
              <p className="text-xs text-orange-600 mt-1 flex items-center gap-1">
                <Info className="h-3 w-3" />
                MIS orders not allowed in after-market session. Use CNC for AMO.
              </p>
            )}
          </div>

          {(orderType === "LIMIT" || orderType === "STOP_LIMIT") && (
            <div>
              <Label htmlFor="price">Limit Price</Label>
              <Input
                id="price"
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                required
                min="0.01"
                step="0.01"
              />
            </div>
          )}

          {(orderType === "STOP_LOSS" || orderType === "STOP_LIMIT" || orderType === "BRACKET") && (
            <div>
              <Label htmlFor="stopPrice">
                {orderType === "BRACKET" ? "Stop-Loss Price" : "Stop Price (Trigger)"}
              </Label>
              <Input
                id="stopPrice"
                type="number"
                value={stopPrice}
                onChange={(e) => setStopPrice(e.target.value)}
                placeholder="0.00"
                required
                min="0.01"
                step="0.01"
              />
            </div>
          )}

          {orderType === "BRACKET" && (
            <div>
              <Label htmlFor="targetPrice">Target Price</Label>
              <Input
                id="targetPrice"
                type="number"
                value={targetPrice}
                onChange={(e) => setTargetPrice(e.target.value)}
                placeholder="0.00"
                required
                min="0.01"
                step="0.01"
              />
              <p className="text-xs text-gray-500 mt-1 flex items-start gap-1">
                <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                <span>Creates 3 orders: Entry + Stop-Loss + Target</span>
              </p>
            </div>
          )}

          {orderType === "TRAILING_STOP" && (
            <div>
              <Label htmlFor="trailingStopPct">Trailing Stop %</Label>
              <Input
                id="trailingStopPct"
                type="number"
                value={trailingStopPct}
                onChange={(e) => setTrailingStopPct(e.target.value)}
                placeholder="e.g. 2.5"
                required
                min="0.1"
                max="50"
                step="0.1"
              />
              <p className="text-xs text-gray-500 mt-1 flex items-start gap-1">
                <Info className="h-3 w-3 mt-0.5 flex-shrink-0" />
                <span>Stop price adjusts automatically with market movement</span>
              </p>
            </div>
          )}

          {action === "SELL" && productType === "MIS" && (
            <div className="flex items-center gap-2 p-3 bg-yellow-50 border border-yellow-200 rounded-lg">
              <input
                type="checkbox"
                id="allowShort"
                checked={allowShort}
                onChange={(e) => setAllowShort(e.target.checked)}
                className="h-4 w-4"
              />
              <Label htmlFor="allowShort" className="text-sm cursor-pointer">
                Allow short selling (MIS only, must cover by 3:25 PM)
              </Label>
            </div>
          )}
          
          {error && <p className="text-sm text-red-500 text-center">{error}</p>}

          <Button type="submit" className="w-full" disabled={isLoading}>
            {isLoading ? <Loader2 className="animate-spin mx-auto" /> : `Place ${action} Order`}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};

export default TradeForm;
