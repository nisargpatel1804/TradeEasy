import { useEffect, useState } from "react";
import { fetchOrders } from "@/services/api";
import { Skeleton } from "@/ui/skeleton";
import { Card, CardContent } from "@/ui/card";
import { Button } from "@/ui/button";

const OrderBook = () => {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadOrders = async () => {
    setLoading(true);
    setError("");
    try {
      const data = await fetchOrders();
      setOrders(data);
    } catch (err) {
      setError(err || "Failed to fetch orders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <Skeleton className="w-96 h-24" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <p className="text-red-600">{error}</p>
      </div>
    );
  }

  return (
    <div className="p-8 bg-white">
      <h2 className="text-2xl font-semibold mb-6">Order Book</h2>
      <Button
        className="mb-4 bg-black text-white hover:bg-gray-900"
        onClick={loadOrders}
      >
        Refresh Orders
      </Button>
      <div className="grid gap-4">
        {orders.length === 0 ? (
          <p className="text-gray-600">No orders found.</p>
        ) : (
          orders.map((order, index) => (
            <Card key={index} className="p-4 bg-gray-100 rounded-lg shadow-md">
              <CardContent>
                <p className="font-semibold">Symbol: {order.symbol}</p>
                <p className="text-gray-700">Quantity: {order.quantity}</p>
                <p className="text-gray-700">Price: ₹{order.price.toFixed(2)}</p>
                <p className="text-gray-500">
                  Date: {new Date(order.transaction_date).toLocaleString()}
                </p>
                <p
                  className={`${
                    order.action === "buy" ? "text-green-600" : "text-red-600"
                  } font-bold`}
                >
                  {order.action.toUpperCase()}
                </p>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
};

export default OrderBook;
