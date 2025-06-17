import React, { useState } from "react";
import { FiChevronDown, FiChevronUp } from "react-icons/fi";

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

export default Investors;
