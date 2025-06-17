import React, { useState } from "react";

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

export default ProfitLoss;