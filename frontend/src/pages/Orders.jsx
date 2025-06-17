import { useEffect, useState } from "react";
import { fetchOrderDetail } from "@/services/api"; // Use centralized API call
import { Skeleton } from "@/ui/skeleton";
import { Card, CardContent } from "@/ui/card";
import { motion } from "framer-motion";

const Orders = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchOrders = async () => {
      setLoading(true);
      setError("");

      try {
        const data = await fetchOrderDetail(); // Fetch orders from API
        if (!data || data.length === 0) {
          setError("No orders found.");
        } else {
          setOrders(data);
        }
      } catch (err) {
        setError("Failed to fetch orders. Please try again later.");
      } finally {
        setLoading(false);
      }
    };

    fetchOrders();
  }, []);

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-white gap-4">
        {[...Array(3)].map((_, index) => (
          <Skeleton key={index} className="w-96 h-24" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <p className="text-red-600 font-medium">{error}</p>
      </div>
    );
  }

  return (
    <div className="p-8 bg-white">
      <motion.h2
        className="text-2xl font-semibold mb-6 text-center"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        Orders
      </motion.h2>

      <div className="grid gap-4">
        {orders.map((order, index) => (
          <motion.div
            key={order.id || index}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5, delay: index * 0.1 }}
          >
            <Card className="p-4 bg-gray-100 rounded-lg shadow-md">
              <CardContent>
                <p className="font-semibold">Symbol: {order.symbol || "N/A"}</p>
                <p
                  className={`font-bold ${
                    order.action?.toLowerCase() === "buy"
                      ? "text-green-600"
                      : "text-red-600"
                  }`}
                >
                  {order.action?.toUpperCase() || "N/A"}
                </p>
                <p className="text-gray-700">Quantity: {order.quantity ?? "N/A"}</p>
                <p className="text-gray-700">
                  Price: ₹{order.price ? order.price.toFixed(2) : "0.00"}
                </p>
                <p className="text-gray-500">
                  Date:{" "}
                  {order.transaction_date
                    ? new Date(order.transaction_date).toLocaleString()
                    : "N/A"}
                </p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>
    </div>
  );
};

export default Orders;
