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

/**
 * A wrapper component that protects routes requiring authentication.
 * If the user is logged in, it renders the requested component.
 * Otherwise, it redirects the user to the login page.
 */
const ProtectedRoute = ({ children }) => {
  const { isAuthenticated, isLoading } = useAuth();
  
  if (isLoading) {
      // Optional: Render a loading spinner here while auth check completes
      return <div className="flex min-h-screen items-center justify-center bg-gray-50">Loading...</div>;
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
          {/* Legacy redirect for any old links to /markets */}
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
      <Toaster />
    </div>
  );
}

export default App;