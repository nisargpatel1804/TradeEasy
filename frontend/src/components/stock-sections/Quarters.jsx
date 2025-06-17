import React, { useState } from "react";

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

export default Quarters;
