import { useEffect, useState } from "react";
import { fetchOrders } from "@/services/api";
import { Skeleton } from "@/assets/ui/skeleton";
import { Card, CardContent } from "@/assets/ui/card";
import { motion } from "framer-motion";

const Orders = () => {
  const [executedOrders, setExecutedOrders] = useState([]);
  const [pendingOrders, setPendingOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    const loadOrders = async () => {
      setLoading(true);
      setError("");

      try {
        const data = await fetchOrders();
        const executed = data?.executed_orders ?? [];
        const pending = data?.pending_orders ?? [];

        setExecutedOrders(executed);
        setPendingOrders(pending);

        if ((executed.length + pending.length) === 0) {
          setError("You haven't placed any orders yet.");
        }
      } catch (err) {
        const apiMessage = err?.response?.data?.error;
        setError(apiMessage || "Failed to fetch orders. Please try again later.");
      } finally {
        setLoading(false);
      }
    };

    loadOrders();
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

  const renderOrderCard = (order, index) => (
    <motion.div
      key={order.id || `${order.symbol}-${index}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: index * 0.05 }}
    >
      <Card className="p-4 bg-gray-100 rounded-lg shadow-md">
        <CardContent className="space-y-2">
          <p className="font-semibold">Symbol: {order.symbol || "N/A"}</p>
          <p
            className={`font-bold ${
              order.action?.toLowerCase() === "buy" ? "text-green-600" : "text-red-600"
            }`}
          >
            {order.action?.toUpperCase() || "N/A"}
          </p>
          <p className="text-gray-700">Quantity: {order.quantity ?? "N/A"}</p>
          {order.price !== undefined && order.price !== null && (
            <p className="text-gray-700">Price: ₹{Number(order.price).toFixed(2)}</p>
          )}
          {order.limit_price !== undefined && order.limit_price !== null && (
            <p className="text-gray-700">Limit: ₹{Number(order.limit_price).toFixed(2)}</p>
          )}
          {order.stop_loss !== undefined && order.stop_loss !== null && (
            <p className="text-gray-700">Stop Loss: ₹{Number(order.stop_loss).toFixed(2)}</p>
          )}
          <p className="text-gray-500">
            Date: {order.date ? new Date(order.date).toLocaleString() : "N/A"}
          </p>
          <p className="text-sm text-gray-500">Type: {order.order_type?.toUpperCase() || "N/A"}</p>
        </CardContent>
      </Card>
    </motion.div>
  );

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

      <div className="space-y-8">
        <section>
          <h3 className="text-xl font-semibold mb-4">Executed Orders</h3>
          {executedOrders.length === 0 ? (
            <p className="text-gray-500">No executed orders yet.</p>
          ) : (
            <div className="grid gap-4">
              {executedOrders.map((order, index) => renderOrderCard(order, index))}
            </div>
          )}
        </section>

        <section>
          <h3 className="text-xl font-semibold mb-4">Pending Orders</h3>
          {pendingOrders.length === 0 ? (
            <p className="text-gray-500">No pending orders at the moment.</p>
          ) : (
            <div className="grid gap-4">
              {pendingOrders.map((order, index) => renderOrderCard(order, index))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
};

export default Orders;
