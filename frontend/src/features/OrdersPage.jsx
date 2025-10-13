import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "react-hot-toast";
import * as api from "../services/api.js";
import { Card, CardContent } from "../assets/ui/card.jsx";
import { Skeleton } from "../assets/ui/skeleton.jsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../assets/ui/Tabs.jsx";
import { Scroll, History } from "lucide-react";

const OrdersPage = () => {
  const [orders, setOrders] = useState({ executed: [], pending: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
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

    loadOrders();
  }, []);

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
                <OrderList orders={orders.pending} isLoading={isLoading} error={error} type="pending" />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
};

const OrderList = ({ orders, isLoading, error, type }) => {
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
                <OrderCard key={order.id || index} order={order} index={index} />
            ))}
        </div>
    );
};


const OrderCard = ({ order, index }) => {
  const isBuy = order.action === "BUY";
  
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, delay: index * 0.05 }}
    >
      <Card className="hover:shadow-md transition-shadow">
        <CardContent className="p-4 grid grid-cols-2 md:grid-cols-4 gap-4 items-center">
          <div>
            <p className="text-sm text-gray-500">Symbol</p>
            <p className="font-bold text-lg">{order.symbol}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Action</p>
            <p className={`font-semibold ${isBuy ? "text-green-600" : "text-red-600"}`}>
              {order.action}
            </p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Quantity</p>
            <p className="font-semibold">{order.quantity}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Price</p>
            <p className="font-semibold">₹{order.price.toFixed(2)}</p>
          </div>
          <div>
            <p className="text-sm text-gray-500">Order Type</p>
            <p className="font-semibold">{order.order_type}</p>
          </div>
           <div>
            <p className="text-sm text-gray-500">Status</p>
            <p className="font-semibold capitalize">{order.status}</p>
          </div>
          <div className="col-span-2 md:col-span-1">
            <p className="text-sm text-gray-500">Date</p>
            <p className="font-semibold text-xs">{new Date(order.date).toLocaleString()}</p>
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

