import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getStockOverview } from "@/services/api";
import Tabs from "@/components/Tabs";

// Section components
import Chart from "@/components/stock-sections/Chart";
import Analysis from "@/components/stock-sections/Analysis";
import Peers from "@/components/stock-sections/Peers";
import Quarters from "@/components/stock-sections/Quarters";
import ProfitLoss from "@/components/stock-sections/ProfitLoss";
import BalanceSheet from "@/components/stock-sections/BalanceSheet";
import CashFlow from "@/components/stock-sections/CashFlow";
import Ratios from "@/components/stock-sections/Ratios";
import Investors from "@/components/stock-sections/Investors";
import Documents from "@/components/stock-sections/Documents";
import LoadingSpinner from "@/ui/LoadingSpinner";
import ErrorMessage from "@/ui/ErrorMessage";

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

  const investorData = Array.isArray(shareholding?.holders) ? shareholding.holders : [];
  const ratios = Array.isArray(ratios_screener) ? ratios_screener : [];

  const tabs = [
    { 
      label: "Chart", 
      component: <Chart data={historical_data} symbol={symbol} />,
      disabled: historical_data.length === 0
    },
    { 
      label: "Analysis", 
      component: <Analysis data={analysis} />,
      disabled: !analysis?.pros && !analysis?.cons
    },
    { 
      label: "Peers", 
      component: <Peers data={peers} />,
      disabled: !peers?.peers || peers.peers.length === 0
    },
    { 
      label: "Quarters", 
      component: <Quarters data={quarters} />,
      disabled: quarters.length === 0
    },
    { 
      label: "P&L", 
      component: <ProfitLoss data={profit_loss} />,
      disabled: profit_loss.length === 0
    },
    { 
      label: "Balance Sheet", 
      component: <BalanceSheet data={balance_sheet} />,
      disabled: balance_sheet.length === 0
    },
    { 
      label: "Cash Flow", 
      component: <CashFlow data={cash_flow} />,
      disabled: cash_flow.length === 0
    },
    { 
      label: "Investors", 
      component: <Investors data={investorData} />,
      disabled: investorData.length === 0
    },
    { 
      label: "Ratios", 
      component: <Ratios data={{ ratios: stockData.ratios || {}, ratios_screener }} />,
      disabled: ratios_screener.length === 0
    },

    { 
      label: "Documents", 
      component: <Documents data={documents} />,
      disabled: documents.length === 0
    }
  ].filter(tab => !tab.disabled);

  return (
    <div className="max-w-7xl mx-auto p-4 md:p-6 bg-white shadow-lg rounded-lg">
      <div className="mb-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-gray-800">
              {symbol} Stock Analysis
            </h1>
            <div className="text-sm text-gray-500 mt-1">
              Last updated: {lastUpdated.toLocaleString()}
            </div>
          </div>
          <div className="text-sm text-gray-500">
            Data source: Screener.in & Yahoo Finance
          </div>
        </div>
      </div>
      
      <Tabs 
        tabs={tabs}
        defaultIndex={0}
        tabClass="px-4 py-2 text-gray-600 hover:text-blue-500 cursor-pointer whitespace-nowrap"
        activeTabClass="border-b-2 border-blue-500 font-medium text-blue-600"
        disabledTabClass="text-gray-400 cursor-not-allowed"
        contentClass="p-2 md:p-4"
        onChange={(index) => console.log(`Switched to tab: ${tabs[index].label}`)}
      />
    </div>
  );
};

export default StockOverview;
