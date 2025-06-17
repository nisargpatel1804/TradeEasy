import React from "react";
import { FiDownload, FiFileText } from "react-icons/fi";

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

export default Documents;