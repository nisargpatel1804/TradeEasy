import { Routes, Route, Navigate, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import Home from '@/pages/Home';
import Trade from '@/pages/Trade';
import Orders from '@/pages/Orders';
import ProfilePage from '@/pages/ProfilePage';
import OrderDetail from '@/components/OrderDetail';
import Signup from '@/components/Signup';
import Login from '@/components/Login';
import Dashboard from '@/components/Dashboard';
import Watchlist from '@/components/Watchlist';
import Performance from '@/components/Performance';
import Portfolio from '@/components/Portfolio';
import "./App.css";
import { useNavigate } from 'react-router-dom';
import React from 'react';
import { isAuthenticated, logout } from '@/services/auth';
import NotFound from '@/components/404';
import Landing from '@/components/Landing';
import Indices from "./components/Indices"; 
import StockMarketView from "./components/StockMarketView";
import { fetchIndices } from "./services/api";
import StockOverview from "@/components/StockOverview"; // Import StockOverview

function App() {
  const navigate = useNavigate();
  const location = useLocation();
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [indices, setIndices] = useState([]); // Store indices data

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const auth = await isAuthenticated();
        setIsLoggedIn(auth);
      } catch (error) {
        console.error("Auth check failed:", error);
        setIsLoggedIn(false);
      } finally {
        setAuthChecked(true); // Ensure auth check completes
      }
    };
    checkAuth();
  }, [location]);

  const handleLogout = async () => {
    try {
      await logout();
      setIsLoggedIn(false);
      navigate("/login");
    } catch (error) {
      console.error("Logout failed:", error);
    }
  };

  if (!authChecked) {
    return <div className="flex justify-center items-center h-screen">Loading...</div>;
  }

  return (
    <div className="flex flex-col min-h-screen bg-background text-foreground">
      <div className="flex-grow p-4">
        <Routes>
          {/* Public Routes */}
          <Route path="/" element={isLoggedIn ? <Navigate to="/dashboard" /> : <Landing />} />
          <Route path="/signup" element={isLoggedIn ? <Navigate to="/dashboard" /> : <Signup />} />
          <Route path="/login" element={isLoggedIn ? <Navigate to="/dashboard" /> : <Login />} />

          {/* Protected Routes */}
          <Route path="/dashboard" element={isLoggedIn ? <Dashboard /> : <Navigate to="/login" replace />} />
          <Route path="/trade" element={isLoggedIn ? <Trade /> : <Navigate to="/login" replace />} />
          <Route path="/orders" element={isLoggedIn ? <Orders /> : <Navigate to="/login" replace />} />
          <Route path="/profile" element={isLoggedIn ? <ProfilePage /> : <Navigate to="/login" replace />} />
          <Route path="/order-detail/:orderId" element={isLoggedIn ? <OrderDetail /> : <Navigate to="/login" replace />} />

          {/* Updated Watchlist Route */}
          <Route path="/watchlist" element={isLoggedIn ? <Watchlist /> : <Navigate to="/login" replace />} />
          {/* Updated Performance Route */}
          <Route path="/performance" element={isLoggedIn ? <Performance /> : <Navigate to="/login" replace />} />
          {/* Updated Portfolio Route */}
          <Route path="/portfolio" element={isLoggedIn ? <Portfolio /> : <Navigate to="/login" replace />} />

          {/* Indices Route */}
          <Route path="/indices" element={isLoggedIn ? <Indices indices={indices} /> : <Navigate to="/login" replace />} />

          {/* New Stock Market View Route */}
          <Route path="/market" element={isLoggedIn ? <StockMarketView /> : <Navigate to="/login" replace />} />

          {/* New Stock Overview Route */}
          <Route
            path="/stock/overview/:symbol"
            element={isLoggedIn ? <StockOverview /> : <Navigate to="/login" replace />}
          />

          {/* 404 Route */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </div>
    </div>
  );
}

export default App;
