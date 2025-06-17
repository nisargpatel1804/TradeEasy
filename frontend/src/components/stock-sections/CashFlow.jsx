import React, { useState } from "react";

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

export default CashFlow;