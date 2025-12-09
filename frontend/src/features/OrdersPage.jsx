import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import * as api from "../services/api.js";
import { Card, CardContent } from "../assets/ui/card.jsx";
import { Button } from "../assets/ui/button.jsx";
import { Skeleton } from "../assets/ui/skeleton.jsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../assets/ui/Tabs.jsx";
import { Scroll, History, Ban, TrendingUp, Target, AlertCircle, X } from "lucide-react";

const STATUS_TABS = [
  { value: "executed", label: "Executed", icon: History },
  { value: "pending", label: "Pending", icon: Scroll },
  { value: "cancelled", label: "Cancelled", icon: Ban },
];

const INITIAL_ORDERS_STATE = STATUS_TABS.reduce((acc, tab) => {
  acc[tab.value] = [];
  return acc;
}, {});

const STATUS_COLOR_MAP = {
  EXECUTED: "text-green-600",
  PENDING: "text-orange-600",
  CANCELLED: "text-red-600",
};

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

const OrdersPage = () => {
  const [orders, setOrders] = useState(INITIAL_ORDERS_STATE);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cancellingOrderId, setCancellingOrderId] = useState(null);
  const navigate = useNavigate();
  const defaultTab = STATUS_TABS[0].value;

  const loadOrders = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.fetchOrders();
      if (data.success) {
        const normalizedOrders = STATUS_TABS.reduce((acc, tab) => {
          const bucket = data[tab.value];
          acc[tab.value] = Array.isArray(bucket) ? bucket : [];
          return acc;
        }, {});
        setOrders(normalizedOrders);
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

  const handleOrderClick = (order) => {
    if (!order?.id) {
      return;
    }
    navigate(`/order-detail/${order.id}`);
  };


  const pageShellClasses = "mx-auto max-w-6xl space-y-6 px-2 pb-10 pt-4 sm:px-4 lg:px-8";

  return (
    <div className={pageShellClasses}>
      <header className="space-y-2">
        <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Order Desk</p>
        <h1 className="text-3xl font-bold text-slate-900">Orders</h1>
        <p className="text-sm text-slate-500">Monitor fills, manage pending legs, and inspect detailed execution history.</p>
      </header>

      <Card className="rounded-3xl border border-slate-100 shadow-sm">
        <CardContent className="p-4 sm:p-6">
          <Tabs defaultValue={defaultTab} className="space-y-6">
            <TabsList className="grid w-full grid-cols-1 gap-2 rounded-2xl border border-slate-200 bg-slate-50 p-1 text-sm md:grid-cols-3">
              {STATUS_TABS.map(({ value, label, icon: TabIcon }) => (
                <TabsTrigger
                  value={value}
                  key={value}
                  className="flex items-center justify-center gap-2 rounded-xl px-3 py-2 font-semibold"
                >
                  <TabIcon className="h-4 w-4" />
                  <span>{label}</span>
                  <span className="rounded-full bg-white/70 px-2 py-0.5 text-xs text-slate-600">
                    {orders[value]?.length || 0}
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>

            {STATUS_TABS.map(({ value, label }) => (
              <TabsContent value={value} className="space-y-4" key={value}>
                <OrderList
                  orders={orders[value] || []}
                  isLoading={isLoading}
                  error={error}
                  statusKey={value}
                  statusLabel={label}
                  onCancel={value === 'pending' ? handleCancelOrder : undefined}
                  cancellingOrderId={value === 'pending' ? cancellingOrderId : undefined}
                  onOrderClick={handleOrderClick}
                />
              </TabsContent>
            ))}
          </Tabs>
        </CardContent>
      </Card>

    </div>
  );
};

const OrderList = ({ orders, isLoading, error, statusKey, statusLabel, onCancel, cancellingOrderId, onOrderClick }) => {
  if (isLoading) {
    return (
      <div className="space-y-4">
        {[...Array(3)].map((_, i) => <OrderCardSkeleton key={i} />)}
      </div>
    );
  }

  if (error && orders.length === 0) {
    return (
      <div className="rounded-3xl border border-red-200 bg-red-50/60 p-10 text-center text-sm font-semibold text-red-600">
        {error}
      </div>
    );
  }

  if (orders.length === 0) {
    return (
      <div className="rounded-3xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">
        No {statusLabel.toLowerCase()} orders found.
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {orders.map((order, index) => (
        <OrderCard
          key={order.id || index}
          order={order}
          index={index}
          isPending={statusKey === 'pending'}
          onCancel={onCancel}
          isCancelling={cancellingOrderId === order.id}
          onClick={() => onOrderClick(order)}
        />
      ))}
    </div>
  );
};

const OrderCard = ({ order, index, isPending = false, onCancel, isCancelling = false, onClick }) => {
  const isBuy = order.action === "BUY";
  const statusKey = (order.status || '').toUpperCase();
  const statusClass = STATUS_COLOR_MAP[statusKey] || 'text-gray-600';
  const displayStatus = order.status_display
    ? formatStatus(order.status_display)
    : formatStatus(statusKey);
  const showCancel = isPending && statusKey === 'PENDING' && onCancel;
  
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
      <Card className="cursor-pointer rounded-3xl border border-slate-100 shadow-sm transition-all hover:-translate-y-0.5 hover:bg-slate-50" onClick={onClick}>
        <CardContent className="space-y-4 p-4 sm:p-6">
          <div className="grid grid-cols-2 items-center gap-4 md:grid-cols-5">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Symbol</p>
              <p className="text-lg font-bold text-slate-900">{order.symbol}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Action</p>
              <div className="flex items-center gap-2">
                <p className={`text-sm font-semibold ${isBuy ? "text-green-600" : "text-red-600"}`}>
                  {order.action}
                </p>
                {getProductTypeBadge(order.product_type)}
              </div>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Quantity</p>
              <p className="font-semibold text-slate-900">{order.quantity}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Price</p>
              <p className="font-semibold text-slate-900">₹{order.price?.toFixed(2) || 'N/A'}</p>
            </div>
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Order Type</p>
              <div className="flex items-center gap-1 text-sm font-semibold text-slate-900">
                {getOrderTypeIcon()}
                <span>{order.order_type}</span>
              </div>
            </div>
          </div>

          {(order.stop_loss_price || order.target_price || order.trailing_stop_pct) && (
            <div className="grid grid-cols-1 gap-3 rounded-2xl bg-slate-50/80 p-4 text-sm text-slate-600 sm:grid-cols-3">
              {order.stop_loss_price && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Stop Loss</p>
                  <p className="font-semibold text-slate-900">₹{order.stop_loss_price.toFixed(2)}</p>
                </div>
              )}
              {order.target_price && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Target</p>
                  <p className="font-semibold text-slate-900">₹{order.target_price.toFixed(2)}</p>
                </div>
              )}
              {order.trailing_stop_pct && (
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Trailing %</p>
                  <p className="font-semibold text-slate-900">{order.trailing_stop_pct}%</p>
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-2 items-center gap-4 md:grid-cols-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Status</p>
              <p className={`text-sm font-semibold ${statusClass}`}>
                {displayStatus}
              </p>
            </div>
            <div className="col-span-1 md:col-span-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Date</p>
              <p className="text-sm font-semibold text-slate-900">{new Date(order.date).toLocaleString()}</p>
            </div>
            {showCancel && (
              <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full border-red-200 text-red-600 hover:bg-red-50"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancel(order.id);
                  }}
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
  <Card className="rounded-3xl border border-slate-100 shadow-sm">
    <CardContent className="grid grid-cols-2 items-center gap-4 p-4 md:grid-cols-4">
      {[...Array(4)].map((_, idx) => (
        <div key={idx}>
          <Skeleton className="mb-2 h-3 w-16" />
          <Skeleton className="h-5 w-20" />
        </div>
      ))}
    </CardContent>
  </Card>
);

export default OrdersPage;
