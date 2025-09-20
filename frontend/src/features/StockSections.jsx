import React, { useState, useEffect } from "react";
import { useParams } from "react-router-dom";
import { FiDownload, FiFileText, FiChevronDown, FiChevronUp } from "react-icons/fi";
import { ResponsiveContainer, ComposedChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Bar, Line } from "recharts";
import { getStockOverview } from "@/services/api";
import { Card, CardContent, CardHeader, CardTitle } from "@/assets/ui/card";
import { Button } from "@/assets/ui/button";
import { Skeleton } from "@/assets/ui/skeleton";
import LoadingSpinner from "@/assets/ui/LoadingSpinner";
import ErrorMessage from "@/assets/ui/ErrorMessage";

// Analysis Component
const Analysis = ({ data }) => {
  if (!data || (!data.pros && !data.cons)) {
    return <div className="text-center py-4 text-gray-500">No analysis data available</div>;
  }

  const renderAnalysisPoints = (items, type) => {
    if (!items || items.length === 0) {
      return <p className="text-gray-500">No {type} available</p>;
    }

    return (
      <ul className="space-y-2">
        {items.map((item, index) => (
          <li key={index} className="flex items-start">
            <span className={`inline-block mr-2 ${type === 'pros' ? 'text-green-500' : 'text-red-500'}`}>
              {type === 'pros' ? '✓' : '✗'}
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    );
  };

  const extractNumbers = (text) => {
    const matches = text.match(/\d+\.?\d*/g);
    return matches ? matches.join(', ') : '';
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold mb-4 text-gray-800">Company Analysis</h2>
        <p className="text-gray-600 mb-4">Key strengths and weaknesses identified by Screener.in</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-green-50 p-4 rounded-lg border border-green-100">
          <h3 className="font-semibold text-green-800 mb-3 flex items-center">
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Strengths ({data.pros?.length || 0})
          </h3>
          {renderAnalysisPoints(data.pros, 'pros')}
        </div>

        <div className="bg-red-50 p-4 rounded-lg border border-red-100">
          <h3 className="font-semibold text-red-800 mb-3 flex items-center">
            <svg className="w-5 h-5 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
            Weaknesses ({data.cons?.length || 0})
          </h3>
          {renderAnalysisPoints(data.cons, 'cons')}
        </div>
      </div>

    </div>
  );
};

// BalanceSheet Component
const BalanceSheet = ({ data }) => {
  const [expanded, setExpanded] = useState(false);
  const [searchTerm, setSearchTerm] = useState("");

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-6">
        <p className="text-gray-500">Balance sheet data not available</p>
      </div>
    );
  }

  // Format numbers with appropriate units
  const formatValue = (value) => {
    if (value === null || value === undefined || isNaN(value)) return "-";

    const num = Number(value);
    if (num >= 10000000) return `${(num / 10000000).toFixed(2)} Cr`;
    if (num >= 100000) return `${(num / 100000).toFixed(2)} L`;
    return num.toLocaleString("en-IN");
  };

  // Filter and slice data based on search and expanded state
  const filteredData = data
    .filter(item =>
      item.item.toLowerCase().includes(searchTerm.toLowerCase())
    )
    .slice(0, expanded ? data.length : 15);

  // Extract available years from the first row
  const years = data[0]?.years || [];

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-gray-800">Balance Sheet</h2>
        <div className="flex gap-3">
          <input
            type="text"
            placeholder="Search items..."
            className="px-3 py-2 border rounded-md text-sm"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
          />
          <button
            onClick={() => setExpanded(!expanded)}
            className="px-3 py-2 bg-gray-100 hover:bg-gray-200 rounded-md text-sm"
          >
            {expanded ? "Show Less" : "Show More"}
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Item
              </th>
              {years.map((year, i) => (
                <th
                  key={i}
                  className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider"
                >
                  {year}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {filteredData.map((row, rowIdx) => (
              <tr
                key={rowIdx}
                className={rowIdx % 2 === 0 ? "bg-white" : "bg-gray-50"}
              >
                <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                  {row.item}
                </td>
                {row.values.map((value, colIdx) => (
                  <td
                    key={colIdx}
                    className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-500"
                  >
                    {formatValue(value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {filteredData.length === 0 && (
        <p className="text-center py-4 text-gray-500">
          No matching items found
        </p>
      )}

      {!expanded && data.length > 15 && (
        <div className="text-center pt-2">
          <button
            onClick={() => setExpanded(true)}
            className="text-blue-600 hover:text-blue-800 text-sm"
          >
            + {data.length - 15} more items...
          </button>
        </div>
      )}
    </div>
  );
};

// CashFlow Component
const CashFlow = ({ data }) => {
  const [expanded, setExpanded] = useState(false);

  const formatValue = (val) => {
    if (val === null || val === undefined || isNaN(val)) return "-";
    const num = Number(val);
    if (Math.abs(num) >= 10000000) return `${(num / 10000000).toFixed(2)} Cr`;
    if (Math.abs(num) >= 100000) return `${(num / 100000).toFixed(2)} L`;
    return num.toLocaleString("en-IN");
  };

  if (!data || data.length === 0) {
    return <div className="text-center py-6 text-gray-500">Cash flow data not available</div>;
  }

  const visibleData = expanded ? data : data.slice(0, 10);
  const years = data[0]?.years || [];

  return (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold text-gray-800">Cash Flow Statement</h2>
        {data.length > 10 && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="text-blue-600 hover:text-blue-800 text-sm"
          >
            {expanded ? "Show Less" : "Show All"}
          </button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Activity
              </th>
              {years.map((year, i) => (
                <th key={i} className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {year}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {visibleData.map((row, idx) => (
              <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                  {row.item}
                </td>
                {row.values.map((value, i) => (
                  <td
                    key={i}
                    className={`px-4 py-3 whitespace-nowrap text-sm text-right ${
                      value < 0 ? 'text-red-600' : 'text-gray-900'
                    }`}
                  >
                    {formatValue(value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Chart Component
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

const rangeOptions = [
  { label: "1M", days: 30 },
  { label: "6M", days: 182 },
  { label: "1Y", days: 365 },
  { label: "3Y", days: 1095 },
  { label: "5Y", days: 1825 },
  { label: "10Y", days: 3650 },
  { label: "Max", days: Infinity }
];

// Documents Component
const Documents = ({ data }) => {
  if (!data || data.length === 0) {
    return (
      <div className="text-center py-6 text-gray-500">
        No documents available for this company
      </div>
    );
  }

  const documentTypes = {
    annual: { name: "Annual Reports", icon: "📈", color: "bg-blue-50 text-blue-600" },
    quarterly: { name: "Quarterly Reports", icon: "📊", color: "bg-green-50 text-green-600" },
    presentation: { name: "Investor Presentations", icon: "📑", color: "bg-purple-50 text-purple-600" },
    other: { name: "Other Documents", icon: "📄", color: "bg-gray-50 text-gray-600" }
  };

  const groupedDocs = data.reduce((acc, doc) => {
    const type = doc.type || 'other';
    if (!acc[type]) acc[type] = [];
    acc[type].push(doc);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-gray-800">Company Documents</h2>

      {Object.entries(groupedDocs).map(([type, docs]) => (
        <div key={type} className="space-y-3">
          <div className={`flex items-center px-4 py-2 rounded-lg ${documentTypes[type]?.color || documentTypes.other.color}`}>
            <span className="text-lg mr-2">{documentTypes[type]?.icon || documentTypes.other.icon}</span>
            <h3 className="font-medium">{documentTypes[type]?.name || documentTypes.other.name}</h3>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {docs.map((doc, idx) => (
              <a
                key={idx}
                href={doc.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center">
                  <FiFileText className="text-gray-400 mr-3" />
                  <span>{doc.title || `Document ${idx + 1}`}</span>
                </div>
                <div className="flex items-center text-sm text-gray-500">
                  {doc.date && <span className="mr-3">{doc.date}</span>}
                  <FiDownload className="text-blue-500" />
                </div>
              </a>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};

// Investors Component
const Investors = ({ data }) => {
  const [expanded, setExpanded] = useState(false);

  if (!Array.isArray(data) || data.length === 0) {
    return (
      <div className="text-center py-6 text-gray-500">
        Investor data not available
      </div>
    );
  }

  const visibleInvestors = expanded ? data : data.slice(0, 5);
  const hasMore = data.length > 5;

  const getLatestHolding = (holdings) => {
    if (!Array.isArray(holdings) || holdings.length === 0) return 0;
    return holdings[holdings.length - 1]?.percentage || 0;
  };

  const getYoYChange = (holdings) => {
    if (!Array.isArray(holdings) || holdings.length < 2) return 0;
    const latest = holdings[holdings.length - 1]?.percentage || 0;
    const oldest = holdings[0]?.percentage || 0;
    return latest - oldest;
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-gray-800">Shareholding Pattern</h2>

      <div className="overflow-x-auto rounded-lg border shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Investor Type
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Current %
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Change (YoY)
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {visibleInvestors.map((investor, idx) => {
              const current = getLatestHolding(investor.holdings);
              const change = getYoYChange(investor.holdings);

              return (
                <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                    {investor.name}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">
                    {current.toFixed(2)}%
                  </td>
                  <td
                    className={`px-4 py-3 whitespace-nowrap text-sm text-right ${
                      change > 0
                        ? "text-green-600"
                        : change < 0
                        ? "text-red-600"
                        : "text-gray-500"
                    }`}
                  >
                    {change >= 0 ? "+" : ""}
                    {change.toFixed(2)}%
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {hasMore && (
        <div className="text-center">
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center justify-center text-blue-600 hover:text-blue-800 text-sm mx-auto"
          >
            {expanded ? (
              <>
                <FiChevronUp className="mr-1" />
                Show Less
              </>
            ) : (
              <>
                <FiChevronDown className="mr-1" />
                Show All {data.length} Investors
              </>
            )}
          </button>
        </div>
      )}
    </div>
  );
};

// Peers Component
const Peers = ({ data }) => {
  const [sortConfig, setSortConfig] = useState({ key: 'marketCap', direction: 'desc' });

  if (!data || !data.peers || data.peers.length === 0) {
    return (
      <div className="text-center py-6 text-gray-500">
        Peer comparison data not available
      </div>
    );
  }

  const sortedPeers = [...data.peers].sort((a, b) => {
    const aValue = parseFloat(a[sortConfig.key] || 0);
    const bValue = parseFloat(b[sortConfig.key] || 0);
    return sortConfig.direction === 'asc' ? aValue - bValue : bValue - aValue;
  });

  const requestSort = (key) => {
    let direction = 'desc';
    if (sortConfig.key === key && sortConfig.direction === 'desc') {
      direction = 'asc';
    }
    setSortConfig({ key, direction });
  };

  const formatValue = (value, key) => {
    if (value === null || value === undefined) return "-";
    if (key === 'marketCap') {
      const num = parseFloat(value);
      if (num >= 10000000) return `${(num / 10000000).toFixed(2)} Cr`;
      return num.toLocaleString();
    }
    return value;
  };

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-xl font-semibold text-gray-800">Peer Comparison</h2>
        {data.sectors && (
          <p className="text-sm text-gray-600 mt-1">
            Industry: {data.sectors.join(" > ")}
          </p>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              {['name', 'cmp', 'pe', 'marketCap'].map((key) => (
                <th
                  key={key}
                  className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer"
                  onClick={() => requestSort(key)}
                >
                  <div className="flex items-center">
                    {key === 'cmp' ? 'Price' : key === 'pe' ? 'P/E' : key === 'marketCap' ? 'Market Cap' : 'Name'}
                    {sortConfig.key === key && (
                      <span className="ml-1">
                        {sortConfig.direction === 'asc' ? '↑' : '↓'}
                      </span>
                    )}
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {sortedPeers.map((peer, idx) => (
              <tr key={idx} className={idx % 2 === 0 ? "bg-white" : "bg-gray-50"}>
                <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                  {peer.name}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                  {formatValue(peer.cmp, 'cmp')}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                  {formatValue(peer.pe, 'pe')}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-500">
                  {formatValue(peer.marketCap, 'marketCap')}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// ProfitLoss Component
const ProfitLoss = ({ data }) => {
  const [viewMode, setViewMode] = useState('absolute'); // 'absolute' or 'percentage'

  const formatValue = (val) => {
    if (val === null || val === undefined || isNaN(val)) return "-";
    const num = Number(val);
    if (viewMode === 'percentage' && num !== 0) {
      return `${num > 0 ? '+' : ''}${num.toFixed(2)}%`;
    }
    if (Math.abs(num) >= 10000000) return `${(num / 10000000).toFixed(2)} Cr`;
    if (Math.abs(num) >= 100000) return `${(num / 100000).toFixed(2)} L`;
    return num.toLocaleString("en-IN");
  };

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-6 text-gray-500">
        Profit & Loss statement not available
      </div>
    );
  }

  const years = data[0]?.years || [];
  const importantItems = [
    'Total Revenue',
    'EBITDA',
    'EBIT',
    'Net Profit',
    'EPS'
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <h2 className="text-xl font-semibold text-gray-800">Profit & Loss Statement</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setViewMode('absolute')}
            className={`px-3 py-1 text-sm rounded-md ${viewMode === 'absolute' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100'}`}
          >
            Absolute Values
          </button>
          <button
            onClick={() => setViewMode('percentage')}
            className={`px-3 py-1 text-sm rounded-md ${viewMode === 'percentage' ? 'bg-blue-100 text-blue-700' : 'bg-gray-100'}`}
          >
            Growth %
          </button>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Item
              </th>
              {years.map((year, i) => (
                <th key={i} className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                  {year}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {data.map((row, idx) => (
              <tr
                key={idx}
                className={importantItems.includes(row.item) ? 'bg-gray-50 font-medium' : ''}
              >
                <td className={`px-4 py-3 whitespace-nowrap text-sm ${
                  importantItems.includes(row.item) ? 'text-gray-900' : 'text-gray-600'
                }`}>
                  {row.item}
                </td>
                {row.values.map((value, i) => (
                  <td
                    key={i}
                    className={`px-4 py-3 whitespace-nowrap text-sm text-right ${
                      value < 0 ? 'text-red-600' : 'text-gray-900'
                    }`}
                  >
                    {formatValue(value)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Quarters Component
const Quarters = ({ data }) => {
  const [selectedMetric, setSelectedMetric] = useState("Sales +");

  if (!data || data.length === 0) {
    return (
      <div className="text-center py-6 text-gray-500">
        Quarterly results not available
      </div>
    );
  }

  const metrics = data.map((item) => item.item);
  const selectedData = data.find((item) => item.item === selectedMetric) || data[0];
  const quarters = selectedData?.years || []; // ✅ FIXED HERE

  const formatValue = (val) => {
    if (val === null || val === undefined || isNaN(val)) return "-";
    const num = Number(val);
    if (Math.abs(num) >= 10000000) return `${(num / 10000000).toFixed(2)} Cr`;
    if (Math.abs(num) >= 100000) return `${(num / 100000).toFixed(2)} L`;
    return num.toLocaleString("en-IN");
  };

  return (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold text-gray-800">Quarterly Results</h2>

      <div className="flex overflow-x-auto pb-2 gap-2">
        {metrics.map((metric) => (
          <button
            key={metric}
            onClick={() => setSelectedMetric(metric)}
            className={`px-3 py-1 text-sm whitespace-nowrap rounded-full ${
              selectedMetric === metric
                ? "bg-blue-100 text-blue-700"
                : "bg-gray-100 hover:bg-gray-200"
            }`}
          >
            {metric.replace(" +", "")}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-lg border shadow-sm">
        <table className="min-w-full divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
                Quarter
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Value
              </th>
              <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
                Growth %
              </th>
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-200">
            {quarters.map((quarter, i) => {
              const value = selectedData.values[i];
              const prevValue = selectedData.values[i + 1];
              const growth =
                prevValue && !isNaN(value) && !isNaN(prevValue)
                  ? ((value - prevValue) / Math.abs(prevValue)) * 100
                  : null;

              return (
                <tr key={i}>
                  <td className="px-4 py-3 whitespace-nowrap text-sm font-medium text-gray-900">
                    {quarter}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap text-sm text-right text-gray-900">
                    {formatValue(value)}
                  </td>
                  <td
                    className={`px-4 py-3 whitespace-nowrap text-sm text-right ${
                      growth > 0
                        ? "text-green-600"
                        : growth < 0
                        ? "text-red-600"
                        : "text-gray-500"
                    }`}
                  >
                    {growth !== null
                      ? `${growth > 0 ? "+" : ""}${growth.toFixed(2)}%`
                      : "-"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// Ratios Component
const Ratios = ({ data }) => {
  const { ratios_screener = [] } = data || {};
  const hasHistoricalRatios = Array.isArray(ratios_screener) && ratios_screener.length > 0;

  if (!hasHistoricalRatios) {
    return (
      <div className="text-center py-6 text-gray-500">
        Financial ratios not available
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-semibold text-gray-800">Financial Ratios (Historical)</h2>

      <div className="overflow-x-auto border rounded-lg shadow-sm">
        <table className="min-w-full text-sm text-left divide-y divide-gray-200">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-gray-500 font-semibold">Metric</th>
              {ratios_screener[0]?.years?.map((year, idx) => (
                <th key={idx} className="px-4 py-2 text-right text-gray-500 font-semibold">
                  {year}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="bg-white divide-y divide-gray-100">
            {ratios_screener.map((row, idx) => (
              <tr key={idx}>
                <td className="px-4 py-2 font-medium text-gray-800 whitespace-nowrap">
                  {row.item}
                </td>
                {row.values.map((val, i) => (
                  <td key={i} className="px-4 py-2 text-right text-gray-700">
                    {val !== null && !isNaN(val) ? `${val}` : "-"}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
};

// StockOverview Component - Merged from StockOverview.jsx
const StockOverview = () => {
  const { symbol } = useParams();
  const [stockData, setStockData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdated, setLastUpdated] = useState(new Date());

  useEffect(() => {
    let isMounted = true;

    const fetchStockData = async () => {
      try {
        setLoading(true);
        setError(null);
        const data = await getStockOverview(symbol);

        if (!isMounted) return;
        if (data?.error) throw new Error(data.error);
        if (!data) throw new Error("No data received from server");

        setStockData(data);
        setLastUpdated(new Date());
      } catch (err) {
        if (isMounted) {
          console.error("Error fetching stock data:", err);
          setError(err.message || "Failed to fetch stock data. Please try again later.");
        }
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchStockData();
    const refreshInterval = setInterval(fetchStockData, 5 * 60 * 1000);
    return () => {
      isMounted = false;
      clearInterval(refreshInterval);
    };
  }, [symbol]);

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[300px]">
        <LoadingSpinner 
          size="lg" 
          text="Loading stock data..." 
          className="text-primary-500"
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        <ErrorMessage 
          message={error}
          onRetry={() => window.location.reload()}
          variant="error"
          className="my-8"
        />
      </div>
    );
  }

  if (!stockData) {
    return (
      <div className="max-w-7xl mx-auto p-4 md:p-6">
        <ErrorMessage 
          message={`No data found for ${symbol}`}
          onRetry={() => window.location.reload()}
          variant="warning"
          className="my-8"
        />
      </div>
    );
  }

  const {
    historical_data = [],
    balance_sheet = [],
    profit_loss = [],
    quarters = [],
    cash_flow = [],
    shareholding = {},
    peers = {},
    analysis = {},
    documents = [],
    ratios_screener = [], // ✅ use screener ratios
  } = stockData;

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-2xl md:text-3xl font-bold">
            {symbol} Stock Overview
          </CardTitle>
          <div className="text-sm text-gray-500 mt-1">
            Last updated: {lastUpdated.toLocaleString()}
          </div>
        </CardHeader>
        <CardContent>
          <div className="space-y-6">
            {/* Basic Stock Information */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              <div className="p-4 border rounded-lg">
                <h3 className="font-semibold text-gray-700">Current Price</h3>
                <p className="text-2xl font-bold text-green-600">
                  {stockData?.current_price || 'N/A'}
                </p>
              </div>
              
              <div className="p-4 border rounded-lg">
                <h3 className="font-semibold text-gray-700">Market Cap</h3>
                <p className="text-xl font-semibold">
                  {stockData?.market_cap || 'N/A'}
                </p>
              </div>
              
              <div className="p-4 border rounded-lg">
                <h3 className="font-semibold text-gray-700">P/E Ratio</h3>
                <p className="text-xl font-semibold">
                  {stockData?.pe_ratio || 'N/A'}
                </p>
              </div>
            </div>

            {/* Historical Data Summary */}
            {historical_data && historical_data.length > 0 && (
              <div className="p-4 border rounded-lg">
                <h3 className="font-semibold text-gray-700 mb-2">Historical Data</h3>
                <p className="text-sm text-gray-600">
                  {historical_data.length} data points available
                </p>
              </div>
            )}

            {/* Analysis Summary */}
            {analysis && (
              <div className="p-4 border rounded-lg">
                <h3 className="font-semibold text-gray-700 mb-2">Analysis</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {analysis.pros && (
                    <div>
                      <h4 className="font-medium text-green-600">Pros</h4>
                      <p className="text-sm">{analysis.pros}</p>
                    </div>
                  )}
                  {analysis.cons && (
                    <div>
                      <h4 className="font-medium text-red-600">Cons</h4>
                      <p className="text-sm">{analysis.cons}</p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export {
  Analysis,
  BalanceSheet,
  CashFlow,
  Chart,
  Documents,
  Investors,
  Peers,
  ProfitLoss,
  Quarters,
  Ratios,
  StockOverview
};