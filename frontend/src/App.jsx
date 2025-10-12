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
import ProfilePage from './features/ProfilePage.jsx';
import TradeForm from './features/TradeForm.jsx';
import { StockOverview } from "./features/StockSections.jsx";
import MarketPage from "./features/MarketPage.jsx";
import Indices from "./features/Indices.jsx";
import OrderDetail from "./features/OrderDetail.jsx";
import NotFoundPage from './features/NotFoundPage.jsx';
import Navbar from "./features/Navbar.jsx";
import { Toaster } from "@/assets/ui/toaster.jsx";

/**
 * A wrapper component that protects routes requiring authentication.
 * If the user is logged in, it renders the requested component.
 * Otherwise, it redirects the user to the login page.
 */
const ProtectedRoute = ({ children }) => {
  const { isLoggedIn } = useAuth();
  if (!isLoggedIn) {
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
  const { isLoggedIn } = useAuth();

  return (
    <div className="flex flex-col min-h-screen bg-gray-50 text-gray-900">
      {/* The Navbar will only be displayed for logged-in users */}
      {isLoggedIn && <Navbar />}
      
      <main className="flex-grow p-4 md:p-6 lg:p-8">
        <Routes>
          {/* --- Public Routes --- */}
          {/* These routes are accessible to everyone. If a logged-in user tries to
              access them, they are redirected to their dashboard. */}
          <Route path="/" element={isLoggedIn ? <Navigate to="/dashboard" /> : <LandingPage />} />
          <Route path="/login" element={isLoggedIn ? <Navigate to="/dashboard" /> : <LoginPage />} />
          <Route path="/signup" element={isLoggedIn ? <Navigate to="/dashboard" /> : <SignupPage />} />

          {/* --- Protected Routes --- */}
          {/* These routes are wrapped with the ProtectedRoute component to ensure
              only authenticated users can access them. */}
          <Route path="/dashboard" element={<ProtectedRoute><DashboardPage /></ProtectedRoute>} />
          <Route path="/portfolio" element={<ProtectedRoute><PortfolioPage /></ProtectedRoute>} />
          <Route path="/watchlist" element={<ProtectedRoute><Watchlist /></ProtectedRoute>} />
          <Route path="/orders" element={<ProtectedRoute><OrdersPage /></ProtectedRoute>} />
          <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          <Route path="/market" element={<ProtectedRoute><MarketPage /></ProtectedRoute>} />
          <Route path="/indices" element={<ProtectedRoute><Indices /></ProtectedRoute>} />
          <Route path="/trade/:symbol" element={<ProtectedRoute><TradePage /></ProtectedRoute>} />
          <Route path="/stock/overview/:symbol" element={<ProtectedRoute><StockOverview /></ProtectedRoute>} />
          <Route path="/order-detail/:orderId" element={<ProtectedRoute><OrderDetail /></ProtectedRoute>} />
          
          {/* --- 404 Not Found Route --- */}
          {/* This catch-all route renders if no other route matches. */}
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </main>
      <Toaster />
    </div>
  );
}

export default App;

