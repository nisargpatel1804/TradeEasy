import { useState, useEffect } from "react";
import { fetchIndices, updateIndices } from "@/services/api";
import { Card, CardContent } from "@/ui/card";
import { Button } from "@/ui/button";
import { Skeleton } from "@/ui/skeleton";
import { toast } from "react-hot-toast";

const Indices = () => {
  const [indices, setIndices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");

  // Fetch market indices on component mount
  useEffect(() => {
    fetchIndicesData();
  }, []);

  // Fetch market indices manually
  const fetchIndicesData = async () => {
    setLoading(true);
    setError(""); // Reset error on each fetch attempt

    try {
      const data = await fetchIndices();
      setIndices(data);
      toast.success("Market indices fetched successfully!");
    } catch (err) {
      setError(err?.message || "Failed to fetch market indices");
      toast.error(err?.message || "Failed to fetch market indices");
    } finally {
      setLoading(false);
    }
  };

  // Trigger a manual update (if update endpoint is necessary)
  const handleUpdateIndices = async () => {
    setUpdating(true);
    setError("");

    try {
      await updateIndices();
      toast.success("Market indices updated successfully!");
      fetchIndicesData(); // Refresh after update
    } catch (err) {
      setError(err?.message || "Failed to update indices");
      toast.error(err?.message || "Failed to update indices");
    } finally {
      setUpdating(false);
    }
  };

  // Helper function to format numbers
  const formatNumber = (value, decimalPlaces = 2) => {
    return value !== undefined && !isNaN(value) ? parseFloat(value).toFixed(decimalPlaces) : "N/A";
  };

  return (
    <div className="p-8 bg-white min-h-screen">
      <h2 className="text-2xl font-semibold mb-6 text-center">Market Indices</h2>

      {error && <p className="text-red-600 mb-4 text-center">{error}</p>}

      <Card className="p-6 bg-gray-100 rounded-lg shadow-md">
        <CardContent>
          <div className="flex justify-end mb-4 space-x-2">
            <Button onClick={fetchIndicesData} disabled={loading || updating}>
              {loading ? "Fetching..." : "Fetch Data"}
            </Button>
            <Button onClick={handleUpdateIndices} disabled={updating || loading}>
              {updating ? "Updating..." : "Update Data"}
            </Button>
          </div>

          <div className="space-y-4">
            {loading ? (
              <>
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </>
            ) : indices.length === 0 ? (
              <p className="text-gray-500 text-center">No indices available. Tap "Fetch Data" to load.</p>
            ) : (
              indices.map((index) => (
                <div
                  key={index.symbol}
                  className="flex items-center justify-between p-4 bg-white rounded-md shadow-md"
                >
                  <div>
                    <p className="font-medium text-lg">{index.name}</p>
                    <p className="text-sm text-gray-600">
                      Symbol: {index.symbol} | Price: ₹{formatNumber(index.price)}
                    </p>
                    <p
                      className={`text-sm ${
                        parseFloat(index.percent_change) >= 0 ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      Change: {formatNumber(index.change)} ({formatNumber(index.percent_change)}%)
                    </p>
                    <p className="text-sm text-gray-600">
                      Last Updated: {index.last_updated ? new Date(index.last_updated).toLocaleString() : "N/A"}
                    </p>
                  </div>
                </div>
              ))
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Indices;