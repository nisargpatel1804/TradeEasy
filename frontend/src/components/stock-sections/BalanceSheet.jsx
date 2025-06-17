import React, { useState } from "react";

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

export default BalanceSheet;