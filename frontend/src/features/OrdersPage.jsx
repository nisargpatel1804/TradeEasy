import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "react-hot-toast";
import * as api from "../services/api.js";
import { Card, CardContent } from "../assets/ui/card.jsx";
import { Button } from "../assets/ui/button.jsx";
import { Skeleton } from "../assets/ui/skeleton.jsx";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../assets/ui/Tabs.jsx";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../assets/ui/dialog.jsx";
import { Scroll, History, X, Ban, TrendingUp, Target, AlertCircle } from "lucide-react";

const OrdersPage = () => {
  const [orders, setOrders] = useState({ executed: [], pending: [], cancelled: [] });
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [cancellingOrderId, setCancellingOrderId] = useState(null);
  const [selectedOrder, setSelectedOrder] = useState(null);
  const [showOrderDetail, setShowOrderDetail] = useState(false);

  const loadOrders = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const data = await api.fetchOrders();
      if (data.success) {
        setOrders({
          executed: data.executed || [],
          pending: data.pending || [],
          cancelled: data.cancelled || [],
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
    setSelectedOrder(order);
    setShowOrderDetail(true);
  };

  const formatCurrency = (value) => {
    if (typeof value !== 'number') return '₹0.00';
    return `₹${value.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  };

  const getPnlColor = (value) => {
    if (value > 0) return 'text-green-600';
    if (value < 0) return 'text-red-600';
    return 'text-gray-700';
  };

  return (
    <div className="p-4 md:p-8 max-w-7xl mx-auto">
      <header className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900">Orders</h1>
        <p className="text-gray-500">View and manage your orders.</p>
      </header>

      <Card className="shadow-lg">
        <CardContent className="p-4">
          <Tabs defaultValue="executed">
            <TabsList className="grid w-full grid-cols-3">
              <TabsTrigger value="executed">
                <History className="w-4 h-4 mr-2" />
                Executed ({orders.executed.length})
              </TabsTrigger>
              <TabsTrigger value="pending">
                <Scroll className="w-4 h-4 mr-2" />
                Pending ({orders.pending.length})
              </TabsTrigger>
              <TabsTrigger value="cancelled">
                <Ban className="w-4 h-4 mr-2" />
                Cancelled ({orders.cancelled.length})
              </TabsTrigger>
            </TabsList>
            
            <TabsContent value="executed" className="mt-4">
              <OrderList 
                orders={orders.executed} 
                isLoading={isLoading} 
                error={error} 
                type="executed" 
                onOrderClick={handleOrderClick}
              />
            </TabsContent>
            
            <TabsContent value="pending" className="mt-4">
              <OrderList 
                orders={orders.pending} 
                isLoading={isLoading} 
                error={error} 
                type="pending" 
                onCancel={handleCancelOrder} 
                cancellingOrderId={cancellingOrderId}
                onOrderClick={handleOrderClick}
              />
            </TabsContent>

            <TabsContent value="cancelled" className="mt-4">
              <OrderList 
                orders={orders.cancelled} 
                isLoading={isLoading} 
                error={error} 
                type="cancelled"
                onOrderClick={handleOrderClick}
              />
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>

      {/* Order Detail Dialog */}
      {selectedOrder && (
        <Dialog open={showOrderDetail} onOpenChange={setShowOrderDetail}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle>Order Details - {selectedOrder.symbol}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <DetailItem label="Total Shares" value={selectedOrder.quantity} />
                <DetailItem label="Symbol" value={selectedOrder.symbol} />
                <DetailItem label="Order Type" value={selectedOrder.order_type} />
                <DetailItem label="Average Price" value={formatCurrency(selectedOrder.price)} />
                <DetailItem label="Validity" value={selectedOrder.product_type === 'MIS' ? 'Intraday' : 'Delivery'} />
                <DetailItem 
                  label="Status" 
                  value={selectedOrder.status}
                  className={`capitalize ${
                    selectedOrder.status === 'EXECUTED' ? 'text-green-600' :
                    selectedOrder.status === 'pending' ? 'text-orange-600' :
                    selectedOrder.status === 'cancelled' ? 'text-red-600' :
                    'text-gray-600'
                  }`}
                />
                {selectedOrder.pnl !== undefined && (
                  <DetailItem 
                    label="Profit/Loss" 
                    value={formatCurrency(selectedOrder.pnl)}
                    className={getPnlColor(selectedOrder.pnl)}
                  />
                )}
                {selectedOrder.stop_loss_price && (
                  <DetailItem label="Stop Loss" value={formatCurrency(selectedOrder.stop_loss_price)} />
                )}
                {selectedOrder.target_price && (
                  <DetailItem label="Target" value={formatCurrency(selectedOrder.target_price)} />
                )}
                <DetailItem label="Margin Used" value={formatCurrency(selectedOrder.quantity * selectedOrder.price)} />
                <DetailItem label="Charges" value={formatCurrency(0)} />
                <DetailItem 
                  label="Order Date" 
                  value={new Date(selectedOrder.date).toLocaleString()}
                  className="col-span-2"
                />
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
};

const DetailItem = ({ label, value, className = "" }) => (
  <div>
    <p className="text-sm text-gray-500">{label}</p>
    <p className={`font-semibold ${className}`}>{value}</p>
  </div>
);

const OrderList = ({ orders, isLoading, error, type, onCancel, cancellingOrderId, onOrderClick }) => {
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
                  onClick={() => onOrderClick(order)}
                />
            ))}
        </div>
    );
};

const OrderCard = ({ order, index, isPending = false, onCancel, isCancelling = false, onClick }) => {
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
      <Card className="hover:shadow-md transition-shadow cursor-pointer" onClick={onClick}>
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
              <div className="flex justify-end" onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="destructive"
                  size="sm"
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
