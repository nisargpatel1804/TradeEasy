import { Routes, Route, Navigate, useParams } from "react-router-dom";
import { useAuth } from "./context/AuthContext.jsx";

// Import Page Components
import LandingPage from './features/LandingPage.jsx';
import LoginPage from './features/LoginPage.jsx';
import SignupPage from './features/SignupPage.jsx';
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
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) {
    // The 'replace' prop prevents the user from navigating back to the protected route
    return <Navigate to="/login" replace />;
  }
  return children;
};

/**
 * Wrapper component for the trade page that extracts the symbol from the URL
 * and passes it to the TradeForm component.
 */
const TradePage = () => {
  const { symbol } = useParams();
  return <TradeForm symbol={symbol} onClose={() => {}} onTradeSuccess={() => {}} />;
};

function App() {
  const { isAuthenticated } = useAuth();

  return (
    <div className="min-h-screen bg-gray-50 text-gray-900">
      <Routes>
        {/* --- Public Routes --- */}
        <Route path="/" element={isAuthenticated ? <Navigate to="/dashboard" /> : <LandingPage />} />
        <Route path="/login" element={isAuthenticated ? <Navigate to="/dashboard" /> : <LoginPage />} />
        <Route path="/signup" element={isAuthenticated ? <Navigate to="/dashboard" /> : <SignupPage />} />

        {/* --- Protected Routes w/ Dashboard layout --- */}
        <Route element={<ProtectedRoute><DashboardLayout /></ProtectedRoute>}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/portfolio" element={<PortfolioPage />} />
          <Route path="/watchlist" element={<Watchlist />} />
          <Route path="/orders" element={<OrdersPage />} />
          <Route path="/performance" element={<PerformancePage />} />
          <Route path="/profile" element={<ProfilePage />} />
          <Route path="/market" element={<MarketPage />} />
          <Route path="/indices" element={<Indices />} />
          <Route path="/trade/:symbol" element={<TradePage />} />
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

