import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useDataContext } from '../context/DataContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import priceUpdateService from '../services/priceUpdateService.js';
import * as api from '../services/api.js';
import { Button } from '../assets/ui/button.jsx';
import { Avatar, AvatarFallback } from '../assets/ui/Avatar.jsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../assets/ui/dropdown-menu.jsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../assets/ui/dialog.jsx';
import { LogOut, User, Menu, Bell, Plus, ArrowRight, Loader2 } from 'lucide-react';
import { useToast } from '../assets/ui/use-toast.js';

const TICKER_CONFIG = [
  {
    key: 'nifty50',
    label: 'Nifty 50',
    hints: ['NSE:26000', 'NIFTY 50', 'NIFTY50'],
  },
  {
    key: 'gift_nifty',
    label: 'Gift Nifty',
    hints: ['NSEIFSC:NIFTY', 'GIFT NIFTY', 'GIFTNIFTY'],
  },
  {
    key: 'india_vix',
    label: 'India VIX',
    hints: ['INDIA VIX', 'NSE:INDIAVIX', 'INDIAVIX'],
  },
];

const findIndexMatch = (priceMap = {}, config) => {
  if (!priceMap || !config) {
    return null;
  }

  for (const hint of config.hints || []) {
    if (priceMap[hint]) {
      return priceMap[hint];
    }
  }

  const fallbackKey = Object.keys(priceMap).find((symbol) => {
    const item = priceMap[symbol];
    const normalizedName = item?.name?.toLowerCase() || '';
    return normalizedName.includes((config.label || '').toLowerCase());
  });

  return fallbackKey ? priceMap[fallbackKey] : null;
};

const RESET_NOTE = 'Clears holdings, positions, orders, and performance data.';
const WALLET_LIMIT_OPTIONS = [
  { label: '₹10 Lakh', value: 1_000_000, warning: RESET_NOTE },
  { label: '₹25 Lakh', value: 2_500_000, warning: RESET_NOTE },
  { label: '₹50 Lakh', value: 5_000_000, warning: RESET_NOTE },
  { label: '₹1 Crore', value: 10_000_000, warning: RESET_NOTE },
];

const Navbar = ({ onToggleSidebar }) => {
  const { isAuthenticated, logout, user } = useAuth();
  const { profileData, indicesData, refreshProfile } = useDataContext();
  const { isConnected, connectionStatus } = useSocket();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [headlineIndices, setHeadlineIndices] = useState(() =>
    TICKER_CONFIG.reduce((acc, item) => {
      acc[item.key] = null;
      return acc;
    }, {})
  );
  const [isWalletDialogOpen, setIsWalletDialogOpen] = useState(false);
  const [selectedWalletLimit, setSelectedWalletLimit] = useState(null);
  const [isUpdatingWallet, setIsUpdatingWallet] = useState(false);

  const normaliseIndexPayload = useCallback((payload = {}, config) => {
    if (!payload || !config) {
      return null;
    }

    const coerceNumber = (value) => {
      if (typeof value === 'number' && Number.isFinite(value)) {
        return value;
      }
      const parsed = parseFloat(value);
      return Number.isFinite(parsed) ? parsed : null;
    };

    const price = coerceNumber(payload.price ?? payload.ltp ?? payload.last_price ?? payload.lastTradedPrice ?? payload.value);
    const change = coerceNumber(payload.change ?? payload.net_change ?? payload.netChange ?? payload.change_amount);
    const percentChange = coerceNumber(payload.percent_change ?? payload.percentChange ?? payload.change_percent ?? payload.pChange);

    if (price === null) {
      return null;
    }

    return {
      symbol: payload.symbol,
      name: payload.name || config.label || payload.symbol,
      label: config.label || payload.name || payload.symbol,
      price,
      change: change ?? 0,
      percentChange: percentChange ?? 0,
    };
  }, []);

  const updateHeadlineFromMap = useCallback((priceMap = {}) => {
    if (!priceMap || typeof priceMap !== 'object') {
      return;
    }

    setHeadlineIndices((prev) => {
      let mutated = false;
      const next = { ...prev };

      TICKER_CONFIG.forEach((config) => {
        const match = findIndexMatch(priceMap, config);
        const normalized = normaliseIndexPayload(match, config);
        if (!normalized) {
          return;
        }

        const current = prev[config.key];
        if (!current ||
          current.price !== normalized.price ||
          current.change !== normalized.change ||
          current.percentChange !== normalized.percentChange ||
          current.name !== normalized.name) {
          next[config.key] = normalized;
          mutated = true;
        }
      });

      return mutated ? next : prev;
    });
  }, [normaliseIndexPayload]);

  const handleLogout = async () => {
    try {
      await logout();
      toast({ title: 'Logged Out', description: 'You have been successfully logged out.' });
    } catch (error) {
      console.error("Logout failed:", error);
      toast({ 
        title: 'Logout Failed', 
        description: 'Could not log out. Please try again or clear your cookies.',
        variant: 'destructive'
      });
    }
  };

  useEffect(() => {
    if (!Array.isArray(indicesData) || indicesData.length === 0) {
      return;
    }

    const map = indicesData.reduce((acc, item = {}) => {
      if (item.symbol) {
        acc[item.symbol] = item;
      }
      return acc;
    }, {});

    updateHeadlineFromMap(map);
  }, [indicesData, updateHeadlineFromMap]);

  useEffect(() => {
    const unsubscribe = priceUpdateService.subscribe((payload = {}) => {
      updateHeadlineFromMap(payload.allPrices || {});
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [updateHeadlineFromMap]);

  if (!isAuthenticated) {
    return null; // Don't render navbar on auth pages
  }

  const profileInitial = profileData?.username?.charAt(0).toUpperCase() || user?.username?.charAt(0).toUpperCase() || 'U';
  const walletBalance = useMemo(() => {
    const amount = profileData?.available_balance ?? profileData?.balance ?? 0;
    if (typeof amount !== 'number') {
      return '₹0.00';
    }
    return amount.toLocaleString('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }, [profileData]);

  const handleWalletLimitSubmit = useCallback(async () => {
    if (!selectedWalletLimit) {
      return;
    }
    setIsUpdatingWallet(true);
    try {
      const response = await api.updateWalletLimit(selectedWalletLimit);
      const message = response?.message || 'Wallet limit updated.';
      toast({ title: 'Wallet updated', description: message });
      await refreshProfile();
      setIsWalletDialogOpen(false);
    } catch (error) {
      toast({
        title: 'Unable to reset wallet',
        description: error.message || 'Please try again later.',
        variant: 'destructive',
      });
    } finally {
      setIsUpdatingWallet(false);
    }
  }, [selectedWalletLimit, toast, refreshProfile]);

  useEffect(() => {
    if (!isWalletDialogOpen) {
      setSelectedWalletLimit(null);
    }
  }, [isWalletDialogOpen]);

  const tickerItems = useMemo(() => {
    return TICKER_CONFIG.map((config) => {
      const data = headlineIndices[config.key];
      return {
        key: config.key,
        label: config.label,
        price: data?.price ?? null,
        change: data?.change ?? null,
        percent: data?.percentChange ?? null,
      };
    });
  }, [headlineIndices]);

  return (
    <header className="fixed inset-x-0 top-0 z-50 border-b border-slate-200 bg-white/80 backdrop-blur supports-[backdrop-filter]:bg-white/60">
      <div className="flex items-center justify-between gap-4 px-4 py-3 lg:px-8">
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            className="lg:hidden"
            onClick={onToggleSidebar}
            aria-label="Open watchlist"
          >
            <Menu className="h-5 w-5" />
          </Button>
          <Link to="/dashboard" className="flex items-center gap-3 rounded-full bg-amber-50 px-4 py-2 text-amber-800">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-white text-base font-bold text-amber-700 shadow-inner">
              TE
            </span>
            <div>
              <p className="text-sm font-semibold leading-tight">TradeEasy</p>
              <div className="text-[10px] font-semibold uppercase tracking-widest text-amber-500">Invest Smarter</div>
            </div>
          </Link>
        </div>

        <div className="hidden flex-1 items-center justify-center gap-4 overflow-x-auto md:flex">
          {tickerItems.map((item) => (
            <TickerChip key={item.key} label={item.label} price={item.price} change={item.change} percent={item.percent} />
          ))}
          <Link
            to="/indices"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-800 transition hover:border-amber-300"
            aria-label="Open indices overview"
          >
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="flex items-center gap-3">
          <div className="hidden items-center gap-3 rounded-full border border-slate-200 bg-white px-4 py-1.5 shadow-sm sm:flex">
            <div>
              <p className="text-xs text-slate-500">Wallet Balance</p>
              <p className="text-sm font-bold text-slate-900">{walletBalance}</p>
            </div>
            <Button
              size="icon"
              className="h-8 w-8 rounded-full bg-amber-500 text-white"
              aria-label="Reset portfolio"
              onClick={() => setIsWalletDialogOpen(true)}
            >
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="flex items-center gap-2 rounded-full border border-slate-200 px-3 py-1 text-xs font-medium text-slate-600">
            <span className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-amber-400'}`} />
            {connectionStatus === 'reconnecting' ? 'Reconnecting' : isConnected ? 'Live' : 'Offline'}
          </div>
          <Button variant="ghost" size="icon" aria-label="Notifications">
            <Bell className="h-5 w-5 text-slate-600" />
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-9 w-9 rounded-full border border-slate-200">
                <Avatar className="h-9 w-9">
                  <AvatarFallback>{profileInitial}</AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">{profileData?.username || user?.username}</p>
                  <p className="text-xs leading-none text-muted-foreground">{profileData?.email}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => navigate('/profile')}>
                <User className="mr-2 h-4 w-4" />
                <span>Profile</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleLogout} className="text-red-600 focus:text-red-600">
                <LogOut className="mr-2 h-4 w-4" />
                <span>Log out</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <div className="flex gap-3 overflow-x-auto border-t border-slate-100 px-4 py-2 md:hidden">
        {tickerItems.map((item) => (
          <TickerChip key={item.key} label={item.label} price={item.price} change={item.change} percent={item.percent} compact />
        ))}
        <Link
          to="/indices"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-amber-200 bg-amber-50 text-amber-800"
          aria-label="Open indices overview"
        >
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      <Dialog open={isWalletDialogOpen} onOpenChange={setIsWalletDialogOpen}>
        <DialogContent className="max-w-lg rounded-3xl">
          <DialogHeader>
            <DialogTitle>Reset Wallet Limit</DialogTitle>
            <DialogDescription>
              Pick a preset amount to refresh your simulated balance. Every reset clears holdings, positions,
              orders, and performance data for the selected account.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-2">
            {WALLET_LIMIT_OPTIONS.map((option) => {
              const isActive = selectedWalletLimit === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => setSelectedWalletLimit(option.value)}
                  className={`rounded-2xl border px-4 py-3 text-left text-sm font-semibold transition ${
                    isActive ? 'border-amber-500 bg-amber-50 text-amber-900' : 'border-slate-200 bg-white text-slate-700'
                  }`}
                >
                  {option.label}
                  {option.warning && (
                    <p className="mt-1 text-xs font-normal text-red-500">{option.warning}</p>
                  )}
                </button>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIsWalletDialogOpen(false)} disabled={isUpdatingWallet}>
              Cancel
            </Button>
            <Button onClick={handleWalletLimitSubmit} disabled={!selectedWalletLimit || isUpdatingWallet}>
              {isUpdatingWallet && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Reset Portfolio
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </header>
  );
};

const TickerChip = ({ label, price, change, percent, compact = false }) => {
  const formatNumber = (value) => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return '--';
    }
    return value.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  };

  const isPositive = typeof change === 'number' && change >= 0;
  const changeColor = isPositive ? 'text-emerald-600' : 'text-red-500';

  return (
    <div className="min-w-[180px] rounded-2xl border border-slate-100 bg-white px-4 py-2 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 flex items-baseline justify-between">
        <span className="text-sm font-bold text-slate-900">{formatNumber(price)}</span>
        {!compact && (
          <span className={`text-xs font-semibold ${changeColor}`}>
            {isPositive ? '+' : ''}{formatNumber(change)} ({typeof percent === 'number' ? `${percent.toFixed(2)}%` : '--'})
          </span>
        )}
      </div>
      {compact && (
        <p className={`text-xs font-semibold ${changeColor}`}>
          {isPositive ? '+' : ''}{formatNumber(change)} ({typeof percent === 'number' ? `${percent.toFixed(2)}%` : '--'})
        </p>
      )}
    </div>
  );
};

export default Navbar;

