import React, { useState, useEffect } from 'react';
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { Loader2 } from 'lucide-react';
import { getHistoricalChartData } from '../services/api.js';
import { Button } from '../components/ui/button.jsx';

const TIMEFRAMES = [
  { label: '1D', interval: '5m', range: '1d' },
  { label: '1W', interval: '15m', range: '5d' },
  { label: '1M', interval: '1h', range: '1mo' },
  { label: '1Y', interval: '1d', range: '1y' },
];

export const StockChart = ({ symbol, currentPrice }) => {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeTimeframe, setActiveTimeframe] = useState(TIMEFRAMES[2]); // Default 1M
  const [error, setError] = useState(null);

  useEffect(() => {
    let isMounted = true;
    const fetchChart = async () => {
      if (!symbol) return;
      setLoading(true);
      setError(null);
      try {
        const response = await getHistoricalChartData(symbol, {
          interval: activeTimeframe.interval,
          range: activeTimeframe.range,
        });
        
        if (response.success && isMounted) {
          // Format data for Recharts
          const formatted = response.candles.map(c => ({
            time: new Date(c.time * 1000).toLocaleDateString('en-IN', { 
              month: 'short', 
              day: 'numeric',
              hour: activeTimeframe.range === '1d' || activeTimeframe.range === '5d' ? '2-digit' : undefined,
              minute: activeTimeframe.range === '1d' || activeTimeframe.range === '5d' ? '2-digit' : undefined
            }),
            price: c.close
          }));
          setData(formatted);
        }
      } catch (err) {
        if (isMounted) setError("Chart data unavailable");
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchChart();
    return () => { isMounted = false; };
  }, [symbol, activeTimeframe]);

  // Determine chart color based on price trend
  const isPositive = data.length > 1 ? data[data.length - 1].price >= data[0].price : true;
  const strokeColor = isPositive ? '#10b981' : '#ef4444'; // Emerald or Red
  const fillGradient = isPositive ? 'colorGreen' : 'colorRed';

  return (
    <div className="w-full space-y-4">
      {/* Timeframe Selectors */}
      <div className="flex gap-2">
        {TIMEFRAMES.map((tf) => (
          <Button
            key={tf.label}
            variant={activeTimeframe.label === tf.label ? "primary" : "outline"}
            size="sm"
            className={`h-8 rounded-full text-xs font-semibold ${
              activeTimeframe.label === tf.label 
                ? (isPositive ? "bg-emerald-600 hover:bg-emerald-700" : "bg-red-600 hover:bg-red-700") 
                : ""
            }`}
            onClick={() => setActiveTimeframe(tf)}
          >
            {tf.label}
          </Button>
        ))}
      </div>

      {/* Chart Area */}
      <div className="h-[300px] w-full rounded-2xl border border-slate-100 bg-white p-4 shadow-sm relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-white/50 z-10 rounded-2xl">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        )}
        
        {error && !loading ? (
          <div className="flex h-full items-center justify-center text-sm text-slate-400">
            {error}
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 5, right: 0, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="colorGreen" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
                </linearGradient>
                <linearGradient id="colorRed" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis 
                dataKey="time" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fontSize: 10, fill: '#94a3b8' }} 
                minTickGap={30}
              />
              <YAxis 
                domain={['auto', 'auto']} 
                hide={true} 
              />
              <Tooltip 
                contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 4px 6px -1px rgba(0,0,0,0.1)' }}
                itemStyle={{ color: '#0f172a', fontWeight: 600 }}
                formatter={(value) => [`₹${Number(value).toFixed(2)}`, 'Price']}
                labelStyle={{ color: '#64748b', fontSize: '12px', marginBottom: '4px' }}
              />
              <Area 
                type="monotone" 
                dataKey="price" 
                stroke={strokeColor} 
                strokeWidth={2}
                fillOpacity={1} 
                fill={`url(#${fillGradient})`} 
                isAnimationActive={false}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
};

export default StockChart;