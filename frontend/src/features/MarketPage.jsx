import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle } from '../assets/ui/card.jsx';
import { Button } from '../assets/ui/button.jsx';
import { Input } from '../assets/ui/input.jsx';
import { Skeleton } from '../assets/ui/skeleton.jsx';
import { RefreshCw, Search, TrendingUp, TrendingDown, Activity, ArrowUpRight, ArrowDownRight, ArrowLeft } from 'lucide-react';
import * as api from '../services/api.js';
import priceUpdateService from '../services/priceUpdateService.js';

const SUMMARY_CARDS = [
  { key: 'total_count', label: 'Constituents', icon: Activity, tone: 'neutral' },
  { key: 'gainer_count', label: 'Advancing', icon: TrendingUp, tone: 'positive' },
  { key: 'loser_count', label: 'Declining', icon: TrendingDown, tone: 'negative' },
];

const MAX_HIGHLIGHTS = 10;

const MarketPage = () => {
  const navigate = useNavigate();
  const [marketData, setMarketData] = useState({
    stocks: [],
    total_count: 0,
    gainer_count: 0,
    loser_count: 0,
    unchanged: 0,
  });
  
  // Local state to track live prices overlaid on top of static API data
  const [livePrices, setLivePrices] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // --- Data Fetching ---

  const fetchMarketData = useCallback(async (isBackground = false) => {
    if (!isBackground) {
      if (!marketData.stocks.length) setIsLoading(true);
      else setIsRefreshing(true);
    }
    
    setError(null);

    try {
      const data = await api.fetchMarket();
      
      if (data.success) {
        // Normalize the static data immediately
        const normalizedStocks = (Array.isArray(data.stocks) ? data.stocks : []).map((stock) => ({
          ...stock,
          price: typeof stock.ltp === 'number' ? stock.ltp : (typeof stock.price === 'number' ? stock.price : 0),
          change: Number(stock.change) || 0,
          percent_change: Number(stock.percent_change) || 0
        }));

        setMarketData({
          ...data,
          stocks: normalizedStocks,
        });

        // CRITICAL: Seed the price service so the socket knows the initial state
        // This prevents "flicker" where data might be 0 until the next tick
        const seedMap = normalizedStocks.reduce((acc, stock) => {
          if (stock.symbol) {
            acc[stock.symbol] = {
              symbol: stock.symbol,
              ltp: stock.price,
              change: stock.change,
              percent_change: stock.percent_change,
            };
          }
          return acc;
        }, {});
        
        // Push initial state to the service logic
        if (priceUpdateService && typeof priceUpdateService.seedPrices === 'function') {
            priceUpdateService.seedPrices(seedMap);
        }
        
        // Also initialize local livePrices state
        setLivePrices(seedMap);

      } else {
        throw new Error(data.message || 'Failed to fetch market data');
      }
    } catch (err) {
      console.error("Market fetch error:", err);
      setError(err.message || "Failed to load market data.");
      if (!isBackground) {
          toast.error("Could not update market data.");
      }
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [marketData.stocks.length]);

  // Initial load
  useEffect(() => {
    fetchMarketData();
  }, [fetchMarketData]);

  // --- WebSocket Subscription ---

  useEffect(() => {
    const unsubscribe = priceUpdateService.subscribe(update => {
      setLivePrices(currentPrices => {
        // Helper to safely merge a dictionary of updates into current state
        const mergePrices = (source) => {
          if (!source || Object.keys(source).length === 0) {
            return null;
          }

          const normalized = {};
          let hasChanges = false;

          for (const [symbol, value] of Object.entries(source)) {
            if (!value) continue;

            const existing = currentPrices[symbol] || {};
            
            // Optimization: Only update if value actually changed to avoid render thrashing
            if (existing.ltp === value.ltp && existing.change === value.change) {
                continue;
            }

            const mergedEntry = {
              ...existing,
              ...value,
            };

            // Normalize 'ltp' vs 'price' keys
            if (typeof value.ltp === 'number') {
              mergedEntry.price = value.ltp;
            } else if (typeof value.price === 'number') {
              mergedEntry.price = value.price;
            }

            normalized[symbol] = mergedEntry;
            hasChanges = true;
          }

          return hasChanges ? normalized : null;
        };

        if (update?.type === 'reset') {
            // If socket reconnects/resets, we might want to keep existing or clear
            // Keeping existing is safer for UX to prevent flashing
            return currentPrices;
        }

        if (update?.type === 'snapshot') {
          const mergedSnapshot = mergePrices(update?.allPrices);
          return mergedSnapshot ? { ...currentPrices, ...mergedSnapshot } : currentPrices;
        }

        // Standard partial update
        const mergedChanges = mergePrices(update?.changedPrices);
        return mergedChanges ? { ...currentPrices, ...mergedChanges } : currentPrices;
      });
    });

    return () => unsubscribe();
  }, []);

  // --- Derived State ---

  const enrichedStocks = useMemo(() => {
    const list = marketData.stocks || [];
    let result = list.map((stock) => {
      // Overlay live price if available
      const live = livePrices[stock.symbol];
      if (live) {
          return { 
              ...stock, 
              ...live, 
              // Ensure numeric consistency
              price: Number(live.price || live.ltp || stock.price || 0),
              change: Number(live.change || stock.change || 0),
              percent_change: Number(live.percent_change || stock.percent_change || 0)
          };
      }
      return stock;
    });

    // Client-side Search Filtering
    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      result = result.filter((stock) =>
        (stock.symbol || '').toLowerCase().includes(query) ||
        (stock.name || '').toLowerCase().includes(query)
      );
    }

    return result.sort((a, b) => (a.symbol || '').localeCompare(b.symbol || ''));
  }, [marketData.stocks, livePrices, searchQuery]);

  const movers = useMemo(() => {
    const gainers = enrichedStocks
      .filter((item) => Number(item.change) > 0)
      .sort((a, b) => Number(b.percent_change) - Number(a.percent_change))
      .slice(0, MAX_HIGHLIGHTS);

    const losers = enrichedStocks
      .filter((item) => Number(item.change) < 0)
      .sort((a, b) => Number(a.percent_change) - Number(b.percent_change))
      .slice(0, MAX_HIGHLIGHTS);

    return { gainers, losers };
  }, [enrichedStocks]);

  // --- Handlers ---

  const handleStockClick = (symbol) => {
    if (symbol) {
        navigate(`/stock/${symbol.split('.')[0]}`);
    }
  };

  const renderStockList = () => {
    if (isLoading && !enrichedStocks.length) {
      return <ListSkeleton />;
    }

    if (error && !enrichedStocks.length) {
      return (
        <div className="flex flex-col items-center justify-center p-8 text-center text-red-500">
            <p className="font-semibold">{error}</p>
            <Button variant="outline" size="sm" onClick={() => fetchMarketData()} className="mt-4">
                Retry
            </Button>
        </div>
      );
    }

    if (!enrichedStocks.length) {
      return <div className="p-8 text-center text-slate-500">No constituents match your search.</div>;
    }

    return enrichedStocks.map((stock) => (
      <StockRow key={stock.symbol} stock={stock} onSelect={handleStockClick} />
    ));
  };

  return (
      <div className="mx-auto max-w-7xl space-y-3 pb-4 pt-2 px-2 sm:px-3 lg:px-4">
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
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Live Movers</p>
              <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">Nifty 50 Heat Map</h1>
              <p className="text-xs font-medium text-slate-500">Top gainers and laggards from the benchmark index.</p>
            </div>
          </div>
          <Button 
            onClick={() => fetchMarketData()} 
            disabled={isLoading || isRefreshing} 
            variant="outline" 
            className="rounded-full bg-white shadow-sm hover:bg-slate-50"
          >
            <RefreshCw className={`mr-2 h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </header>

        <div className="grid gap-4 md:grid-cols-3">
          {SUMMARY_CARDS.map(({ key, label, icon: Icon, tone }) => (
            <SummaryCard
              key={key}
              label={label}
              value={marketData[key] ?? 0}
              Icon={Icon}
              tone={tone}
            />
          ))}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <MoversCard title="Top Gainers" items={movers.gainers} tone="positive" onSelect={handleStockClick} isLoading={isLoading && !movers.gainers.length} />
          <MoversCard title="Top Losers" items={movers.losers} tone="negative" onSelect={handleStockClick} isLoading={isLoading && !movers.losers.length} />
        </div>

        <Card className="rounded-3xl border border-slate-100 shadow-sm">
          <CardHeader className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-xl font-semibold text-slate-900">All Constituents</CardTitle>
              <p className="text-sm text-slate-500">Browse the full Nifty 50 basket without switching filters.</p>
            </div>
            <div className="relative w-full max-w-sm">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <Input
                placeholder="Search by symbol or company"
                className="rounded-full border-slate-200 bg-white pl-10 focus-visible:ring-slate-900"
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <div className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
              {renderStockList()}
            </div>
          </CardContent>
        </Card>
      </div>
  );
};

// --- Helper Functions & Components ---

const formatNumber = (value) => {
  const num = parseFloat(value);
  return Number.isFinite(num) ? num.toFixed(2) : '0.00';
};

const formatPercent = (value) => {
  const num = parseFloat(value);
  if (!Number.isFinite(num)) return '0.00%';
  const sign = num > 0 ? '+' : num < 0 ? '-' : '';
  return `${sign}${Math.abs(num).toFixed(2)}%`;
};

const getChangeColor = (change) => {
  const num = parseFloat(change);
  if (num > 0) return 'text-emerald-600';
  if (num < 0) return 'text-red-600';
  return 'text-slate-600';
};

const SummaryCard = ({ label, value, Icon, tone }) => {
  const toneClasses = {
    positive: 'text-emerald-600',
    negative: 'text-red-600',
    neutral: 'text-slate-900',
  };

  return (
    <Card className="rounded-3xl border border-slate-100 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-slate-500">{label}</CardTitle>
        <Icon className={`h-4 w-4 ${tone === 'positive' ? 'text-emerald-500' : tone === 'negative' ? 'text-red-500' : 'text-slate-400'}`} />
      </CardHeader>
      <CardContent>
        <p className={`text-2xl font-bold ${toneClasses[tone]}`}>{value}</p>
      </CardContent>
    </Card>
  );
};

const MoversCard = ({ title, items = [], tone = 'positive', onSelect, isLoading }) => {
  const isPositive = tone === 'positive';
  const toneClasses = isPositive ? 'text-emerald-600' : 'text-red-600';
  const bgClasses = isPositive ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700';
  const Icon = isPositive ? ArrowUpRight : ArrowDownRight;

  return (
    <Card className="rounded-3xl border border-slate-100 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg font-semibold text-slate-900">{title}</CardTitle>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${bgClasses}`}>
          {items.length} tracked
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <ListSkeleton rows={5} compact />
        ) : items.length === 0 ? (
          <div className="flex h-32 flex-col items-center justify-center text-slate-400">
              <Activity className="mb-2 h-6 w-6 opacity-50" />
              <p className="text-sm">No {isPositive ? 'gainers' : 'losers'} currently</p>
          </div>
        ) : (
          items.map((stock) => (
            <button
              key={stock.symbol}
              type="button"
              className="group flex w-full items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-left transition hover:border-slate-200 hover:bg-white hover:shadow-sm"
              onClick={() => onSelect(stock.symbol)}
            >
              <div className="flex items-center gap-3">
                <div className={`rounded-full p-2 ${isPositive ? 'bg-emerald-100/50 text-emerald-600' : 'bg-red-100/50 text-red-600'}`}>
                    <Icon className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-sm font-bold text-slate-900">{stock.symbol.split('.')[0]}</p>
                  <p className="text-xs text-slate-500 truncate max-w-[120px]">{stock.name}</p>
                </div>
              </div>
              <div className={`text-right ${toneClasses}`}>
                <p className="text-sm font-bold">{formatPercent(stock.percent_change)}</p>
                <p className="text-xs font-medium opacity-80">₹{formatNumber(stock.price)}</p>
              </div>
            </button>
          ))
        )}
      </CardContent>
    </Card>
  );
};

const StockRow = ({ stock, onSelect }) => (
  <button
    type="button"
    className="flex w-full items-center justify-between px-4 py-3 text-left transition hover:bg-slate-50"
    onClick={() => onSelect(stock.symbol)}
  >
    <div className="flex-1 truncate pr-4">
      <p className="text-sm font-semibold text-slate-900">{stock.symbol}</p>
      <p className="text-xs text-slate-500 truncate">{stock.name}</p>
    </div>
    <div className="text-right">
      <p className="text-sm font-semibold text-slate-900">₹{formatNumber(stock.price)}</p>
      <p className={`text-xs font-medium ${getChangeColor(stock.change)}`}>
        {stock.change > 0 ? '+' : ''}{formatNumber(stock.change)} ({formatPercent(stock.percent_change)})
      </p>
    </div>
  </button>
);

const ListSkeleton = ({ rows = 8, compact = false }) => (
  <div className="divide-y divide-slate-100">
    {Array.from({ length: rows }).map((_, index) => (
      <div key={index} className={`flex items-center justify-between px-4 ${compact ? 'py-2' : 'py-4'}`}>
        <div className="space-y-2">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-3 w-32" />
        </div>
        <div className="flex flex-col items-end gap-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-3 w-20" />
        </div>
      </div>
    ))}
  </div>
);

export default MarketPage;