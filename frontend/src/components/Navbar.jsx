import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { useDataContext } from '../context/DataContext.jsx';
import priceUpdateService from '../services/priceUpdateService.js';
import * as api from '../services/api.js';
import { Button } from '../components/ui/button.jsx';
import { Avatar, AvatarFallback } from '../components/ui/Avatar.jsx';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu.jsx';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../components/ui/dialog.jsx';
import { LogOut, User, Menu, Plus, ArrowRight, Loader2 } from 'lucide-react';
import { useToast } from '../components/ui/use-toast.js';

const TICKER_CONFIG = [
  {
    key: 'nifty50',
    label: 'Nifty 50',
    symbol: 'NSE:26000',
  },
  {
    key: 'nifty500',
    label: 'Nifty 500',
    symbol: 'NSE:26003',
  },
  {
    key: 'india_vix',
    label: 'India VIX',
    symbol: 'NSE:26051',
  },
];

const TradeEasyLogo = () => (
  <svg viewBox="0 0 144 32" aria-hidden="true" className="h-8 w-auto">
    <defs>
      <linearGradient id="teLogoGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stopColor="#f59e0b" />
        <stop offset="100%" stopColor="#f97316" />
      </linearGradient>
    </defs>
    <g>
      <rect x="1" y="1" width="30" height="30" rx="10" fill="url(#teLogoGrad)" />
      <path d="M9 18h14M9 12h10M9 24h8" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M17 7l7 4v8l-7 4" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
    </g>
    <g fill="#0f172a">
      <text x="40" y="15" fontSize="11" fontWeight="700" fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif">TradeEasy</text>
      <text x="40" y="26" fontSize="8" fontWeight="600" letterSpacing="1" fill="#f59e0b" fontFamily="ui-sans-serif, system-ui, -apple-system, Segoe UI, sans-serif">INVEST SMARTER</text>
    </g>
  </svg>
);

const findIndexMatch = (priceMap = {}, config) => {
  if (!priceMap || !config) {
    return null;
  }

  return config.symbol ? (priceMap[config.symbol] || null) : null;
};

const normaliseIndexPayload = (payload = {}, config) => {
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

  const changeKeys = ['change', 'net_change', 'netChange', 'change_amount'];
  const percentKeys = ['percent_change', 'percentChange', 'change_percent', 'pChange'];

  const hasExplicitChange = changeKeys.some((key) => payload?.[key] !== undefined && payload?.[key] !== null);
  const hasExplicitPercent = percentKeys.some((key) => payload?.[key] !== undefined && payload?.[key] !== null);

  const change = hasExplicitChange
    ? coerceNumber(payload.change ?? payload.net_change ?? payload.netChange ?? payload.change_amount)
    : null;

  const percentChange = hasExplicitPercent
    ? coerceNumber(payload.percent_change ?? payload.percentChange ?? payload.change_percent ?? payload.pChange)
    : null;

  if (price === null) {
    return null;
  }

  return {
    symbol: payload.symbol,
    name: payload.name || config.label || payload.symbol,
    label: config.label || payload.name || payload.symbol,
    price,
    change,
    percentChange,
  };
};

const RESET_NOTE = 'Clears holdings, positions, orders, and performance data.';
const WALLET_LIMIT_OPTIONS = [
  { label: '₹10 Lakh', value: 1_000_000, warning: RESET_NOTE },
  { label: '₹25 Lakh', value: 2_500_000, warning: RESET_NOTE },
  { label: '₹50 Lakh', value: 5_000_000, warning: RESET_NOTE },
  { label: '₹1 Crore', value: 10_000_000, warning: RESET_NOTE },
];

const Navbar = React.forwardRef(({ onToggleSidebar }, ref) => {
  const { isAuthenticated, logout, user } = useAuth();
  const { profileData, indicesData, setProfile } = useDataContext();
  const navigate = useNavigate();
  const { toast } = useToast();

  const [isLoggingOut, setIsLoggingOut] = useState(false);

  const [headlineIndices, setHeadlineIndices] = useState(() => {
    return TICKER_CONFIG.reduce((acc, item) => {
      acc[item.key] = null;
      return acc;
    }, {});
  });
  const [isWalletDialogOpen, setIsWalletDialogOpen] = useState(false);
  const [selectedWalletLimit, setSelectedWalletLimit] = useState(null);
  const [isUpdatingWallet, setIsUpdatingWallet] = useState(false);
  const allowedWalletLimits = useMemo(
    () => new Set(WALLET_LIMIT_OPTIONS.map((o) => o.value)),
    []
  );

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
        const merged = {
          ...normalized,
          change: normalized.change ?? current?.change ?? 0,
          percentChange: normalized.percentChange ?? current?.percentChange ?? 0,
        };

        if (!current ||
          current.price !== merged.price ||
          current.change !== merged.change ||
          current.percentChange !== merged.percentChange ||
          current.name !== merged.name) {
          next[config.key] = merged;
          mutated = true;
        }
      });

      return mutated ? next : prev;
    });
  }, []);

  const handleLogout = async () => {
    if (isLoggingOut) return;
    setIsLoggingOut(true);
    try {
      await logout();
      toast({ title: 'Logged Out', description: 'You have been successfully logged out.' });
    } catch (error) {
      toast({ 
        title: 'Logout Failed', 
        description: 'Could not log out. Please try again or clear your cookies.',
        variant: 'destructive'
      });
    } finally {
      setIsLoggingOut(false);
    }
  };

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    if (!Array.isArray(indicesData) || indicesData.length === 0) {
      return;
    }

    const map = indicesData.reduce((acc, item = {}) => {
      if (item.symbol) {
        acc[item.symbol] = item;
      }
      return acc;
    });

    updateHeadlineFromMap(map);
  }, [indicesData, updateHeadlineFromMap, isAuthenticated]);

  useEffect(() => {
    if (!isAuthenticated) {
      return;
    }

    const unsubscribe = priceUpdateService.subscribe((payload = {}) => {
      if (isWalletDialogOpen) {
        return;
      }
      // changedPrices is {} (empty object) for snapshot/seed events — truthy but
      // meaningless. Prefer allPrices when changedPrices carries no entries.
      const changed = payload.changedPrices;
      const map = (changed && Object.keys(changed).length > 0)
        ? changed
        : (payload.allPrices || {});
      updateHeadlineFromMap(map);
    });

    return () => {
      if (typeof unsubscribe === 'function') {
        unsubscribe();
      }
    };
  }, [updateHeadlineFromMap, isAuthenticated, isWalletDialogOpen]);

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

    // Client-side guard: only allow known preset values
    if (!allowedWalletLimits.has(selectedWalletLimit)) {
      toast({ title: 'Invalid amount', description: 'Please select a valid wallet amount.', variant: 'destructive' });
      return;
    }

    setIsUpdatingWallet(true);
    const controller = new AbortController();
    try {
      const response = await api.updateWalletLimit(selectedWalletLimit, { signal: controller.signal });
      const message = response?.message || 'Wallet limit updated.';
      toast({ title: 'Wallet updated', description: message });

      // if the API returned the updated profile payload we can avoid an
      // extra GET request by patching the context directly.
      if (response?.profile) {
        setProfile(response.profile);
      }

      setIsWalletDialogOpen(false);

      // Yield one frame so loading/close UI can paint before broad reset fan-out.
      await new Promise((resolve) => {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
          window.requestAnimationFrame(() => resolve());
          return;
        }
        setTimeout(resolve, 0);
      });

      priceUpdateService.clearPrices({ defer: true });
      window.dispatchEvent(new CustomEvent('clear-local-search-caches'));
      window.dispatchEvent(new CustomEvent('te:portfolio-reset', {
        detail: {
          resetPerformed: !!response?.reset_performed,
          walletLimit: selectedWalletLimit,
          at: Date.now(),
        },
      }));
    } catch (error) {
      if (error.name === 'CanceledError' || error.name === 'AbortError') {
        // quietly ignore if caller aborted
        return;
      }
      toast({
        title: 'Unable to reset wallet',
        description: error.message || 'Please try again later.',
        variant: 'destructive',
      });
    } finally {
      setIsUpdatingWallet(false);
    }
  }, [selectedWalletLimit, toast, allowedWalletLimits, setProfile]);

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

  if (!isAuthenticated) {
    return null; // Don't render navbar on auth pages
  }

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
          <Link to="/dashboard" className="rounded-2xl border border-amber-200 bg-amber-50/70 px-3 py-1.5">
            <TradeEasyLogo />
          </Link>
        </div>

        <div className="hidden flex-1 items-center justify-center gap-4 overflow-hidden md:flex">
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
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-9 w-9 rounded-full p-0" aria-label="Open account menu" aria-haspopup="menu">
                <Avatar className="h-9 w-9 border-0 shadow-none">
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
              <DropdownMenuItem onClick={handleLogout} disabled={isLoggingOut} className="text-red-600 focus:text-red-600">
                <LogOut className="mr-2 h-4 w-4" />
                <span>Log out</span>
                {isLoggingOut && <Loader2 className="ml-2 h-4 w-4 animate-spin" />}
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
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Wallet reset options">
            {WALLET_LIMIT_OPTIONS.map((option) => {
              const isActive = selectedWalletLimit === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  tabIndex={isActive ? 0 : -1}
                  aria-label={`${option.label}${option.warning ? ' - ' + option.warning : ''}`}
                  onClick={() => {
                    if (selectedWalletLimit !== option.value) {
                      setSelectedWalletLimit(option.value);
                    }
                  }}
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
});
Navbar.displayName = 'Navbar';

const TickerChip = React.memo(({ label, price, change, percent, compact = false }) => {
  const hasPrice = typeof price === 'number' && !Number.isNaN(price);
  const hasChange = typeof change === 'number' && !Number.isNaN(change);
  const hasPercent = typeof percent === 'number' && !Number.isNaN(percent);

  const formatNumber = (value) => {
    if (typeof value !== 'number' || Number.isNaN(value)) {
      return null;
    }
    return value.toLocaleString('en-IN', { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  };

  const isPositive = hasChange && change >= 0;
  const changeColor = isPositive ? 'text-emerald-600' : 'text-red-500';

  if (!hasPrice) {
    return (
      <div className="min-w-[180px] rounded-2xl border border-slate-100 bg-white px-4 py-2 shadow-sm">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
        <div className="mt-2 h-4 w-20 animate-pulse rounded bg-slate-100" />
      </div>
    );
  }

  const formattedChange = hasChange ? `${isPositive ? '+' : ''}${formatNumber(change)}` : null;
  const formattedPercent = hasPercent ? `${percent.toFixed(2)}%` : null;

  return (
    <div className="min-w-[180px] rounded-2xl border border-slate-100 bg-white px-4 py-2 shadow-sm">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <div className="mt-1 flex items-baseline justify-between">
        <span className="text-sm font-bold text-slate-900">{formatNumber(price)}</span>
        {!compact && formattedChange && formattedPercent && (
          <span className={`text-xs font-semibold ${changeColor}`}>
            {formattedChange} ({formattedPercent})
          </span>
        )}
      </div>
      {compact && formattedChange && formattedPercent && (
        <p className={`text-xs font-semibold ${changeColor}`}>
          {formattedChange} ({formattedPercent})
        </p>
      )}
    </div>
  );
});

export default Navbar;