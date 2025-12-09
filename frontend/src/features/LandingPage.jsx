import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../context/AuthContext.jsx";
import { Button } from "../assets/ui/button.jsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "../assets/ui/dropdown-menu.jsx";
import {
  TrendingUp,
  Menu,
  BarChart3,
  LineChart,
  Shield,
  Zap,
  Target,
  ArrowRight,
  Users,
  Clock,
  DollarSign,
  Award,
  CheckCircle2,
  Sparkles,
} from "lucide-react";
import "../assets/css/Landing.css";

// The words to animate in the hero section
const words = ["trader", "investor", "analyst", "enthusiast"];
const MotionLink = motion(Link);

const LandingPage = () => {
  // State for the animated hero text
  const [wordIndex, setWordIndex] = useState(0);

  // Get authentication state and logout function from the AuthContext
  const { isAuthenticated, logout } = useAuth();

  // Effect to cycle through the animated words
  useEffect(() => {
    const interval = setInterval(() => {
      setWordIndex((prev) => (prev + 1) % words.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="landing-container">
      {/* --- Header --- */}
      <header className="landing-header">
        <nav className="landing-nav">
          <Link to="/" className="landing-logo">
            <TrendingUp className="landing-logo-icon h-7 w-7" />
            <span>TradeEasy</span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-4">
            {isAuthenticated ? (
              <>
                <Button asChild variant="ghost">
                  <Link to="/dashboard">Dashboard</Link>
                </Button>
                <Button onClick={logout} variant="secondary">
                  Logout
                </Button>
              </>
            ) : (
              <>
                <Button asChild variant="ghost">
                  <Link to="/login">Login</Link>
                </Button>
                <Button asChild>
                  <Link to="/signup">Sign Up</Link>
                </Button>
              </>
            )}
          </div>

          {/* Mobile Menu */}
          <div className="md:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Menu className="h-6 w-6" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {isAuthenticated ? (
                  <>
                    <DropdownMenuItem asChild>
                      <Link to="/dashboard">Dashboard</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem onClick={logout} className="text-red-600">
                      Logout
                    </DropdownMenuItem>
                  </>
                ) : (
                  <>
                    <DropdownMenuItem asChild>
                      <Link to="/login">Login</Link>
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <Link to="/signup">Sign Up</Link>
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </nav>
      </header>

      {/* --- Main Content --- */}
      <main>
        {/* Hero Section */}
        <section className="landing-hero">
          <div className="landing-hero-content">
            <motion.h1
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              className="landing-hero-title"
            >
              Every{" "}
              <span className="landing-hero-animated-word">
                <AnimatePresence mode="wait">
                  <motion.span
                    key={words[wordIndex]}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -20 }}
                    transition={{ duration: 0.5 }}
                    className="inline-block"
                  >
                    {words[wordIndex]}
                  </motion.span>
                </AnimatePresence>
              </span>
              <br />
              needs a great platform.
            </motion.h1>
            <motion.p
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8, delay: 0.2 }}
              className="landing-hero-subtitle"
            >
              Practice trading with virtual money in real market conditions.
              Learn, strategize, and master the art of trading without risking real capital.
            </motion.p>
            {!isAuthenticated && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.4 }}
                className="landing-hero-cta"
              >
                <Link to="/signup" className="landing-btn-primary">
                  <span>Get Started Free</span>
                  <ArrowRight className="h-5 w-5" />
                </Link>
              </motion.div>
            )}
          </div>
        </section>

        {/* Stats Section */}
        <section className="landing-stats">
          <div className="landing-stats-grid">
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5 }}
              className="landing-stat-card"
            >
              <Users className="w-10 h-10 mx-auto mb-3 text-blue-600" />
              <div className="landing-stat-number">10K+</div>
              <div className="landing-stat-label">Active Traders</div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.1 }}
              className="landing-stat-card"
            >
              <Clock className="w-10 h-10 mx-auto mb-3 text-purple-600" />
              <div className="landing-stat-number">24/7</div>
              <div className="landing-stat-label">Market Access</div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.2 }}
              className="landing-stat-card"
            >
              <DollarSign className="w-10 h-10 mx-auto mb-3 text-green-600" />
              <div className="landing-stat-number">₹10L</div>
              <div className="landing-stat-label">Virtual Capital</div>
            </motion.div>
            <motion.div
              initial={{ opacity: 0, y: 30 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.5, delay: 0.3 }}
              className="landing-stat-card"
            >
              <Award className="w-10 h-10 mx-auto mb-3 text-yellow-600" />
              <div className="landing-stat-number">100%</div>
              <div className="landing-stat-label">Risk-Free</div>
            </motion.div>
          </div>
        </section>

        {/* Features Section */}
        <section className="landing-features">
          <div className="landing-section-header">
            <h2 className="landing-section-title">Why Choose TradeEasy?</h2>
            <p className="landing-section-subtitle">
              The tools you need to succeed in a risk-free environment.
            </p>
          </div>
          <div className="landing-features-grid">
            {features.map((feature, index) => (
              <motion.div
                key={index}
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.5, delay: index * 0.1 }}
                className="landing-feature-card"
              >
                <div className="landing-feature-icon-wrapper">
                  <feature.icon className="h-7 w-7" />
                </div>
                <h3 className="landing-feature-title">{feature.title}</h3>
                <p className="landing-feature-description">{feature.description}</p>
              </motion.div>
            ))}
          </div>
        </section>

        {/* Benefits Section */}
        <section className="py-20 px-6 bg-gradient-to-br from-slate-50 to-blue-50">
          <div className="max-w-6xl mx-auto">
            <div className="landing-section-header">
              <h2 className="landing-section-title">Everything You Need to Succeed</h2>
              <p className="landing-section-subtitle">
                A complete trading platform designed for learning and growth.
              </p>
            </div>
            <div className="grid md:grid-cols-2 gap-8 mt-12">
              {benefits.map((benefit, index) => (
                <motion.div
                  key={index}
                  initial={{ opacity: 0, x: index % 2 === 0 ? -30 : 30 }}
                  whileInView={{ opacity: 1, x: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className="flex gap-4 p-6 bg-white rounded-xl shadow-sm border border-slate-200 hover:shadow-md transition-shadow"
                >
                  <div className="flex-shrink-0">
                    <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
                      <CheckCircle2 className="w-6 h-6 text-white" />
                    </div>
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-slate-900 mb-2">{benefit.title}</h3>
                    <p className="text-slate-600">{benefit.description}</p>
                  </div>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* CTA Section */}
        {!isAuthenticated && (
          <section className="landing-cta">
            <div className="landing-cta-content">
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
              >
                <Sparkles className="w-16 h-16 mx-auto mb-6 text-yellow-300" />
                <h2 className="landing-cta-title">Ready to Start Your Trading Journey?</h2>
                <p className="landing-cta-subtitle">
                  Join thousands of traders learning and growing on TradeEasy. 
                  Start with ₹10,00,000 virtual capital today.
                </p>
                <Link to="/signup" className="landing-cta-button">
                  <span>Create Free Account</span>
                  <ArrowRight className="h-5 w-5" />
                </Link>
              </motion.div>
            </div>
          </section>
        )}
      </main>

      {/* --- Footer --- */}
      <footer className="landing-footer">
        <div className="landing-footer-content">
          <p className="landing-footer-text">© {new Date().getFullYear()} TradeEasy. All rights reserved.</p>
          <p className="landing-footer-subtext">A virtual trading platform for educational purposes.</p>
        </div>
      </footer>
    </div>
  );
}

const features = [
  {
    title: "Real-Time Market Data",
    description: "Practice with live market data from major exchanges with real-time price updates.",
    icon: TrendingUp,
  },
  {
    title: "Virtual Portfolio",
    description: "Track your virtual investments and performance with detailed analytics and reporting.",
    icon: BarChart3,
  },
  {
    title: "Advanced Analysis",
    description: "Access professional-grade tools, interactive charts, and market research.",
    icon: LineChart,
  },
  {
    title: "Risk-Free Learning",
    description: "Improve your skills without risking real money in a safe, simulated environment.",
    icon: Shield,
  },
  {
    title: "Lightning Fast",
    description: "Experience ultra-fast order execution for the most seamless trading experience.",
    icon: Zap,
  },
  {
    title: "Performance Tracking",
    description: "Get detailed insights from your trading history to improve your strategy.",
    icon: Target,
  },
];

const benefits = [
  {
    title: "No Credit Card Required",
    description: "Start trading immediately with no payment information needed. Just sign up and go.",
  },
  {
    title: "Real Market Conditions",
    description: "Experience live market data and prices from NSE and BSE exchanges.",
  },
  {
    title: "Comprehensive Analytics",
    description: "Track your performance with detailed charts, reports, and insights.",
  },
  {
    title: "Multiple Watchlists",
    description: "Create and manage multiple watchlists to organize your trading ideas.",
  },
  {
    title: "Order History",
    description: "Review all your past trades with complete transaction history and details.",
  },
  {
    title: "Educational Platform",
    description: "Learn trading strategies and market analysis in a zero-risk environment.",
  },
];

export default LandingPage;

