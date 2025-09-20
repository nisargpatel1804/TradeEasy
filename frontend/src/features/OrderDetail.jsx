import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { fetchOrderDetail } from "@/services/api";
import { Skeleton } from "@/assets/ui/skeleton";
import { Card, CardContent } from "@/assets/ui/card";
import { Button } from "@/assets/ui/button";

const OrderDetail = () => {
  const { orderId } = useParams();
  const [order, setOrder] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadOrderDetail = async () => {
    if (!orderId) {
      setError("Invalid Order ID");
      setLoading(false);
      return;
    }

    setLoading(true);
    setError("");
    try {
      const data = await fetchOrderDetail(orderId);
      setOrder(data);
    } catch (err) {
      setError(err?.message || "Failed to fetch order details");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadOrderDetail();
  }, [orderId]); // ✅ Correct dependency

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

  if (!order) return null; // ✅ Prevents errors

  return (
    <div className="p-8 bg-white">
      <h2 className="text-2xl font-semibold mb-6">Order Details</h2>
      <Button
        className="mb-4 bg-black text-white hover:bg-gray-900"
        onClick={loadOrderDetail}
      >
        Refresh Details
      </Button>
      <Card className="p-4 bg-gray-100 rounded-lg shadow-md">
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
    </div>
  );
};

export default OrderDetail;
