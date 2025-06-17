import { useEffect, useState } from "react";
import { Skeleton } from "@/ui/skeleton";
import { Card, CardContent } from "@/ui/card";
import { fetchPerformance } from "@/services/api"; // Import the API function

const Performance = () => {
  const [performanceData, setPerformanceData] = useState({
    current_value: 0,
    invested_amount: 0,
    realized_profit_loss: 0,
    unrealized_profit_loss: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  // Fetch performance data from the API
  const fetchPerformanceData = async () => {
    setLoading(true);
    setError("");

    try {
      const data = await fetchPerformance(); // Use the imported API function
      setPerformanceData(data);
    } catch (err) {
      console.error("Failed to fetch performance data:", err);
      setError("Failed to fetch performance data. Please try again later.");
    } finally {
      setLoading(false);
    }
  };

  // Fetch data on component mount
  useEffect(() => {
    fetchPerformanceData();
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
    <div className="p-8 bg-white">
      <h2 className="text-2xl font-semibold mb-6">Performance</h2>

      {error && (
        <p className="mb-4 text-yellow-600">
          {error}
        </p>
      )}

      <Card className="p-6 bg-gray-100 rounded-lg shadow-md">
        <CardContent className="space-y-4">
          <p className="text-lg font-medium">
            Current Value:{" "}
            <span className="font-bold text-gray-800">
              ₹{performanceData.current_value.toLocaleString()}
            </span>
          </p>
          <p className="text-lg font-medium">
            Invested Amount:{" "}
            <span className="font-bold text-gray-800">
              ₹{performanceData.invested_amount.toLocaleString()}
            </span>
          </p>
          <p className="text-lg font-medium">
            Realized Profit/Loss:{" "}
            <span
              className={`font-bold ${
                performanceData.realized_profit_loss >= 0
                  ? "text-green-600"
                  : "text-red-600"
              }`}
            >
              ₹{performanceData.realized_profit_loss.toLocaleString()}
            </span>
          </p>
          <p className="text-lg font-medium">
            Unrealized Profit/Loss:{" "}
            <span
              className={`font-bold ${
                performanceData.unrealized_profit_loss >= 0
                  ? "text-green-600"
                  : "text-red-600"
              }`}
            >
              ₹{performanceData.unrealized_profit_loss.toLocaleString()}
            </span>
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default Performance;