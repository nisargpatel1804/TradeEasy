import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "react-hot-toast";
import * as api from "../services/api.js";
import { Card, CardContent } from "../assets/ui/card.jsx";
import { Button } from "../assets/ui/button.jsx";
import { Skeleton } from "../assets/ui/skeleton.jsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../assets/ui/Tabs.jsx";
import { Scroll, History, X, TrendingUp, Target, AlertCircle } from "lucide-react";

const OrdersPage = () => {
  const [orders, setOrders] = useState({ executed: [], pending: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cancellingOrderId, setCancellingOrderId] = useState(null);

  const loadOrders = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.fetchOrders();
      if (data.success) {
        setOrders({
          executed: data.executed || [],
          pending: data.pending || [],
        });
      } else {
        throw new Error(data.message || "Failed to fetch orders.");
      }
    } catch (err) {
      const errorMessage = err.message || "Could not load your order history.";
      setError(errorMessage);
      toast.error(errorMessage);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const handleCancelOrder = async (orderId) => {
    setCancellingOrderId(orderId);
    try {
      const result = await api.cancelOrder(orderId);
      if (result.success) {
        toast.success(result.message || "Order cancelled successfully");
        // Reload orders
        await loadOrders();
      } else {
        toast.error(result.message || "Failed to cancel order");
      }
    } catch (err) {
      toast.error(err.message || "Error cancelling order");
    } finally {
      setCancellingOrderId(null);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Order History</h1>
        <p className="text-gray-500">Review your executed and pending trades.</p>
      </header>

      <Card className="shadow-lg">
        <CardContent className="p-4">
          <Tabs defaultValue="executed">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="executed">
                <History className="w-4 h-4 mr-2" />
                Executed ({orders.executed.length})
              </TabsTrigger>
              <TabsTrigger value="pending">
                <Scroll className="w-4 h-4 mr-2" />
                Pending ({orders.pending.length})
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="executed" className="mt-4">
              <OrderList orders={orders.executed} isLoading={isLoading} error={error} type="executed" />
            </TabsContent>
            
            <TabsContent value="pending" className="mt-4">
              <OrderList orders={orders.pending} isLoading={isLoading} error={error} type="pending" onCancel={handleCancelOrder} cancellingOrderId={cancellingOrderId} />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

const OrderList = ({ orders, isLoading, error, type, onCancel, cancellingOrderId }) => {
    if (isLoading) {
        return (
            <div className="space-y-4">
                {[...Array(3)].map((_, i) => <OrderCardSkeleton key={i} />)}
            </div>
        );
    }

    if (error && orders.length === 0) {
        return <div className="text-center py-12 text-red-500">{error}</div>;
    }

    if (orders.length === 0) {
        return <div className="text-center py-12 text-gray-500">No {type} orders found.</div>;
    }

    return (
        <div className="space-y-4">
            {orders.map((order, index) => (
                <OrderCard 
                  key={order.id || index} 
                  order={order} 
                  index={index} 
                  isPending={type === "pending"}
                  onCancel={onCancel}
                  isCancelling={cancellingOrderId === order.id}
                />
            ))}
        </div>
    );
};


const OrderCard = ({ order, index, isPending = false, onCancel, isCancelling = false }) => {
  const isBuy = order.action === "BUY";
  
  const getOrderTypeIcon = () => {
    if (order.order_type === 'BRACKET') return <Target className="h-4 w-4" />;
    if (order.order_type === 'TRAILING_STOP') return <TrendingUp className="h-4 w-4" />;
    if (order.order_type === 'STOP_LOSS' || order.order_type === 'STOP_LIMIT') return <AlertCircle className="h-4 w-4" />;
    return null;
  };

  const getProductTypeBadge = (productType) => {
    if (!productType) return null;
    return (
      <span className={`text-xs px-2 py-0.5 rounded ${productType === 'MIS' ? 'bg-orange-100 text-orange-800' : 'bg-blue-100 text-blue-800'}`}>
        {productType}
      </span>
    );
  };
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
    >
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="p-4">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-4 items-center mb-3">
            <div>
              <p className="text-sm text-gray-500">Symbol</p>
              <p className="font-bold text-lg">{order.symbol}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Action</p>
              <div className="flex items-center gap-2">
                <p className={`font-semibold ${isBuy ? "text-green-600" : "text-red-600"}`}>
                  {order.action}
                </p>
                {getProductTypeBadge(order.product_type)}
              </div>
            </div>
            <div>
              <p className="text-sm text-gray-500">Quantity</p>
              <p className="font-semibold">{order.quantity}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Price</p>
              <p className="font-semibold">₹{order.price?.toFixed(2) || 'N/A'}</p>
            </div>
            <div>
              <p className="text-sm text-gray-500">Order Type</p>
              <div className="flex items-center gap-1">
                {getOrderTypeIcon()}
                <p className="font-semibold text-sm">{order.order_type}</p>
              </div>
            </div>
          </div>

          {/* Advanced order details */}
          {(order.stop_loss_price || order.target_price || order.trailing_stop_pct) && (
            <div className="grid grid-cols-3 gap-4 mb-3 p-3 bg-gray-50 rounded-md">
              {order.stop_loss_price && (
                <div>
                  <p className="text-xs text-gray-500">Stop Loss</p>
                  <p className="font-semibold text-sm">₹{order.stop_loss_price.toFixed(2)}</p>
                </div>
              )}
              {order.target_price && (
                <div>
                  <p className="text-xs text-gray-500">Target</p>
                  <p className="font-semibold text-sm">₹{order.target_price.toFixed(2)}</p>
                </div>
              )}
              {order.trailing_stop_pct && (
                <div>
                  <p className="text-xs text-gray-500">Trailing %</p>
                  <p className="font-semibold text-sm">{order.trailing_stop_pct}%</p>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 items-center">
            <div>
              <p className="text-sm text-gray-500">Status</p>
              <p className={`font-semibold capitalize ${
                order.status === 'EXECUTED' ? 'text-green-600' : 
                order.status === 'pending' ? 'text-orange-600' : 
                order.status === 'cancelled' ? 'text-red-600' : 
                order.status === 'failed' ? 'text-red-800' : 
                order.status === 'processing' ? 'text-blue-600' : 'text-gray-600'
              }`}>
                {order.status}
              </p>
            </div>
            <div className="col-span-1 md:col-span-2">
              <p className="text-sm text-gray-500">Date</p>
              <p className="font-semibold text-xs">{new Date(order.date).toLocaleString()}</p>
            </div>
            {isPending && onCancel && (
              <div className="flex justify-end">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => onCancel(order.id)}
                  disabled={isCancelling}
                >
                  {isCancelling ? (
                    <>Cancelling...</>
                  ) : (
                    <>
                      <X className="h-4 w-4 mr-1" />
                      Cancel
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};

const OrderCardSkeleton = () => (
    <Card>
        <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 items-center">
            <div>
                <Skeleton className="h-4 w-1/2 mb-1" />
                <Skeleton className="h-6 w-3/4" />
            </div>
             <div>
                <Skeleton className="h-4 w-1/2 mb-1" />
                <Skeleton className="h-5 w-1/4" />
            </div>
             <div>
                <Skeleton className="h-4 w-1/2 mb-1" />
                <Skeleton className="h-5 w-1/2" />
            </div>
            <div>
                <Skeleton className="h-4 w-1/2 mb-1" />
                <Skeleton className="h-5 w-3/4" />
            </div>
        </CardContent>
    </Card>
);


export default OrdersPage;

