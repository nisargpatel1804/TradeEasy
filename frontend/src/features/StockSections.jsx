import React, { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import * as api from '../services/api.js';
import { Card, CardContent, CardHeader, CardTitle } from '../assets/ui/card.jsx';
import { Skeleton } from '../assets/ui/skeleton.jsx';
import { BookOpen, TrendingUp } from 'lucide-react';

// Main container component to fetch data and render sections
const StockSections = () => {
    const { symbol } = useParams();
    const navigate = useNavigate();
    const [stockData, setStockData] = useState(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);

    useEffect(() => {
        const fetchStockData = async () => {
            if (!symbol) return;
            setLoading(true);
            setError(null);
            try {
                // This API call corresponds to the `/api/stock/<symbol>` backend endpoint.
                const data = await api.getStockData(symbol);
                if (data.success) {
                    setStockData(data);
                } else {
                    throw new Error(data.message || 'Could not retrieve stock data.');
                }
            } catch (err) {
                setError(err.message);
                toast.error(err.message || `No details found for ${symbol}.`);
                navigate('/dashboard'); // Redirect if stock is not found or an error occurs
            } finally {
                setLoading(false);
            }
        };

        fetchStockData();
    }, [symbol, navigate]);

    if (loading) {
        return (
            <div className="p-4 md:p-8 space-y-6">
                <Skeleton className="h-12 w-1/2 rounded-lg" />
                <Skeleton className="h-48 w-full rounded-lg" />
                <Skeleton className="h-48 w-full rounded-lg" />
            </div>
        );
    }

    if (error) {
        // Error is already shown as a toast, and the user is redirected.
        // This is a fallback view.
        return <div className="p-8 text-center text-red-500">{error}</div>;
    }

    if (!stockData) {
        return null; // Should be redirected, but this is a safeguard.
    }

    const { price_data, financials } = stockData;

    return (
        <div className="space-y-8 p-4 md:p-8">
            <header>
                <h1 className="text-3xl font-bold text-gray-900">{price_data.symbol}</h1>
                <p className="text-lg text-gray-500">{price_data.exchange}</p>
            </header>
            
            <PriceCard data={price_data} />
            <FinancialsCard data={financials} />
            {/* As the backend API expands to provide more fundamental data (e.g., charts, peers),
                additional components can be added here. */}
        </div>
    );
};


// --- Individual Section Components ---

const PriceCard = ({ data }) => {
    const isPositive = data.change >= 0;
    return (
        <Card className="overflow-hidden">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                    <TrendingUp className="h-5 w-5 text-blue-600"/>
                    Price Details
                </CardTitle>
            </CardHeader>
            <CardContent className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-500">Last Traded Price</p>
                    <p className="text-2xl font-bold text-gray-800">₹{data.ltp.toFixed(2)}</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-500">Day&apos;s Change</p>
                    <p className={`text-2xl font-bold ${isPositive ? 'text-green-600' : 'text-red-600'}`}>
                        {isPositive ? '+' : ''}{data.change.toFixed(2)} ({data.percent_change.toFixed(2)}%)
                    </p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-500">Day&apos;s Range</p>
                    <p className="text-lg font-semibold text-gray-800">₹{data.low.toFixed(2)} - ₹{data.high.toFixed(2)}</p>
                </div>
                <div className="p-4 bg-gray-50 rounded-lg">
                    <p className="text-sm text-gray-500">Volume</p>
                    <p className="text-lg font-semibold text-gray-800">{data.volume.toLocaleString('en-IN')}</p>
                </div>
            </CardContent>
        </Card>
    );
};

const FinancialsCard = ({ data }) => {
    return (
        <Card className="overflow-hidden">
            <CardHeader>
                <CardTitle className="flex items-center gap-2 text-lg">
                    <BookOpen className="h-5 w-5 text-blue-600"/>
                    Financials
                </CardTitle>
            </CardHeader>
            <CardContent>
                <div className="p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-yellow-800 mb-4">
                    <p className="font-semibold">Note from Backend:</p>
                    <p>{data.note}</p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                     <div className="p-4 bg-gray-50 rounded-lg">
                        <p className="text-sm text-gray-500">Market Cap</p>
                        <p className="text-xl font-bold text-gray-800">{data.market_cap}</p>
                    </div>
                     <div className="p-4 bg-gray-50 rounded-lg">
                        <p className="text-sm text-gray-500">P/E Ratio</p>
                        <p className="text-xl font-bold text-gray-800">{data.pe_ratio}</p>
                    </div>
                     <div className="p-4 bg-gray-50 rounded-lg">
                        <p className="text-sm text-gray-500">Dividend Yield</p>
                        <p className="text-xl font-bold text-gray-800">{data.dividend_yield}</p>
                    </div>
                </div>
            </CardContent>
        </Card>
    );
};

export default StockSections;

