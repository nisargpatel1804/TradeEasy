"use client"

import { Link } from "react-router-dom"
import { Button } from "@/ui/button"
import { motion } from "framer-motion"
import { TrendingUp, BarChart3, LineChart, PieChart } from "lucide-react"

const Home = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-white via-gray-50 to-gray-100">
      {/* Hero Section */}
      <div className="flex flex-col items-center justify-center min-h-screen px-16 pt-20">
        <motion.div
          className="text-center max-w-4xl mx-auto"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          {/* Logo/Icon */}
          <motion.div
            className="flex justify-center mb-8"
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <div className="relative">
              <div className="absolute inset-0 bg-gradient-to-r from-black to-gray-600 rounded-full blur-xl opacity-20"></div>
              <div className="relative bg-gradient-to-r from-black to-gray-800 p-6 rounded-full">
                <TrendingUp className="h-12 w-12 text-white" />
              </div>
            </div>
          </motion.div>

          {/* Main Heading */}
          <motion.h1
            className="text-6xl font-bold mb-6 bg-gradient-to-r from-black via-gray-800 to-black bg-clip-text text-transparent"
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.3, ease: "easeOut" }}
          >
            Welcome to TradeEasy
          </motion.h1>

          {/* Subtitle */}
          <motion.p
            className="text-xl text-gray-600 mb-12 leading-relaxed max-w-2xl mx-auto"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.4, ease: "easeOut" }}
          >
            Your gateway to seamless stock trading and market insights. Experience the future of trading with advanced
            analytics and real-time market data.
          </motion.p>

          {/* Action Buttons */}
          <motion.div
            className="flex flex-col sm:flex-row gap-6 justify-center items-center"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.8, delay: 0.5, ease: "easeOut" }}
          >
            <Button
              asChild
              className="group relative bg-gradient-to-r from-black to-gray-800 text-white px-8 py-4 rounded-xl hover:from-gray-800 hover:to-black transition-all duration-300 focus:ring-4 focus:ring-gray-300 shadow-lg hover:shadow-xl transform hover:-translate-y-1"
              aria-label="Login to TradeEasy"
            >
              <Link to="/login" className="flex items-center gap-2">
                <span className="text-lg font-semibold">Login</span>
                <motion.div
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  initial={false}
                  animate={{ x: 0 }}
                  whileHover={{ x: 5 }}
                >
                  →
                </motion.div>
              </Link>
            </Button>

            <Button
              asChild
              className="group relative bg-white text-black border-2 border-gray-300 px-8 py-4 rounded-xl hover:bg-gray-50 hover:border-black transition-all duration-300 focus:ring-4 focus:ring-gray-200 shadow-lg hover:shadow-xl transform hover:-translate-y-1"
              aria-label="Sign up for TradeEasy"
            >
              <Link to="/signup" className="flex items-center gap-2">
                <span className="text-lg font-semibold">Sign Up</span>
                <motion.div
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                  initial={false}
                  animate={{ x: 0 }}
                  whileHover={{ x: 5 }}
                >
                  →
                </motion.div>
              </Link>
            </Button>
          </motion.div>
        </motion.div>

        {/* Feature Icons */}
        <motion.div
          className="flex justify-center gap-8 mt-16 opacity-60"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 0.6, y: 0 }}
          transition={{ duration: 1, delay: 0.8 }}
        >
          <motion.div
            whileHover={{ scale: 1.1, opacity: 1 }}
            className="p-4 rounded-full bg-gradient-to-r from-gray-100 to-gray-200"
          >
            <BarChart3 className="h-8 w-8 text-gray-700" />
          </motion.div>
          <motion.div
            whileHover={{ scale: 1.1, opacity: 1 }}
            className="p-4 rounded-full bg-gradient-to-r from-gray-100 to-gray-200"
          >
            <LineChart className="h-8 w-8 text-gray-700" />
          </motion.div>
          <motion.div
            whileHover={{ scale: 1.1, opacity: 1 }}
            className="p-4 rounded-full bg-gradient-to-r from-gray-100 to-gray-200"
          >
            <PieChart className="h-8 w-8 text-gray-700" />
          </motion.div>
        </motion.div>
      </div>
    </div>
  )
}

export default Home
