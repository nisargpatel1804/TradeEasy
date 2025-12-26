import { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { motion } from "framer-motion";
import { toast } from "react-hot-toast";
import * as api from "../services/api.js";
import { Card, CardContent, CardHeader, CardTitle } from "../assets/ui/card.jsx";
import { Skeleton } from "../assets/ui/skeleton.jsx";
import { ArrowLeft, ShoppingCart, Tag, Hash, Calendar, HelpCircle, TrendingUp, TrendingDown } from "lucide-react";
import { Button } from "../assets/ui/button.jsx";
import { cn } from "../utils/cn.js";

const formatStatus = (status = "") => {
  if (!status) return "Unknown";
  return status
    .toString()
    .toLowerCase()
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
};

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
        const data = await api.fetchOrderDetail(orderId);
        if (data.success && data.order) {
          setOrder(data.order);
        } else {
          throw new Error(data.message || `Order with ID ${orderId} not found.`);
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
      <div className="mx-auto max-w-7xl space-y-3 pb-4 pt-2 px-2 sm:px-3 lg:px-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="space-y-1">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
        </div>
        <Card className="mx-auto w-full max-w-3xl rounded-3xl border border-slate-100 shadow-sm">
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
    <div className="mx-auto max-w-7xl space-y-3 pb-4 pt-2 px-2 sm:px-3 lg:px-4">
      <div className="mx-auto w-full max-w-3xl">
        <Button
          asChild
          type="button"
          variant="outline"
          className="h-9 rounded-full border-slate-200 px-4 font-semibold"
        >
          <Link to="/orders" aria-label="Back to orders">
            <ArrowLeft className="h-4 w-4" />
            Back to Orders
          </Link>
        </Button>
      </div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="mx-auto w-full max-w-3xl">
        <Card className="rounded-3xl border border-slate-100 shadow-sm">
          <CardHeader>
            <CardTitle className="text-base font-semibold text-slate-900">Order Details</CardTitle>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <DetailItem icon={ShoppingCart} label="Symbol" value={order.symbol} className="font-bold text-slate-900" />
            <DetailItem 
                icon={isBuy ? TrendingUp : TrendingDown} 
                label="Action" 
                value={order.action}
                className={cn(isBuy ? 'text-emerald-700' : 'text-red-600')}
            />
            <DetailItem icon={Hash} label="Quantity" value={order.quantity} />
            <DetailItem icon={Tag} label="Price" value={`₹${order.price.toFixed(2)}`} />
            <DetailItem icon={HelpCircle} label="Order Type" value={order.order_type} />
            <DetailItem icon={Calendar} label="Date" value={new Date(order.date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })} />
            <div className="sm:col-span-2">
                 <DetailItem 
                  icon={HelpCircle} 
                  label="Status" 
                  value={formatStatus(order.status_display || order.status)}
                  className="font-bold text-slate-900"
                />
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

export default OrderDetail;

