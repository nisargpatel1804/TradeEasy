import React, { useState } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend, ComposedChart, Bar
} from "recharts";

const rangeOptions = [
  { label: "1M", days: 30 },
  { label: "6M", days: 182 },
  { label: "1Y", days: 365 },
  { label: "3Y", days: 1095 },
  { label: "5Y", days: 1825 },
  { label: "10Y", days: 3650 },
  { label: "Max", days: Infinity }
];

const Chart = ({ data }) => {
  const [selectedRange, setSelectedRange] = useState("1Y");

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-6 text-gray-500">
        Historical price data not available
      </div>
    );
  }

  const now = new Date();
  const days = rangeOptions.find(opt => opt.label === selectedRange).days;
  const startDate = new Date(now.setDate(now.getDate() - days));

  const filteredData = data
    .map(item => ({
      ...item,
      date: item.date,
      close: parseFloat(item.close || 0),
      volume: parseInt(item.volume || 0),
      dma50: parseFloat(item.dma50 || 0),
      dma200: parseFloat(item.dma200 || 0)
    }))
    .filter(item => new Date(item.date) >= startDate);

  return (
    <div className="space-y-4">
      <div className="flex gap-2 flex-wrap text-sm mb-2">
        {rangeOptions.map(({ label }) => (
          <button
            key={label}
            onClick={() => setSelectedRange(label)}
            className={`px-3 py-1 border rounded-full ${
              selectedRange === label
                ? "bg-blue-600 text-white"
                : "bg-white text-gray-700 border-gray-300"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="bg-white p-4 rounded-lg border shadow-sm">
        <h3 className="text-sm font-medium text-gray-500 mb-2">Price and Volume</h3>
        <div className="h-96">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={filteredData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              
              <XAxis 
                dataKey="date"
                tick={{ fontSize: 12 }}
                tickMargin={10}
              />
              
              <YAxis 
                yAxisId="left"
                orientation="left"
                tick={{ fontSize: 12 }}
                tickFormatter={(v) => `${(v / 1_000_00).toFixed(0)}L`}
                tickMargin={10}
              />
              <YAxis 
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 12 }}
                tickFormatter={(value) => value.toLocaleString()}
                tickMargin={10}
              />
              
              <Tooltip />
              <Legend />

              {/* Volume (transparent purple bar) */}
              <Bar 
                yAxisId="left"
                dataKey="volume"
                barSize={8}
                fill="rgba(168, 85, 247, 0.3)"
                name="Volume"
              />

              {/* Close Price */}
              <Line 
                yAxisId="right"
                type="monotone" 
                dataKey="close"
                stroke="#6b21a8"
                strokeWidth={2}
                dot={false}
                name="Closing Price"
              />

              {/* 50 DMA (orange) */}
              <Line 
                yAxisId="right"
                type="monotone" 
                dataKey="dma50"
                stroke="#f97316"
                strokeWidth={1.5}
                dot={false}
                name="50 DMA"
              />

              {/* 200 DMA (grey) */}
              <Line 
                yAxisId="right"
                type="monotone" 
                dataKey="dma200"
                stroke="#9ca3af"
                strokeWidth={1.5}
                dot={false}
                name="200 DMA"
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
};

export default Chart;
