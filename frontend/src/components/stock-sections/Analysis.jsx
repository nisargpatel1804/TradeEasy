import React from "react";

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

export default Analysis;