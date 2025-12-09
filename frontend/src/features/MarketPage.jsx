import { useState, useEffect, useMemo, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { Card, CardContent, CardHeader, CardTitle } from '../assets/ui/card.jsx';
import { Button } from '../assets/ui/button.jsx';
import { Input } from '../assets/ui/input.jsx';
import { Skeleton } from '../assets/ui/skeleton.jsx';
import { RefreshCw, Search, TrendingUp, TrendingDown, Activity } from 'lucide-react';
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
  const [livePrices, setLivePrices] = useState({});
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [isRefreshing, setIsRefreshing] = useState(false);

  const fetchMarketData = useCallback(async () => {
    if (!marketData.stocks.length) {
      setIsLoading(true);
    } else {
      setIsRefreshing(true);
    }
    setError(null);

    try {
      const data = await api.fetchMarketStocks('nifty50');
      if (data.success) {
        setMarketData(data);
        // Set initial prices for the live update mechanism
        const initialPriceMap = data.stocks.reduce((acc, stock) => {
          acc[stock.symbol] = {
            price: stock.price,
            change: stock.change,
            percent_change: stock.percent_change,
          };
          return acc;
        }, {});
        setLivePrices(initialPriceMap);
      } else {
        throw new Error(data.message || 'Failed to fetch market data');
      }
    } catch (err) {
      setError(err.message);
      toast.error(err.message || 'Could not load market data.');
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [marketData.stocks.length]);

  useEffect(() => {
    fetchMarketData();
  }, [fetchMarketData]);

  useEffect(() => {
    const unsubscribe = priceUpdateService.subscribe(update => {
      setLivePrices(currentPrices => {
        const mergePrices = (source) => {
          if (!source || Object.keys(source).length === 0) {
            return null;
          }

          const normalized = {};

          for (const [symbol, value] of Object.entries(source)) {
            if (!value) continue;

            const existing = currentPrices[symbol] || {};
            const mergedEntry = {
              ...existing,
              ...value,
            };

            if (typeof value.ltp === 'number') {
              mergedEntry.price = value.ltp;
            } else if (typeof value.price === 'number') {
              mergedEntry.price = value.price;
            }

            normalized[symbol] = mergedEntry;
          }

          return Object.keys(normalized).length > 0 ? normalized : null;
        };

        if (update?.type === 'reset') {
          return currentPrices;
        }

        if (update?.type === 'snapshot') {
          const mergedSnapshot = mergePrices(update?.allPrices);
          return mergedSnapshot ? { ...currentPrices, ...mergedSnapshot } : currentPrices;
        }

        const mergedChanges = mergePrices(update?.changedPrices);
        return mergedChanges ? { ...currentPrices, ...mergedChanges } : currentPrices;
      });
    });

    return () => unsubscribe();
  }, []);

  const enrichedStocks = useMemo(() => {
    const list = marketData.stocks || [];
    let result = list.map((stock) => {
      const live = livePrices[stock.symbol];
      return live ? { ...stock, ...live } : stock;
    });

    if (searchQuery.trim()) {
      const query = searchQuery.trim().toLowerCase();
      result = result.filter((stock) =>
        stock.symbol.toLowerCase().includes(query) ||
        stock.name.toLowerCase().includes(query)
      );
    }

    return result.sort((a, b) => a.symbol.localeCompare(b.symbol));
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

  const handleStockClick = (symbol) => {
    // Assuming a route like /stock/:symbol
    navigate(`/stock/${symbol.split('.')[0]}`);
  };

  const renderStockList = () => {
    if (isLoading) {
      return <ListSkeleton />;
    }

    if (error) {
      return <div className="p-6 text-center text-red-500">{error}</div>;
    }

    if (!enrichedStocks.length) {
      return <div className="p-6 text-center text-slate-500">No constituents match your search.</div>;
    }

    return enrichedStocks.map((stock) => (
      <StockRow key={stock.symbol} stock={stock} onSelect={handleStockClick} />
    ));
  };

  return (
      <div className="space-y-6 px-2 pb-12 pt-4 sm:px-4 lg:px-8">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">Live movers</p>
            <h1 className="text-3xl font-bold text-slate-900">Nifty 50 Heat Map</h1>
            <p className="text-sm text-slate-500">Top gainers and laggards from the benchmark index.</p>
          </div>
          <Button onClick={fetchMarketData} disabled={isRefreshing} variant="outline" className="rounded-full">
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
          <MoversCard title="Top Gainers" items={movers.gainers} tone="positive" onSelect={handleStockClick} isLoading={isLoading} />
          <MoversCard title="Top Losers" items={movers.losers} tone="negative" onSelect={handleStockClick} isLoading={isLoading} />
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
                className="rounded-full border-slate-200 bg-white pl-10"
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

const formatNumber = (value) => {
  const num = parseFloat(value);
  return Number.isNaN(num) ? '0.00' : num.toFixed(2);
};

const formatPercent = (value) => {
  const num = parseFloat(value);
  if (Number.isNaN(num)) {
    return '0.00%';
  }
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
  const toneClasses = tone === 'positive'
    ? 'text-emerald-600'
    : tone === 'negative'
      ? 'text-red-600'
      : 'text-slate-600';

  return (
    <Card className="rounded-3xl border border-slate-100 shadow-sm">
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-lg font-semibold text-slate-900">{title}</CardTitle>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${tone === 'positive' ? 'bg-emerald-50 text-emerald-600' : 'bg-red-50 text-red-600'}`}>
          {items.length} tracked
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <ListSkeleton rows={5} compact />
        ) : items.length === 0 ? (
          <p className="text-sm text-slate-500">Waiting for movement…</p>
        ) : (
          items.map((stock) => (
            <button
              key={stock.symbol}
              type="button"
              className="flex w-full items-center justify-between rounded-2xl border border-slate-100 bg-slate-50/70 p-3 text-left transition hover:bg-white"
              onClick={() => onSelect(stock.symbol)}
            >
              <div>
                <p className="text-sm font-semibold text-slate-900">{stock.symbol}</p>
                <p className="text-xs text-slate-500">{stock.name}</p>
              </div>
              <div className={`text-sm font-semibold ${toneClasses}`}>
                {formatPercent(stock.percent_change)}
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
    <div className="flex-1 truncate">
      <p className="text-sm font-semibold text-slate-900">{stock.symbol}</p>
      <p className="text-xs text-slate-500">{stock.name}</p>
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
        <div className="text-right">
          <Skeleton className="ml-auto h-4 w-16" />
          <Skeleton className="ml-auto mt-2 h-3 w-20" />
        </div>
      </div>
    ))}
  </div>
);

export default MarketPage;

