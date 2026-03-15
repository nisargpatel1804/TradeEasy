import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";

// Import Page Components
import LandingPage from './features/LandingPage.jsx';
import DashboardPage from './features/DashboardPage.jsx';
import PortfolioPage from './features/PortfolioPage.jsx';
import Watchlist from './features/Watchlist.jsx';
import OrdersPage from './features/OrdersPage.jsx';
import PerformancePage from './features/PerformancePage.jsx';
import ProfilePage from './features/ProfilePage.jsx';
import TradeForm from './features/TradeForm.jsx';
import StockOverview from "./features/StockSections.jsx";
import MarketPage from "./features/MarketPage.jsx";
import Indices from "./features/Indices.jsx";
import OrderDetail from "./features/OrderDetail.jsx";
import NotFoundPage from './features/NotFoundPage.jsx';
import DashboardLayout from "./features/DashboardLayout.jsx";
import { Toaster } from "./assets/ui/toaster.jsx";
import { Toaster as HotToaster } from "react-hot-toast";
import { Skeleton } from "./assets/ui/skeleton.jsx";

const StartupLoadingShell = () => (
  <div className="min-h-screen bg-slate-50 text-slate-900">
    <div className="sticky top-0 z-30 border-b border-slate-200 bg-white/90 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-4">
        <Skeleton className="h-9 w-9 rounded-full" />
        <Skeleton className="h-9 w-32 rounded-full" />
        <Skeleton className="h-9 flex-1 rounded-full" />
        <Skeleton className="h-9 w-24 rounded-full" />
      </div>
    </div>

    <div className="mx-auto flex max-w-[1600px] gap-3 px-2 pt-3 lg:px-3">
      <aside className="hidden w-[340px] shrink-0 rounded-2xl border border-slate-200 bg-white p-3 lg:block">
        <div className="space-y-2">
          {Array.from({ length: 8 }).map((_, index) => (
            <Skeleton key={`watchlist-skeleton-${index}`} className="h-10 w-full rounded-xl" />
          ))}
        </div>
      </aside>

      <main className="flex-1 space-y-3 pb-6">
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={`metric-skeleton-${index}`} className="h-[112px] w-full rounded-3xl" />
          ))}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <Skeleton className="min-h-[430px] w-full rounded-3xl lg:col-span-2" />
          <Skeleton className="min-h-[430px] w-full rounded-3xl" />
        </div>
      </main>
    </div>
  </div>
);

/**
 * A wrapper component that protects routes requiring authentication.
 * If the user is logged in, it renders the requested component.
 * Otherwise, it redirects the user to the login page.
 */
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
      return <StartupLoadingShell />;
  }

  if (!isAuthenticated) {
    // The 'replace' prop prevents the user from navigating back to the protected route
    return <Navigate to="/" replace />;
  }
  return children;
};

/**
 * Wrapper component for the trade page that extracts the symbol from the URL
 * and passes it to the TradeForm component.
 */
const TradePage = () => {
  const { symbol } = useParams();
  // Using a key forces the component to remount if the symbol changes in the URL
  return <TradeForm key={symbol} symbol={symbol} onClose={() => {}} onTradeSuccess={() => {}} />;
};

function App() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900 font-sans antialiased">
      <HotToaster />
      <Toaster />
      <Routes>
        {/* --- Public Routes --- */}
        <Route path="/" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LandingPage initialMode="login" />} />
        <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LandingPage initialMode="login" />} />
        <Route path="/signup" element={isAuthenticated ? <Navigate to="/dashboard" replace /> : <LandingPage initialMode="signup" />} />

        {/* --- Protected Routes w/ Dashboard layout --- */}
        {/* The Layout is rendered only if authenticated */}
        <Route element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/portfolio" element={<PortfolioPage />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/performance" element={<PerformancePage />} />
          <Route path="/profile" element={<ProfilePage />} />
          
          {/* Market Routes */}
          <Route path="/markets" element={<Navigate to="/market" replace />} />
          <Route path="/market" element={<MarketPage />} />
          <Route path="/indices" element={<Indices />} />
          
          {/* Stock & Trading Routes */}
          <Route path="/trade/:symbol" element={<TradePage />} />
          {/* Support both URL patterns for stock details */}
          <Route path="/stock/overview/:symbol" element={<StockOverview />} />
          <Route path="/stock/:symbol" element={<StockOverview />} />
          
          <Route path="/order-detail/:orderId" element={<OrderDetail />} />
        </Route>

        {/* --- 404 Not Found Route --- */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </div>
  );
}

export default App;