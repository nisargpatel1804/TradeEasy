import React, { useState } from "react";

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

export default Peers;