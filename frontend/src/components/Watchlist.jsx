import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  fetchWatchlist,
  addToWatchlist,
  removeFromWatchlist,
  searchStocks,
} from "@/services/api";
import { Input } from "@/ui/input";
import { Button } from "@/ui/button";
import { Card, CardContent } from "@/ui/card";
import { Skeleton } from "@/ui/skeleton";
import { toast } from "react-hot-toast";
import { Search } from "lucide-react";
import { Trash2 } from "lucide-react";
import debounce from "lodash.debounce";
import TradeForm from "@/components/TradeForm";

const Watchlist = () => {
  const navigate = useNavigate();
  const [watchlist, setWatchlist] = useState([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState({});
  const [tradeModal, setTradeModal] = useState({
    open: false,
    symbol: null,
    action: null // 'buy' or 'sell'
  });

  useEffect(() => {
    fetchWatchlistData();
  }, []);

  const fetchWatchlistData = async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetchWatchlist();
      const validData = Array.isArray(response.data) ? response.data : [];
      setWatchlist(validData);
    } catch (err) {
      console.error("Error fetching watchlist:", err);
      setError("Failed to fetch watchlist data.");
    } finally {
      setLoading(false);
    }
  };

  const fetchStockSearch = async (query) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }

    try {
      const results = await searchStocks(query);
      setSearchResults(Array.isArray(results) ? results : []);
    } catch (error) {
      setSearchResults([]);
    }
  };

  const debouncedSearch = debounce(fetchStockSearch, 500);

  useEffect(() => {
    debouncedSearch(searchQuery);
    return () => debouncedSearch.cancel();
  }, [searchQuery]);

  const handleSelectStock = async (symbol) => {
    setSearchQuery("");
    setSearchResults([]);

    try {
      let formattedSymbol = symbol;
      if (symbol.endsWith(".NSE")) {
        formattedSymbol = symbol.replace(".NSE", ".NS");
      } else if (symbol.endsWith(".BSE")) {
        formattedSymbol = symbol.replace(".BSE", ".BO");
      } else if (!symbol.endsWith(".NS") && !symbol.endsWith(".BO")) {
        formattedSymbol = `${symbol}.NS`;
      }

      const response = await addToWatchlist(formattedSymbol);

      if (!response.error) {
        await fetchWatchlistData();
        toast.success(`${formattedSymbol} added to watchlist!`);
      } else {
        setError(response.error);
        toast.error(response.error);
      }
    } catch (err) {
      console.error("Error adding symbol:", err);
      setError("Failed to add symbol");
      toast.error("Failed to add symbol");
    }
  };

  const handleRemoveSymbol = async (symbol) => {
    setActionLoading((prev) => ({ ...prev, [symbol]: true }));
    setError("");
    try {
      const response = await removeFromWatchlist(symbol);

      if (!response.error) {
        await fetchWatchlistData();
        toast.success(`${symbol} removed from watchlist!`);
      } else {
        setError(response.error);
        toast.error(response.error);
      }
    } catch (err) {
      console.error("Error removing symbol:", err);
      setError("Failed to remove symbol");
      toast.error("Failed to remove symbol");
    } finally {
      setActionLoading((prev) => ({ ...prev, [symbol]: false }));
    }
  };

  const handleStockClick = (symbol) => {
    navigate(`/stock/overview/${symbol}`);
  };

  const openTradeModal = (symbol, action) => {
    setTradeModal({
      open: true,
      symbol,
      action
    });
  };

  const closeTradeModal = () => {
    setTradeModal({
      open: false,
      symbol: null,
      action: null
    });
  };

  return (
    <div className="p-8 bg-background min-h-screen">
      <h2 className="text-2xl font-semibold mb-6 text-center text-foreground">
        Watchlist
      </h2>

      {error && <p className="text-yellow-600 mb-4 text-center">{error}</p>}

      <Card className="p-6 bg-muted rounded-lg shadow-md">
        <CardContent>
          {/* Search Bar */}
          <div className="relative mb-6">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
            <Input
              placeholder="Search NSE/BSE stocks..."
              className="pl-10 bg-gray-50 border-gray-200"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />

            {/* Search Results Dropdown */}
            {searchResults.length > 0 && (
              <div className="absolute left-0 right-0 mt-1 bg-white border rounded-lg shadow-lg z-10">
                {searchResults.map((stock) => (
                  <div
                    key={stock["1. symbol"]}
                    className="px-4 py-2 hover:bg-gray-100 cursor-pointer"
                    onClick={() => handleSelectStock(stock["1. symbol"])}
                  >
                    {stock["1. symbol"]} - {stock["2. name"]}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Watchlist Table */}
          {loading ? (
            <Skeleton className="h-20 w-full" />
          ) : watchlist.length === 0 ? (
            <p className="text-muted-foreground text-center">
              No symbols in watchlist.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead className="text-left border-b">
                  <tr>
                    <th className="pb-2">Symbol</th>
                    <th className="pb-2">Price</th>
                    <th className="pb-2">Change</th>
                    <th className="pb-2">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {watchlist.map((item, index) => (
                    <tr key={index} className="border-b hover:bg-gray-50">
                      <td className="py-3">
                        <span
                          className="cursor-pointer hover:underline"
                          onClick={() => handleStockClick(item.symbol)}
                        >
                          {item.symbol}
                        </span>
                      </td>
                      <td className="py-3">₹{item.price.toFixed(2)}</td>
                      <td className={`py-3 ${
                        item.price_change >= 0 ? "text-green-600" : "text-red-600"
                      }`}>
                        ₹{item.price_change.toFixed(2)} (
                        {item.percent_change.toFixed(2)}%)
                      </td>
                      <td className="py-3 flex items-center space-x-2">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleRemoveSymbol(item.symbol)}
                          disabled={actionLoading[item.symbol]}
                        >
                          {actionLoading[item.symbol] ? (
                            "Removing..."
                          ) : (
                            <Trash2 size={16} className="text-red-500" />
                          )}
                        </Button>
                        <Button
                          variant="outline"
                          className="bg-green-100 text-green-700 hover:bg-green-200"
                          onClick={() => openTradeModal(item.symbol, 'buy')}
                        >
                          Buy
                        </Button>
                        <Button
                          variant="outline"
                          className="bg-red-100 text-red-700 hover:bg-red-200"
                          onClick={() => openTradeModal(item.symbol, 'sell')}
                        >
                          Sell
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Trade Form Modal */}
      {tradeModal.open && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white p-8 rounded-lg max-w-md w-full">
            <TradeForm 
              symbol={tradeModal.symbol} 
              defaultAction={tradeModal.action}
              onClose={closeTradeModal} 
            />
          </div>
        </div>
      )}
    </div>
  );
};  

export default Watchlist;