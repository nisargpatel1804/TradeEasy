import { useEffect, useState } from "react";
import { fetchPortfolio } from "@/services/api"; // Import the API function
import { Skeleton } from "@/ui/skeleton";
import { Card, CardContent } from "@/ui/card";

const Portfolio = () => {
  const [portfolio, setPortfolio] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Fetch portfolio data from the API
  const loadPortfolio = async () => {
    setLoading(true);
    setError("");

    try {
      const data = await fetchPortfolio(); // Use the imported API function
      setPortfolio(data);
    } catch (err) {
      console.error("Failed to fetch portfolio:", err);
      setError("Failed to fetch portfolio data. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  // Fetch data on component mount
  useEffect(() => {
    loadPortfolio();
  }, []);

  // Loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <Skeleton className="w-96 h-24" />
      </div>
    );
  }

  return (
    <div className="p-8 bg-white min-h-screen">
      <h2 className="text-2xl font-semibold mb-6 text-center">Portfolio</h2>

      {error && (
        <div className="mb-4 text-center">
          <p className="text-yellow-600">{error}</p>
        </div>
      )}

      {/* Portfolio Summary */}
      <Card className="p-6 bg-gray-100 rounded-lg shadow-md mb-6">
        <CardContent className="space-y-4">
          <p className="text-lg font-medium">
            Portfolio Value:{" "}
            <span className="font-bold text-blue-600">
              ₹{portfolio?.portfolio_value?.toLocaleString()}
            </span>
          </p>
          <p className="text-lg font-medium">
            Balance:{" "}
            <span className="font-bold text-green-600">
              ₹{portfolio?.balance?.toLocaleString()}
            </span>
          </p>
          <p className="text-lg font-medium">
            Total Investment:{" "}
            <span className="font-bold text-gray-800">
              ₹{portfolio?.total_investment?.toLocaleString()}
            </span>
          </p>
          <p className="text-lg font-medium">
            Total Profit/Loss:{" "}
            <span
              className={`font-bold ${
                portfolio?.total_profit_loss >= 0
                  ? "text-green-600"
                  : "text-red-600"
              }`}
            >
              ₹{portfolio?.total_profit_loss?.toLocaleString()}
            </span>
          </p>
        </CardContent>
      </Card>

      {/* Holdings Section */}
      <Card className="p-6 bg-gray-100 rounded-lg shadow-md mb-6">
        <CardContent>
          <h3 className="text-lg font-semibold mb-4">Holdings</h3>
          {portfolio?.holdings?.length > 0 ? (
            <div className="grid gap-4">
              {portfolio.holdings.map((holding, index) => {
                // Ensure profit_loss_percentage is a number
                const profitLossPercentage =
                  typeof holding.profit_loss_percentage === "number"
                    ? holding.profit_loss_percentage
                    : 0;

                return (
                  <Card key={index} className="p-4 bg-white shadow-sm border rounded-lg">
                    <CardContent className="space-y-2">
                      <p className="font-semibold text-lg">{holding.symbol}</p>
                      <p className="text-gray-700">Quantity: {holding.quantity}</p>
                      <p className="text-gray-700">
                        Avg Price: ₹{holding.average_price?.toLocaleString()}
                      </p>
                      <p className="text-gray-700">
                        Current Price: ₹{holding.current_price?.toLocaleString()}
                      </p>
                      <p className="text-gray-700">
                        Investment Value: ₹{holding.investment_value?.toLocaleString()}
                      </p>
                      <p className="text-gray-700">
                        Current Value: ₹{holding.current_value?.toLocaleString()}
                      </p>
                      <p className="text-gray-700">
                        Profit/Loss:{" "}
                        <span
                          className={`font-bold ${
                            holding.profit_loss >= 0 ? "text-green-600" : "text-red-600"
                          }`}
                        >
                          ₹{holding.profit_loss?.toLocaleString()}
                        </span>
                      </p>
                      <p className="text-gray-700">
                        Profit/Loss (%):{" "}
                        <span
                          className={`font-bold ${
                            profitLossPercentage >= 0
                              ? "text-green-600"
                              : "text-red-600"
                          }`}
                        >
                          {profitLossPercentage.toFixed(2)}%
                        </span>
                      </p>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          ) : (
            <p className="text-gray-500 text-center">No holdings available.</p>
          )}
        </CardContent>
      </Card>

      {/* Recent Transactions Section */}
      <Card className="p-6 bg-gray-100 rounded-lg shadow-md">
        <CardContent>
          <h3 className="text-lg font-semibold mb-4">Recent Transactions</h3>
          {portfolio?.recent_transactions?.length > 0 ? (
            <div className="grid gap-4">
              {portfolio.recent_transactions.map((transaction, index) => (
                <Card key={index} className="p-4 bg-white shadow-sm border rounded-lg">
                  <CardContent className="space-y-2">
                    <p className="font-semibold text-lg">{transaction.symbol}</p>
                    <p className="text-gray-700">
                      Action:{" "}
                      <span
                        className={`font-bold ${
                          transaction.action === "buy" ? "text-green-600" : "text-red-600"
                        }`}
                      >
                        {transaction.action.toUpperCase()}
                      </span>
                    </p>
                    <p className="text-gray-700">Quantity: {transaction.quantity}</p>
                    <p className="text-gray-700">
                      Price: ₹{transaction.price?.toLocaleString()}
                    </p>
                    <p className="text-gray-700">
                      Total Value: ₹{transaction.total_value?.toLocaleString()}
                    </p>
                    <p className="text-gray-700">
                      Date: {new Date(transaction.date).toLocaleString()}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-center">No recent transactions.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Portfolio;