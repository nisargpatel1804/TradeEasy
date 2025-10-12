import { useState, useEffect } from "react";
import { placeTrade } from "@/services/api";
import { Input } from "@/assets/ui/input";
import { Button } from "@/assets/ui/button";
import { Card, CardContent } from "@/assets/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/assets/ui/select";
import { Skeleton } from "@/assets/ui/skeleton";
import { Label } from "@/assets/ui/label";
import { motion } from "framer-motion";
import { useToast } from "@/assets/ui/use-toast";
import { useAuth } from "@/context/AuthContext.jsx";

const TradeForm = ({ symbol, defaultAction = "buy", onClose, onTradeSuccess }) => {
  const [formData, setFormData] = useState({
    symbol: symbol ? symbol.toUpperCase() : "",
    action: defaultAction,
    quantity: "",
    orderType: "market",
    price: ""
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { toast } = useToast();
  const { clientId } = useAuth();

  // Update formData.symbol if the symbol prop changes
  useEffect(() => {
    if (symbol) {
      setFormData((prev) => ({ ...prev, symbol: symbol.toUpperCase() }));
    }
  }, [symbol]);

  const handleChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setError("");
  };

  const validateForm = () => {
    // Symbol validation
    const symbolRegex = /^[A-Z0-9]{1,12}(?:\.(?:NS|NSE|BSE|BO))?$/;
    if (!symbolRegex.test(formData.symbol)) {
      setError("Symbol must be 1-12 uppercase letters/numbers with optional .NS or .BO suffix");
      return false;
    }

    // Quantity validation
    const quantity = Number(formData.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError("Quantity must be a positive whole number");
      return false;
    }

    // Price validation for limit orders
    if (formData.orderType === "limit") {
      const price = Number(formData.price);
      if (isNaN(price) || price <= 0) {
        setError("Price must be a positive number for limit orders");
        return false;
      }
    }

    return true;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!validateForm()) return;

    if (!clientId) {
      const sessionError = "Your session is inactive. Please log in again.";
      setError(sessionError);
      toast({
        title: "Trade unavailable",
        description: sessionError,
        variant: "destructive",
      });
      return;
    }

    setLoading(true);
    try {
      const [baseSymbol, rawSuffix] = formData.symbol.split(".");
      let exchangeHint;
      if (rawSuffix) {
        const suffix = rawSuffix.toUpperCase();
        if (suffix === "NS" || suffix === "NSE") exchangeHint = "NSE";
        if (suffix === "BO" || suffix === "BSE") exchangeHint = "BSE";
      }

      const payload = {
        action: formData.action,
        symbol: formData.symbol,
        quantity: Number(formData.quantity),
        orderType: formData.orderType,
        price: formData.orderType === "limit" ? Number(formData.price) : undefined,
        client_id: clientId,
        exchange: exchangeHint,
      };

      const response = await placeTrade(payload);

      toast({
        title: "Trade Successful",
        description: response.message || `${formData.action.toUpperCase()} order placed`,
        variant: "default",
      });

      // Reset form but keep symbol
      setFormData(prev => ({
        ...prev,
        quantity: "",
        price: "",
        action: defaultAction,
        orderType: "market"
      }));

      if (onTradeSuccess) onTradeSuccess(response);
      if (onClose) onClose();
    } catch (err) {
      console.error("Trade error:", err);
      const responseData = err?.response?.data;
      const apiMessage = responseData?.error;
      const errorCode = responseData?.code ? ` (${responseData.code})` : "";
      const errorMessage = apiMessage
        ? `${apiMessage}${errorCode}`
        : err.message || "Trade failed. Please try again.";
      
      toast({
        title: "Trade Failed",
        description: errorMessage,
        variant: "destructive",
      });
      
      setError(errorMessage);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-8 bg-white flex flex-col items-center">
      <motion.h2
        className="text-2xl font-semibold mb-6"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        {formData.action === "buy" ? "Buy Stocks" : "Sell Stocks"}
      </motion.h2>

      <motion.div
        className="w-full max-w-md"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
      >
        <Card className="p-6 bg-gray-100 rounded-lg shadow-md">
          <CardContent className="space-y-4">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <Label htmlFor="symbol">Stock Symbol</Label>
                <Input
                  id="symbol"
                  type="text"
                  placeholder="Enter stock symbol (e.g., TCS.NS)"
                  value={formData.symbol}
                  onChange={(e) => handleChange("symbol", e.target.value.toUpperCase())}
                  disabled={!!symbol}
                  aria-label="Stock Symbol Input"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Format: SYMBOL or SYMBOL.EXCHANGE (e.g., TCS or TCS.NS)
                </p>
              </div>

              <div>
                <Label htmlFor="quantity">Quantity</Label>
                <Input
                  id="quantity"
                  type="number"
                  placeholder="Enter quantity"
                  value={formData.quantity}
                  onChange={(e) => handleChange("quantity", e.target.value)}
                  min="1"
                  step="1"
                  aria-label="Quantity Input"
                />
              </div>

              <div>
                <Label htmlFor="orderType">Order Type</Label>
                <Select
                  id="orderType"
                  onValueChange={(value) => handleChange("orderType", value)}
                  value={formData.orderType}
                  aria-label="Order Type Select"
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select order type" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="market">Market</SelectItem>
                    <SelectItem value="limit">Limit</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {formData.orderType === "limit" && (
                <div>
                  <Label htmlFor="price">Price</Label>
                  <Input
                    id="price"
                    type="number"
                    placeholder="Enter limit price"
                    value={formData.price}
                    onChange={(e) => handleChange("price", e.target.value)}
                    min="0.01"
                    step="0.01"
                    aria-label="Price Input"
                  />
                </div>
              )}

              <div>
                <Label htmlFor="action">Action</Label>
                <Select
                  id="action"
                  onValueChange={(value) => handleChange("action", value)}
                  value={formData.action}
                  aria-label="Trade Action Select"
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select action" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="buy">Buy</SelectItem>
                    <SelectItem value="sell">Sell</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                type="submit"
                className={`w-full ${
                  formData.action === "buy" 
                    ? "bg-green-600 hover:bg-green-700" 
                    : "bg-red-600 hover:bg-red-700"
                } text-white transition-colors`}
                disabled={loading}
                aria-label={formData.action === "buy" ? "Buy Stock Button" : "Sell Stock Button"}
              >
                {loading ? (
                  <Skeleton className="w-6 h-6 mx-auto" />
                ) : (
                  `${formData.action === "buy" ? "Buy" : "Sell"} ${formData.symbol || "Stock"}`
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

export default TradeForm;