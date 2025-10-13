import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "react-hot-toast";
import * as api from "../services/api.js";
import { Card, CardContent, CardHeader, CardTitle } from "../assets/ui/card.jsx";
import { Skeleton } from "../assets/ui/skeleton.jsx";
import { ArrowLeft, ShoppingCart, Tag, Hash, Calendar, HelpCircle, TrendingUp, TrendingDown } from "lucide-react";

const OrderDetail = () => {
  const { orderId } = useParams();
  const [order, setOrder] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const loadOrderDetail = async () => {
      if (!orderId) {
        setError("No Order ID provided.");
        setIsLoading(false);
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        // NOTE: The backend does not currently support fetching a single order.
        // This is a placeholder for when `fetchOrderDetail(orderId)` is implemented.
        // For now, we will simulate this by fetching all orders and finding the one.
        const data = await api.fetchOrders();
        if (data.success) {
            const allOrders = [...(data.executed || []), ...(data.pending || [])];
            const foundOrder = allOrders.find(o => o.id === orderId);
            if(foundOrder) {
                setOrder(foundOrder);
            } else {
                throw new Error(`Order with ID ${orderId} not found.`);
            }
        } else {
            throw new Error(data.message || "Failed to fetch orders.");
        }

      } catch (err) {
        const errorMessage = err.message || "Could not load order details.";
        setError(errorMessage);
        toast.error(errorMessage);
      } finally {
        setIsLoading(false);
      }
    };

    loadOrderDetail();
  }, [orderId]);
  
  const DetailItem = ({ icon: Icon, label, value, className = "" }) => (
    <div className="flex items-start">
        <Icon className="w-5 h-5 text-gray-400 mt-1 mr-4" />
        <div>
            <p className="text-sm text-gray-500">{label}</p>
            <p className={`font-semibold text-gray-800 ${className}`}>{value}</p>
        </div>
    </div>
  );

  if (isLoading) {
    return (
        <div className="p-4 md:p-8 max-w-2xl mx-auto">
            <Skeleton className="h-8 w-1/4 mb-6" />
            <Card>
                <CardHeader><Skeleton className="h-6 w-1/2" /></CardHeader>
                <CardContent className="space-y-4">
                    {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
                </CardContent>
            </Card>
        </div>
    );
  }

  if (error) {
    return <div className="text-center py-20 text-red-500">{error}</div>;
  }
  
  if (!order) {
     return <div className="text-center py-20 text-gray-500">Order details could not be loaded.</div>;
  }

  const isBuy = order.action === "BUY";

  return (
    <div className="p-4 md:p-8 max-w-2xl mx-auto">
        <Link to="/orders" className="flex items-center text-sm text-gray-600 hover:text-gray-900 mb-4">
            <ArrowLeft className="w-4 h-4 mr-2" />
            Back to All Orders
        </Link>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
        <Card className="shadow-lg">
          <CardHeader>
            <CardTitle>Order Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 sm:grid-cols-2 gap-6">
            <DetailItem icon={ShoppingCart} label="Symbol" value={order.symbol} className="font-bold text-lg" />
            <DetailItem 
                icon={isBuy ? TrendingUp : TrendingDown} 
                label="Action" 
                value={order.action}
                className={isBuy ? 'text-green-600' : 'text-red-600'}
            />
            <DetailItem icon={Hash} label="Quantity" value={order.quantity} />
            <DetailItem icon={Tag} label="Price" value={`₹${order.price.toFixed(2)}`} />
            <DetailItem icon={HelpCircle} label="Order Type" value={order.order_type} />
            <DetailItem icon={Calendar} label="Date" value={new Date(order.date).toLocaleString()} />
            <div className="sm:col-span-2">
                 <DetailItem 
                    icon={HelpCircle} 
                    label="Status" 
                    value={order.status.charAt(0).toUpperCase() + order.status.slice(1)}
                    className="font-bold"
                />
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

export default OrderDetail;

