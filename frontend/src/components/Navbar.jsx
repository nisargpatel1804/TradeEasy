"use client"

import { DropdownMenuTrigger } from "@/ui/dropdown-menu"

import { useEffect, useState } from "react"
import { useNavigate } from "react-router-dom"
import { fetchIndices, searchStocks, fetchProfile } from "@/services/api"
import { Input } from "@/ui/input"
import { Avatar, AvatarFallback } from "@/ui/avatar"
import { Button } from "@/ui/button"
import { Bell, Search, TrendingUp, LogOut, User, ChevronDown, BarChart3, Moon, Sun } from "lucide-react"
import { getClientId, isAuthenticated, logout } from "@/services/auth"
import debounce from "lodash.debounce"
import { motion, AnimatePresence } from "framer-motion"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from "@/ui/dropdown-menu"

const Navbar = () => {
  const [profile, setProfile] = useState({ name: "Client Name", clientId: "TR123456" })
  const [indices, setIndices] = useState([])
  const [searchQuery, setSearchQuery] = useState("")
  const [searchResults, setSearchResults] = useState([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [darkMode, setDarkMode] = useState(false)
  const navigate = useNavigate()

  // Initialize dark mode from localStorage
  useEffect(() => {
    const savedDarkMode = localStorage.getItem("darkMode") === "true"
    setDarkMode(savedDarkMode)
    if (savedDarkMode) {
      document.documentElement.classList.add("dark")
    }
  }, [])

  // Toggle dark mode
  const toggleDarkMode = () => {
    const newDarkMode = !darkMode
    setDarkMode(newDarkMode)
    localStorage.setItem("darkMode", newDarkMode.toString())
    if (newDarkMode) {
      document.documentElement.classList.add("dark")
    } else {
      document.documentElement.classList.remove("dark")
    }
  }

  // Fetch profile and indices on load
  useEffect(() => {
    const fetchData = async () => {
      if (!isAuthenticated()) {
        navigate("/login")
        return
      }

      const profileData = await fetchProfile()
      if (profileData) {
        setProfile({
          name: profileData.name || "Client Name",
          clientId: getClientId() || "TR123456",
        })
      }

      try {
        const indicesData = await fetchIndices()
        setIndices(indicesData || [])
      } catch (error) {
        console.error("Failed to fetch indices:", error)
      }
    }

    fetchData()
  }, [navigate])

  // Optimized stock search with faster debounce
  const fetchStockSearch = async (query) => {
    if (!query.trim()) {
      setSearchResults([])
      setSearchLoading(false)
      return
    }

    setSearchLoading(true)
    try {
      const response = await searchStocks(query)

      if (Array.isArray(response)) {
        const filteredResults = response.filter((stock) => stock["1. symbol"]?.match(/\.(NSE|BSE)$/))
        setSearchResults(filteredResults)
      } else if (response?.bestMatches) {
        const filteredResults = response.bestMatches.filter((stock) => stock["1. symbol"]?.match(/\.(NSE|BSE)$/))
        setSearchResults(filteredResults)
      } else {
        setSearchResults([])
      }
    } catch (error) {
      setSearchResults([])
    } finally {
      setSearchLoading(false)
    }
  }

  // Faster debounced search (reduced from 500ms to 300ms)
  const debouncedSearch = debounce(fetchStockSearch, 300)

  useEffect(() => {
    if (searchQuery.trim()) {
      setSearchLoading(true)
    }
    debouncedSearch(searchQuery)
    return () => debouncedSearch.cancel()
  }, [searchQuery])

  // Handle stock selection, removing .NSE/.BSE/.NS/.BO
  const handleSelectStock = (symbol) => {
    const cleanSymbol = symbol.replace(/\.(NSE|BSE|NS|BO)$/, "")
    setSearchQuery("")
    setSearchResults([])
    setSearchLoading(false)
    navigate(`/stock/overview/${cleanSymbol}`)
  }

  // Handle logout
  const handleLogout = async () => {
    try {
      await logout()
      navigate("/login")
    } catch (error) {
      console.error("Logout failed:", error)
    }
  }

  // Helper function to format numbers
  const formatNumber = (value, decimalPlaces = 2) => {
    return value !== undefined && !isNaN(value) ? Number.parseFloat(value).toFixed(decimalPlaces) : "N/A"
  }

  return (
    <motion.div
      className="fixed top-4 left-16 right-16 z-50"
      initial={{ y: -100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      transition={{ duration: 0.6, ease: "easeOut" }}
    >
      <div className="bg-white/95 dark:bg-gray-900/95 backdrop-blur-lg border border-gray-200 dark:border-gray-700 rounded-2xl shadow-xl">
        {/* Market Indices Ticker - Always visible (permanent) */}
        <motion.div
          className="bg-gradient-to-r from-gray-50 to-gray-100 dark:from-gray-800 dark:to-gray-700 border-b border-gray-200 dark:border-gray-700 rounded-t-2xl"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1 }}
          transition={{ duration: 0.4 }}
        >
          <div className="px-6 py-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-8">
                {indices.length > 0 ? (
                  indices
                    .filter((index) => ["Nifty 50", "Sensex"].includes(index.name))
                    .map((index, i) => (
                      <motion.div
                        key={index.name}
                        className="flex items-center gap-3 whitespace-nowrap"
                        initial={{ opacity: 0, x: -20 }}
                        animate={{ opacity: 1, x: 0 }}
                        transition={{ duration: 0.4, delay: i * 0.1 }}
                      >
                        <span className="font-semibold text-sm text-gray-900 dark:text-gray-100">{index.name}</span>
                        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                          ₹{formatNumber(index.price)}
                        </span>
                        <motion.span
                          className={`text-sm font-semibold px-2 py-1 rounded-full ${
                            Number.parseFloat(index.change) >= 0
                              ? "text-green-700 bg-green-100 dark:text-green-400 dark:bg-green-900/30"
                              : "text-red-700 bg-red-100 dark:text-red-400 dark:bg-red-900/30"
                          }`}
                          whileHover={{ scale: 1.05 }}
                        >
                          {Number.parseFloat(index.change) >= 0 ? "+" : ""}
                          {formatNumber(index.change)} ({formatNumber(index.percent_change)}%)
                        </motion.span>
                      </motion.div>
                    ))
                ) : (
                  <div className="flex items-center gap-8">
                    <div className="animate-pulse flex items-center gap-3">
                      <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-16"></div>
                      <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-20"></div>
                      <div className="h-6 bg-gray-300 dark:bg-gray-600 rounded-full w-24"></div>
                    </div>
                    <div className="animate-pulse flex items-center gap-3">
                      <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-16"></div>
                      <div className="h-4 bg-gray-300 dark:bg-gray-600 rounded w-20"></div>
                      <div className="h-6 bg-gray-300 dark:bg-gray-600 rounded-full w-24"></div>
                    </div>
                  </div>
                )}
              </div>

              {/* Indices Button */}
              <Button
                variant="outline"
                size="sm"
                onClick={() => navigate("/indices")}
                className="bg-gradient-to-r from-black to-gray-800 dark:from-gray-700 dark:to-gray-900 text-white border-none hover:from-gray-800 hover:to-black dark:hover:from-gray-600 dark:hover:to-gray-800 transition-all duration-200 flex items-center gap-2 flex-shrink-0"
              >
                <BarChart3 className="h-4 w-4" />
                Indices
              </Button>
            </div>
          </div>
        </motion.div>

        {/* Header Section */}
        <header className="px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-8">
              {/* Logo */}
              <motion.div
                className="flex items-center gap-2"
                whileHover={{ scale: 1.05 }}
                transition={{ type: "spring", stiffness: 400, damping: 17 }}
              >
                <div className="bg-gradient-to-r from-black to-gray-700 dark:from-gray-600 dark:to-gray-800 p-2 rounded-xl">
                  <TrendingUp className="h-6 w-6 text-white" />
                </div>
                <span className="font-bold text-xl bg-gradient-to-r from-black to-gray-700 dark:from-gray-200 dark:to-gray-400 bg-clip-text text-transparent">
                  TradeEasy
                </span>
              </motion.div>

              {/* Search Bar */}
              <div className="relative w-96">
                <motion.div
                  className="relative"
                  whileFocus={{ scale: 1.02 }}
                  transition={{ type: "spring", stiffness: 400, damping: 17 }}
                >
                  <Search className="absolute left-4 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400 dark:text-gray-500" />
                  <Input
                    placeholder="Search NSE/BSE stocks..."
                    className="pl-12 pr-4 py-3 bg-gray-50 dark:bg-gray-800 border-gray-200 dark:border-gray-600 rounded-xl focus:bg-white dark:focus:bg-gray-700 focus:border-gray-400 dark:focus:border-gray-500 transition-all duration-200 text-gray-900 dark:text-gray-100"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                  {searchLoading && (
                    <div className="absolute right-4 top-1/2 transform -translate-y-1/2">
                      <div className="animate-spin h-4 w-4 border-2 border-gray-300 dark:border-gray-600 border-t-black dark:border-t-white rounded-full"></div>
                    </div>
                  )}
                </motion.div>

                {/* Search Results Dropdown */}
                <AnimatePresence>
                  {searchResults.length > 0 && (
                    <motion.div
                      className="absolute left-0 right-0 mt-2 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-xl shadow-xl z-20 overflow-hidden max-h-64 overflow-y-auto"
                      initial={{ opacity: 0, y: -10, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -10, scale: 0.95 }}
                      transition={{ duration: 0.2 }}
                    >
                      {searchResults.map((stock, index) => (
                        <motion.div
                          key={stock["1. symbol"]}
                          className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-700 cursor-pointer border-b border-gray-100 dark:border-gray-700 last:border-b-0"
                          onClick={() => handleSelectStock(stock["1. symbol"])}
                          initial={{ opacity: 0, x: -10 }}
                          animate={{ opacity: 1, x: 0 }}
                          transition={{ duration: 0.2, delay: index * 0.05 }}
                          whileHover={{ backgroundColor: darkMode ? "#374151" : "#f9fafb", x: 4 }}
                        >
                          <div className="font-medium text-gray-900 dark:text-gray-100">{stock["1. symbol"]}</div>
                          <div className="text-sm text-gray-600 dark:text-gray-400">{stock["2. name"]}</div>
                        </motion.div>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Profile & Notifications */}
            <div className="flex items-center gap-4">
              {/* Notification Bell */}
              <motion.button
                type="button"
                className="relative p-2 bg-gray-50 dark:bg-gray-800 hover:bg-gray-100 dark:hover:bg-gray-700 rounded-xl transition-colors duration-200"
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
              >
                <Bell className="h-5 w-5 text-gray-600 dark:text-gray-400" />
                <motion.div
                  className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 rounded-full"
                  animate={{ scale: [1, 1.2, 1] }}
                  transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY }}
                />
              </motion.button>

              {/* Profile Dropdown with dark mode toggle */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <motion.div
                    className="flex items-center gap-3 cursor-pointer p-2 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors duration-200 relative z-50"
                    whileHover={{ scale: 1.02 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Avatar className="ring-2 ring-gray-200 dark:ring-gray-600">
                      <AvatarFallback className="bg-gradient-to-r from-gray-100 to-gray-200 dark:from-gray-700 dark:to-gray-800 text-gray-700 dark:text-gray-300 font-semibold">
                        <User className="h-5 w-5" />
                      </AvatarFallback>
                    </Avatar>
                    <div className="text-sm">
                      <p className="font-semibold text-gray-900 dark:text-gray-100">{profile.name}</p>
                      <p className="text-gray-500 dark:text-gray-400">ID: {profile.clientId}</p>
                    </div>
                    <ChevronDown className="h-4 w-4 text-gray-400 dark:text-gray-500" />
                  </motion.div>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-56 bg-white/95 dark:bg-gray-800/95 backdrop-blur-lg border border-gray-200 dark:border-gray-600 rounded-xl shadow-xl z-[60]">
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation()
                      navigate("/profile")
                    }}
                    className="rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-200"
                  >
                    <User className="mr-3 h-4 w-4 text-gray-600 dark:text-gray-400" />
                    <span className="font-medium text-gray-900 dark:text-gray-100">Profile</span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-gray-200 dark:bg-gray-600" />
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleDarkMode()
                    }}
                    className="rounded-lg hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors duration-200"
                  >
                    {darkMode ? (
                      <Sun className="mr-3 h-4 w-4 text-gray-600 dark:text-gray-400" />
                    ) : (
                      <Moon className="mr-3 h-4 w-4 text-gray-600 dark:text-gray-400" />
                    )}
                    <span className="font-medium text-gray-900 dark:text-gray-100">
                      {darkMode ? "Light Mode" : "Dark Mode"}
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuSeparator className="bg-gray-200 dark:bg-gray-600" />
                  <DropdownMenuItem
                    onClick={(e) => {
                      e.stopPropagation()
                      handleLogout()
                    }}
                    className="rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 hover:text-red-700 dark:hover:text-red-400 transition-colors duration-200"
                  >
                    <LogOut className="mr-3 h-4 w-4" />
                    <span className="font-medium">Logout</span>
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </header>
      </div>
    </motion.div>
  )
}

export default Navbar