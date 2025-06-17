import React from "react";

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

export default Ratios;
