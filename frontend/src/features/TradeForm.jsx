import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import * as api from "../services/api.js";
import { Input } from "../assets/ui/input.jsx";
import { Button } from "../assets/ui/button.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "../assets/ui/card.jsx";
import { Label } from "../assets/ui/label.jsx";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "../assets/ui/select.jsx";
import { toast } from "react-hot-toast";
import { Loader2 } from "lucide-react";

const TradeForm = ({ symbol: initialSymbol = "", onTradeSuccess, onClose }) => {
  const { isAuthenticated } = useAuth();
  const [action, setAction] = useState("BUY");
  const [orderType, setOrderType] = useState("MARKET");
  const [quantity, setQuantity] = useState("");
  const [price, setPrice] = useState("");
  const [symbol, setSymbol] = useState(initialSymbol);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState(null);
  
  // Update symbol if the initial prop changes
  useEffect(() => {
    setSymbol(initialSymbol.toUpperCase());
  }, [initialSymbol]);

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
      price: orderType === "LIMIT" ? parseFloat(price) : undefined,
    };

    const toastId = toast.loading("Placing order...");

    try {
      // The `placeTrade` function in `api.js` now correctly routes to /buy or /sell.
      const result = await api.placeTrade(tradeData);
      if (result.success) {
        toast.success(result.message || "Trade executed successfully!", { id: toastId });
        // Reset form state after successful trade
        setQuantity("");
        setPrice("");
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

  return (
    <Card className="w-full max-w-md mx-auto shadow-lg">
      <CardHeader>
        <CardTitle className="text-center text-2xl font-bold">Place Order</CardTitle>
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
            <Label htmlFor="orderType">Order Type</Label>
             <Select onValueChange={setOrderType} defaultValue="MARKET">
              <SelectTrigger id="orderType">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="MARKET">Market</SelectItem>
                <SelectItem value="LIMIT">Limit</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {orderType === "LIMIT" && (
            <div>
              <Label htmlFor="price">Limit Price</Label>
              <Input
                id="price"
                type="number"
                value={price}
                onChange={(e) => setPrice(e.target.value)}
                placeholder="0.00"
                required={orderType === "LIMIT"}
                min="0.01"
                step="0.01"
              />
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

