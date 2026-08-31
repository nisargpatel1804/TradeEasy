import React, { useState, useEffect, useMemo } from 'react';
import { motion } from 'framer-motion';
import { useDataContext } from '../context/DataContext.jsx';
import { useSocket } from '../context/SocketContext.jsx';
import priceUpdateService from '../services/priceUpdateService.js';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card.jsx';
import { Skeleton } from '../components/ui/skeleton.jsx';
import { Button } from '../components/ui/button.jsx';
import { Input } from '../components/ui/input.jsx';
import { AlertTriangle, Search as SearchIcon, ArrowLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const formatNumber = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return null;
  }
  return num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

const formatPercent = (value) => {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return null;
  }
  const sign = num > 0 ? '+' : '';
  return `${sign}${num.toFixed(2)}%`;
};

const Indices = () => {
  const { indicesData: initialIndices, isLoadingIndices, indicesError, getInitialIndices } = useDataContext();
  const { isConnected, isReconnecting, connectionStatus, lastError } = useSocket();
  const navigate = useNavigate();
  const [indices, setIndices] = useState([]);
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    if (initialIndices && initialIndices.length > 0) {
      setIndices(initialIndices);
    }
  }, [initialIndices]);

  useEffect(() => {
    if (!initialIndices || initialIndices.length === 0) {
      getInitialIndices().catch(() => undefined);
    }
  }, [initialIndices, getInitialIndices]);

  useEffect(() => {
    const unsubscribe = priceUpdateService.subscribe((update) => {
      setIndices((prev) => {
        if (!Array.isArray(prev) || prev.length === 0) {
          return prev;
        }

        let changes = null;
        if (update?.type === 'snapshot' && update?.allPrices && Object.keys(update.allPrices).length > 0) {
          changes = update.allPrices;
        } else if (update?.changedPrices && Object.keys(update.changedPrices).length > 0) {
          changes = update.changedPrices;
        }

        if (!changes) {
          return prev;
        }

        const next = new Map(prev.map((index) => [index.symbol, index]));
        Object.entries(changes).forEach(([symbol, payload]) => {
          if (next.has(symbol)) {
            next.set(symbol, { ...next.get(symbol), ...payload });
          }
        });
        return Array.from(next.values());
      });
    });

    return () => unsubscribe();
  }, []);

  const filteredIndices = useMemo(() => {
    let data = Array.isArray(indices)
      ? indices.filter((index) => Number.isFinite(Number(index?.price)) && Number(index?.price) > 0)
      : [];

    if (searchTerm.trim()) {
      const term = searchTerm.trim().toLowerCase();
      data = data.filter((index) => {
        const name = (index.name || '').toLowerCase();
        const symbol = (index.symbol || '').toLowerCase();
        return name.includes(term) || symbol.includes(term);
      });
    }

    data.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

    return data;
  }, [indices, searchTerm]);

  const renderState = () => {
    if ((isLoadingIndices && (!indices || indices.length === 0)) || (indices.length === 0 && !indicesError)) {
      return <LoadingGrid />;
    }

    if (indicesError) {
      return (
        <div className="rounded-3xl border border-dashed border-red-200 bg-red-50/40 p-10 text-center">
          <AlertTriangle className="mx-auto h-12 w-12 text-red-500" />
          <h3 className="mt-4 text-lg font-semibold text-red-700">Could not load market data</h3>
          <p className="text-sm text-red-600">{indicesError}</p>
        </div>
      );
    }

    if (filteredIndices.length === 0) {
      return (
        <div className="rounded-3xl border border-dashed border-slate-200 p-10 text-center text-sm text-slate-500">
          No indices match your current filters.
        </div>
      );
    }

    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {filteredIndices.map((index, idx) => (
          <motion.div
            key={index.symbol}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25, delay: idx * 0.02 }}
          >
            <IndexCard index={index} />
          </motion.div>
        ))}
      </div>
    );
  };

  return (
    <div className="mx-auto max-w-7xl space-y-3 pb-4 pt-2 px-2 sm:px-3 lg:px-4">
      <section className="rounded-3xl border border-slate-100 bg-white/90 p-5 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
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
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Market Overview</p>
              <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">Live Indices</h1>
              <p className="text-xs font-medium text-slate-500">Live snapshot from the market feed.</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`h-3 w-3 rounded-full ${
                isConnected ? 'bg-emerald-500' : isReconnecting ? 'bg-amber-400' : 'bg-red-500'
              }`}
              title={
                isConnected
                  ? 'Live market data connected'
                  : isReconnecting
                  ? 'Reconnecting to live market data'
                  : lastError?.message || 'Live market data disconnected'
              }
            />
            <span className="text-sm font-medium text-slate-600">
              {connectionStatus === 'reconnecting' ? 'Reconnecting…' : isConnected ? 'Live' : 'Offline'}
            </span>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center gap-3 rounded-3xl border border-slate-100 bg-slate-50/70 p-4">
        <div className="relative flex-1 min-w-[220px]">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <Input
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search indices or symbols"
            className="rounded-2xl border-slate-200 bg-white pl-10"
          />
        </div>
      </div>

      {renderState()}
    </div>
  );
};

const IndexCard = ({ index }) => {
  const priceValue = Number(index.price);
  const changeValue = Number(index.change);
  const percentValue = Number(index.percent_change);

  if (!Number.isFinite(priceValue) || priceValue <= 0) {
    return null;
  }

  const hasChange = Number.isFinite(changeValue);
  const hasPercent = Number.isFinite(percentValue);
  const isPositive = hasChange ? changeValue >= 0 : true;

  return (
    <Card className="rounded-3xl border border-slate-100 bg-white p-4 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <CardTitle className="text-lg font-semibold text-slate-900">{index.name}</CardTitle>
          <p className="text-sm text-slate-500">{(index.symbol || '').toUpperCase()}</p>
        </div>
        <div className="text-right">
          <p className="text-2xl font-bold text-slate-900">{formatNumber(priceValue)}</p>
          {hasPercent && (
            <p className={`text-sm font-semibold ${isPositive ? 'text-emerald-600' : 'text-red-600'}`}>
              {formatPercent(percentValue)}
            </p>
          )}
        </div>
      </div>
    </Card>
  );
};

const LoadingGrid = () => (
  <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
    {[...Array(6)].map((_, index) => (
      <Card key={index} className="rounded-3xl border border-slate-100">
        <CardHeader>
          <Skeleton className="h-4 w-1/2" />
        </CardHeader>
        <CardContent className="space-y-3">
          <Skeleton className="h-8 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-4 w-1/2" />
        </CardContent>
      </Card>
    ))}
  </div>
);

export default Indices;