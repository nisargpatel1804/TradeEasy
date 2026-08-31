import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "react-hot-toast";
import { useNavigate } from "react-router-dom";
import * as api from "../services/api.js";
import { useDataContext } from "../context/DataContext.jsx";
import { Card, CardContent } from "../components/ui/card.jsx";
import { Button } from "../components/ui/button.jsx";
import { Skeleton } from "../components/ui/skeleton.jsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/Tabs.jsx";
import { Scroll, History, Ban, TrendingUp, Target, AlertCircle, X, ArrowLeft } from "lucide-react";
import { cn } from "../lib/cn.js";
import { pickLivePriceForSymbol } from "../lib/symbolUtils.js";

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
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [cancellingOrderId, setCancellingOrderId] = useState(null);
  const [modifyingOrderId, setModifyingOrderId] = useState(null);
  const navigate = useNavigate();
  const { getOrders, livePrices } = useDataContext();
  const defaultTab = STATUS_TABS[0].value;

  const loadOrders = useCallback(async ({ force = false, showLoader = false } = {}) => {
    if (showLoader) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setError(null);
    try {
      const result = await getOrders(undefined, 100, force);
      const data = result?.data;
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
      setIsRefreshing(false);
    }
  }, [getOrders]);

  useEffect(() => {
    loadOrders({ force: false, showLoader: true });
  }, [loadOrders]);

  useEffect(() => {
    const tradeSuccessHandler = (event) => {
      const optimistic = event?.detail?.optimisticOrder;
      if (optimistic?.id || optimistic?.symbol) {
        const normalized = {
          id: optimistic.id || `${optimistic.symbol}-${Date.now()}`,
          symbol: optimistic.symbol,
          action: optimistic.transaction_type || optimistic.action || 'SELL',
          quantity: optimistic.quantity || 0,
          price: optimistic.price || 0,
          status: optimistic.status || 'EXECUTED',
          status_display: optimistic.status || 'EXECUTED',
          date: optimistic.date || new Date().toISOString(),
          order_type: optimistic.order_type || 'MARKET',
          product_type: optimistic.product_type || 'CNC',
        };
        setOrders((prev) => ({
          ...prev,
          executed: [normalized, ...(prev.executed || [])].slice(0, 100),
        }));
      }
      loadOrders({ force: true });
    };

    const resetHandler = () => {
      loadOrders({ force: true, showLoader: false });
    };

    window.addEventListener('te:trade-success', tradeSuccessHandler);
    window.addEventListener('te:portfolio-reset', resetHandler);
    return () => {
      window.removeEventListener('te:trade-success', tradeSuccessHandler);
      window.removeEventListener('te:portfolio-reset', resetHandler);
    };
  }, [loadOrders]);

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

  const handleModifyOrder = async (order) => {
    if (!order?.id) return;

    const currentQty = Number(order.quantity) || 0;
    const currentPrice = Number(order.price) || 0;

    const qtyInput = window.prompt("Modify quantity (leave blank to keep unchanged)", String(currentQty));
    if (qtyInput === null) return;

    const priceInput = window.prompt("Modify price (leave blank to keep unchanged)", String(currentPrice));
    if (priceInput === null) return;

    const payload = {};

    if (String(qtyInput).trim() !== "") {
      const parsedQty = Number.parseInt(String(qtyInput).trim(), 10);
      if (!Number.isInteger(parsedQty) || parsedQty <= 0) {
        toast.error("Quantity must be a positive integer.");
        return;
      }
      payload.quantity = parsedQty;
    }

    if (String(priceInput).trim() !== "") {
      const parsedPrice = Number.parseFloat(String(priceInput).trim());
      if (!Number.isFinite(parsedPrice) || parsedPrice <= 0) {
        toast.error("Price must be a positive number.");
        return;
      }
      payload.price = parsedPrice;
    }

    if (Object.keys(payload).length === 0) {
      toast("No changes provided.", { icon: "ℹ️" });
      return;
    }

    setModifyingOrderId(order.id);
    try {
      const result = await api.modifyOrder(order.id, payload);
      if (result?.success) {
        toast.success(result.message || "Order modified successfully.");
        await loadOrders();
      } else {
        toast.error(result?.message || "Failed to modify order.");
      }
    } catch (err) {
      toast.error(err?.message || "Failed to modify order.");
    } finally {
      setModifyingOrderId(null);
    }
  };

  const handleOrderClick = (order) => {
    if (!order?.id) {
      return;
    }
    navigate(`/order-detail/${order.id}`);
  };

  const pageShellClasses = "mx-auto max-w-7xl space-y-3 pb-4 pt-2 px-2 sm:px-3 lg:px-4";

  return (
    <div className={pageShellClasses}>
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-full border-slate-200"
            onClick={() => navigate(-1)}
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Order Desk</p>
            <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">Orders</h1>
            <p className="text-xs font-medium text-slate-500">Monitor fills, manage pending legs, and inspect execution history.</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {isRefreshing && (
            <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-[11px] font-semibold text-amber-700">
              Refreshing
            </span>
          )}
          <span className={cn(
            "inline-flex items-center rounded-full border px-3 py-1 text-[11px] font-semibold",
            "border-slate-200 bg-slate-50 text-slate-600"
          )}>
            Total {Object.values(orders || {}).reduce((sum, bucket) => sum + (Array.isArray(bucket) ? bucket.length : 0), 0)}
          </span>
        </div>
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
                  livePrices={livePrices}
                  onCancel={value === 'pending' ? handleCancelOrder : undefined}
                  onModify={value === 'pending' ? handleModifyOrder : undefined}
                  cancellingOrderId={value === 'pending' ? cancellingOrderId : undefined}
                  modifyingOrderId={value === 'pending' ? modifyingOrderId : undefined}
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

const OrderList = ({ orders, isLoading, error, statusKey, statusLabel, livePrices, onCancel, onModify, cancellingOrderId, modifyingOrderId, onOrderClick }) => {
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
          onModify={onModify}
          isCancelling={cancellingOrderId === order.id}
          isModifying={modifyingOrderId === order.id}
          livePrices={livePrices}
          onClick={() => onOrderClick(order)}
        />
      ))}
    </div>
  );
};

const OrderCard = ({ order, index, isPending = false, livePrices, onCancel, onModify, isCancelling = false, isModifying = false, onClick }) => {
  const isBuy = order.action === "BUY";
  const statusKey = (order.status || '').toUpperCase();
  const statusClass = STATUS_COLOR_MAP[statusKey] || 'text-gray-600';
  const displayStatus = order.status_display
    ? formatStatus(order.status_display)
    : formatStatus(statusKey);
  const live = pickLivePriceForSymbol(livePrices || {}, order.symbol);
  const liveLtp = Number(live?.ltp ?? live?.price);
  const showCancel = isPending && statusKey === 'PENDING' && onCancel;
  const showModify = isPending && statusKey === 'PENDING' && onModify;
  
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
              {Number.isFinite(liveLtp) && liveLtp > 0 && (
                <p className="text-[11px] font-semibold text-slate-500">LTP ₹{liveLtp.toFixed(2)}</p>
              )}
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
              <p className="text-sm font-semibold text-slate-900">{new Date(order.date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}</p>
            </div>
            {showCancel && (
              <div className="flex justify-end gap-2" onClick={(e) => e.stopPropagation()}>
                {showModify && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="rounded-full border-slate-300 text-slate-700 hover:bg-slate-50"
                    onClick={(e) => {
                      e.stopPropagation();
                      onModify(order);
                    }}
                    disabled={isModifying || isCancelling}
                  >
                    {isModifying ? "Modifying..." : "Modify"}
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  className="rounded-full border-red-200 text-red-600 hover:bg-red-50"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCancel(order.id);
                  }}
                  disabled={isCancelling || isModifying}
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