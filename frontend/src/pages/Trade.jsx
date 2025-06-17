import { useState } from "react";
import { placeTrade } from "@/services/api"; // Centralized API call
import { Input } from "@/ui/input.jsx";
import { Button } from "@/ui/button";
import { Card, CardContent } from "@/ui/card";
import { Label } from "@/ui/label";
import { Skeleton } from "@/ui/skeleton";
import { motion } from "framer-motion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/select";

const Trade = () => {
  const [formData, setFormData] = useState({
    symbol: "",
    action: "buy",
    quantity: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");

  const handleChange = (field, value) => {
    setFormData({ ...formData, [field]: value });
    setError(""); // Clear errors on new input
    setSuccess("");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // ✅ Validate symbol (alphanumeric, 1-10 characters)
    const symbolRegex = /^[A-Za-z0-9]{1,10}$/;
    if (!symbolRegex.test(formData.symbol)) {
      setError("Symbol must be alphanumeric (1-10 characters).");
      return;
    }

    // ✅ Validate quantity (positive integer)
    const quantity = Number(formData.quantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError("Quantity must be a positive whole number.");
      return;
    }

    setLoading(true);
    try {
      const response = await placeTrade(formData.action, formData.symbol, quantity);
      setSuccess(response.message || "Trade successful!");
      setError("");
    } catch (err) {
      setError(err.message || "Trade failed. Please try again.");
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
        Trade Stocks
      </motion.h2>

      {error && <p className="text-red-600 mb-4 font-medium">{error}</p>}
      {success && <p className="text-green-600 mb-4 font-medium">{success}</p>}

      <motion.div
        className="w-full max-w-md"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
      >
        <Card className="p-6 bg-gray-100 rounded-lg shadow-md">
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="symbol">Stock Symbol</Label>
              <Input
                id="symbol"
                type="text"
                placeholder="Enter stock symbol (e.g., AAPL)"
                value={formData.symbol}
                onChange={(e) => handleChange("symbol", e.target.value.toUpperCase())}
                aria-label="Stock Symbol Input"
              />
            </div>

            <div>
              <Label htmlFor="quantity">Quantity</Label>
              <Input
                id="quantity"
                type="number"
                placeholder="Enter quantity"
                value={formData.quantity}
                onChange={(e) => handleChange("quantity", e.target.value)}
                aria-label="Quantity Input"
                min="1"
              />
            </div>

            <div>
              <Label htmlFor="action">Action</Label>
              <Select
                onValueChange={(value) => handleChange("action", value)}
                defaultValue="buy"
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
              className={`w-full ${
                formData.action === "buy" ? "bg-green-600" : "bg-red-600"
              } text-white hover:opacity-90 transition-all`}
              onClick={handleSubmit}
              disabled={loading}
              aria-label="Place Order Button"
            >
              {loading ? "Processing..." : "Place Order"}
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

export default Trade;
