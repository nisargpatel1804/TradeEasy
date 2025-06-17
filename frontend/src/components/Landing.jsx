"use client"

import { useState, useEffect } from "react"
import { Link, useNavigate } from "react-router-dom"
import { motion, AnimatePresence, useScroll, useTransform } from "framer-motion"
import { Button } from "@/ui/button"
import { logout, isAuthenticated } from "@/services/auth"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/ui/dropdown-menu"
import {
  TrendingUp,
  Menu,
  Twitter,
  Facebook,
  Instagram,
  Youtube,
  BarChart3,
  LineChart,
  PieChart,
  Shield,
  Zap,
  Target,
  ArrowRight,
  Star,
  Users,
  Award,
} from "lucide-react"
import "../assets/css/LandingCss.css"

const words = ["stock", "investor", "analyst", "opportunity"]

export default function Landing() {
  const [wordIndex, setWordIndex] = useState(0)
  const [isLoggedIn, setIsLoggedIn] = useState(false)
  const navigate = useNavigate()
  const { scrollY } = useScroll()
  const headerOpacity = useTransform(scrollY, [0, 100], [0.95, 0.98])
  const headerBlur = useTransform(scrollY, [0, 100], [8, 20])

  useEffect(() => {
    const interval = setInterval(() => {
      setWordIndex((prev) => (prev + 1) % words.length)
    }, 2000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const checkAuth = async () => {
      const auth = await isAuthenticated()
      setIsLoggedIn(auth)
    }
    checkAuth()
  }, [])

  const handleLogout = async () => {
    await logout()
    setIsLoggedIn(false)
    navigate("/login")
  }

  return (
    <>
      <div className="landing-container">
        {/* Scroll Mask */}
        <div className="scroll-mask" />

        {/* Fixed Header */}
        <motion.header
          className="landing-header"
          initial={{ y: -100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.6, ease: "easeOut" }}
          style={{
            backdropFilter: `blur(${headerBlur}px)`,
          }}
        >
          <motion.nav
            className="landing-nav"
            style={{
              backgroundColor: `rgba(255, 255, 255, ${headerOpacity})`,
            }}
          >
            <div className="nav-bg-gradient" />

            <div className="nav-content">
              <motion.div
                className="nav-logo"
                whileHover={{ scale: 1.05 }}
                transition={{ type: "spring", stiffness: 400, damping: 17 }}
              >
                <motion.div className="logo-icon" whileHover={{ rotate: 360 }} transition={{ duration: 0.6 }}>
                  <TrendingUp className="h-6 w-6 text-white relative z-10" />
                  <div className="logo-hover-overlay" />
                </motion.div>
                <span className="logo-text">TradeEasy</span>
              </motion.div>

              {/* Desktop Navigation */}
              {isLoggedIn ? (
                <div className="nav-desktop">
                  {["Dashboard", "Watchlist", "Portfolio", "Orders", "Profile"].map((item, index) => (
                    <motion.div
                      key={item}
                      initial={{ opacity: 0, y: -10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: index * 0.1 }}
                    >
                      <Button asChild variant="ghost" className="nav-button">
                        <Link to={`/${item.toLowerCase()}`}>{item}</Link>
                      </Button>
                    </motion.div>
                  ))}
                  <Button
                    className="logout-button"
                    onClick={handleLogout}
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    transition={{ type: "spring", stiffness: 400, damping: 17 }}
                    as={motion.button}
                  >
                    Logout
                  </Button>
                </div>
              ) : (
                <div className="nav-desktop">
                  <Button
                    asChild
                    variant="outline"
                    className="signup-button"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    transition={{ type: "spring", stiffness: 400, damping: 17 }}
                    as={motion.button}
                  >
                    <Link to="/signup">Sign Up</Link>
                  </Button>
                  <Button
                    asChild
                    className="login-button"
                    whileHover={{ scale: 1.05 }}
                    whileTap={{ scale: 0.95 }}
                    transition={{ type: "spring", stiffness: 400, damping: 17 }}
                    as={motion.button}
                  >
                    <Link to="/login">Login</Link>
                  </Button>
                </div>
              )}

              {/* Mobile Menu */}
              <div className="nav-mobile">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <motion.div whileHover={{ scale: 1.1 }} whileTap={{ scale: 0.9 }}>
                      <Button variant="ghost" className="p-2" aria-label="Open Menu">
                        <Menu className="h-6 w-6" />
                      </Button>
                    </motion.div>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent className="mobile-dropdown">
                    {isLoggedIn ? (
                      <>
                        {["Dashboard", "Watchlist", "Portfolio", "Orders", "Profile"].map((item) => (
                          <DropdownMenuItem key={item} asChild>
                            <Link to={`/${item.toLowerCase()}`}>{item}</Link>
                          </DropdownMenuItem>
                        ))}
                        <DropdownMenuItem onClick={handleLogout} className="text-red-600">
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
            </div>
          </motion.nav>
        </motion.header>

        {/* Main Content */}
        <main className="landing-main">
          <div className="content-wrapper">
            <div className="hero-section">
              <motion.div
                className="hero-content"
                initial={{ opacity: 0, x: -50 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              >
                <motion.div
                  className="hero-title-container"
                  initial={{ opacity: 0, y: 30 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.6, delay: 0.2 }}
                >
                  <h1 className="hero-title">
                    Every{" "}
                    <span className="hero-word-container">
                      <AnimatePresence mode="wait">
                        <motion.span
                          key={words[wordIndex]}
                          initial={{ opacity: 0, y: 30, rotateX: -90 }}
                          animate={{ opacity: 1, y: 0, rotateX: 0 }}
                          exit={{ opacity: 0, y: -30, rotateX: 90 }}
                          transition={{ duration: 0.6, ease: "easeInOut" }}
                          className="hero-animated-word"
                        >
                          {words[wordIndex]}
                        </motion.span>
                      </AnimatePresence>
                    </span>
                    <br />
                    <motion.span
                      className="hero-subtitle"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: 0.4, duration: 0.8 }}
                    >
                      needs a front page
                    </motion.span>
                  </h1>
                </motion.div>

                <motion.p
                  className="hero-description"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, delay: 0.4 }}
                >
                  Practice trading with virtual money in real market conditions. Learn, strategize, and master the art
                  of trading without risking real capital.
                </motion.p>

                {/* Stats Row */}
                <motion.div
                  className="hero-stats"
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.8, delay: 0.5 }}
                >
                  <div className="stat-item">
                    <Users className="h-5 w-5" />
                    <span>10,000+ Active Traders</span>
                  </div>
                  <div className="stat-item">
                    <Star className="h-5 w-5 text-yellow-500 fill-current" />
                    <span>4.9/5 Rating</span>
                  </div>
                  <div className="stat-item">
                    <Award className="h-5 w-5" />
                    <span>Award Winning Platform</span>
                  </div>
                </motion.div>

                {!isLoggedIn && (
                  <motion.div
                    className="hero-buttons"
                    initial={{ opacity: 0, y: 30 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.8, delay: 0.6 }}
                  >
                    <Button
                      asChild
                      className="hero-cta-button group"
                      whileHover={{ scale: 1.05, y: -2 }}
                      whileTap={{ scale: 0.98 }}
                      transition={{ type: "spring", stiffness: 400, damping: 17 }}
                      as={motion.button}
                    >
                      <Link to="/signup" className="flex items-center gap-3">
                        Get Started Free
                        <motion.div className="group-hover:translate-x-1 transition-transform duration-200">
                          <ArrowRight className="h-5 w-5" />
                        </motion.div>
                      </Link>
                    </Button>
                    <Button
                      asChild
                      variant="outline"
                      className="hero-signin-button"
                      whileHover={{ scale: 1.05, y: -2 }}
                      whileTap={{ scale: 0.98 }}
                      transition={{ type: "spring", stiffness: 400, damping: 17 }}
                      as={motion.button}
                    >
                      <Link to="/login">Sign In</Link>
                    </Button>
                  </motion.div>
                )}
              </motion.div>

              {/* Feature Icons Animation */}
              <motion.div
                className="hero-icons"
                initial={{ opacity: 0, scale: 0.8, x: 50 }}
                animate={{ opacity: 1, scale: 1, x: 0 }}
                transition={{ duration: 0.8, delay: 0.4 }}
              >
                <div className="icons-container">
                  <motion.div
                    className="icons-bg-circle-1"
                    animate={{
                      scale: [1, 1.2, 1],
                      rotate: [0, 180, 360],
                    }}
                    transition={{ duration: 20, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
                  />
                  <motion.div
                    className="icons-bg-circle-2"
                    animate={{
                      scale: [1.2, 1, 1.2],
                      rotate: [360, 180, 0],
                    }}
                    transition={{ duration: 15, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
                  />

                  <div className="icons-grid">
                    {[
                      { Icon: BarChart3, delay: 0 },
                      { Icon: LineChart, delay: 0.1 },
                      { Icon: PieChart, delay: 0.2 },
                      { Icon: TrendingUp, delay: 0.3 },
                    ].map(({ Icon, delay }, index) => (
                      <motion.div
                        key={index}
                        className="icon-card group"
                        initial={{ opacity: 0, y: 20, rotate: -10 }}
                        animate={{ opacity: 1, y: 0, rotate: 0 }}
                        transition={{ delay: delay + 0.5, duration: 0.6 }}
                        whileHover={{
                          scale: 1.1,
                          rotate: [0, -5, 5, 0],
                          y: -10,
                        }}
                        whileTap={{ scale: 0.95 }}
                      >
                        <div className="icon-hover-overlay" />
                        <Icon className="icon" />
                        <motion.div
                          className="icon-particle"
                          animate={{ y: [-5, -15, -5] }}
                          transition={{ duration: 2, repeat: Number.POSITIVE_INFINITY }}
                        />
                      </motion.div>
                    ))}
                  </div>
                </div>
              </motion.div>
            </div>

            {/* Features Section */}
            <motion.div
              className="features-section"
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true }}
              transition={{ duration: 0.8 }}
            >
              <motion.div
                className="features-header"
                initial={{ opacity: 0, y: 30 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6 }}
              >
                <h2 className="features-title">
                  Why Choose <span className="features-brand">TradeEasy</span>?
                </h2>
                <p className="features-subtitle">
                  Experience the most advanced virtual trading platform with real-time data and professional-grade
                  tools.
                </p>
              </motion.div>

              <div className="features-grid">
                {features.map((feature, index) => (
                  <motion.div
                    key={index}
                    className="feature-card group"
                    initial={{ opacity: 0, y: 30 }}
                    whileInView={{ opacity: 1, y: 0 }}
                    viewport={{ once: true }}
                    transition={{ delay: index * 0.1, duration: 0.6 }}
                    whileHover={{
                      scale: 1.02,
                      y: -8,
                      rotateY: 5,
                    }}
                  >
                    <motion.div className="feature-bg-gradient" initial={false} />

                    <div className="feature-content">
                      <motion.div
                        className="feature-icon-container"
                        whileHover={{ rotate: 360, scale: 1.1 }}
                        transition={{ duration: 0.6 }}
                      >
                        <feature.icon className="feature-icon" />
                      </motion.div>
                      <h3 className="feature-title">{feature.title}</h3>
                      <p className="feature-description">{feature.description}</p>
                    </div>

                    <motion.div
                      className="feature-decorative"
                      animate={{ rotate: 360 }}
                      transition={{ duration: 10, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
                    />
                  </motion.div>
                ))}
              </div>
            </motion.div>
          </div>
        </main>
      </div>

      {/* Body-Footer Spacer */}
      <div className="body-footer-spacer" />

      {/* Detached Footer */}
      <footer className="landing-footer">
        <div className="footer-bg-pattern">
          <motion.div
            className="footer-animated-bg"
            animate={{ x: [-1000, 1000] }}
            transition={{ duration: 10, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
          />
        </div>

        <div className="footer-content">
          <div className="footer-grid">
            <motion.div
              className="footer-brand"
              initial={{ opacity: 0, y: 20 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true }}
              transition={{ duration: 0.6 }}
            >
              <div className="footer-logo">
                <motion.div
                  className="footer-logo-icon"
                  whileHover={{ rotate: 360, scale: 1.1 }}
                  transition={{ duration: 0.6 }}
                >
                  <TrendingUp className="h-6 w-6 text-black" />
                </motion.div>
                <span className="footer-logo-text">TradeEasy</span>
              </div>
              <p className="footer-description">
                Your gateway to seamless stock trading and market insights. Start your trading journey today.
              </p>
            </motion.div>

            {[
              {
                title: "About TradeEasy",
                links: ["About Us", "Careers", "Press", "Contact"],
              },
              {
                title: "Products",
                links: ["Virtual Trading", "Market Analysis", "Learning Resources", "API Access"],
              },
              {
                title: "Support",
                links: ["Help Center", "Community", "Documentation", "Status"],
              },
            ].map((section, index) => (
              <motion.div
                key={section.title}
                className="footer-section"
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.6, delay: (index + 1) * 0.1 }}
              >
                <h3 className="footer-section-title">{section.title}</h3>
                <ul className="footer-links">
                  {section.links.map((link) => (
                    <li key={link}>
                      <motion.a href="#" className="footer-link" whileHover={{ x: 5 }}>
                        {link}
                      </motion.a>
                    </li>
                  ))}
                </ul>
              </motion.div>
            ))}
          </div>

          <motion.div
            className="footer-bottom"
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ duration: 0.6, delay: 0.4 }}
          >
            <div className="footer-bottom-content">
              <p className="footer-copyright">© {new Date().getFullYear()} TradeEasy. All rights reserved.</p>
              <div className="footer-bottom-links">
                <div className="footer-legal">
                  <Link to="/privacy" className="footer-legal-link">
                    Privacy Policy
                  </Link>
                  <Link to="/terms" className="footer-legal-link">
                    Terms of Service
                  </Link>
                </div>
                <div className="footer-social">
                  {[Twitter, Facebook, Instagram, Youtube].map((Icon, index) => (
                    <motion.a
                      key={index}
                      href="#"
                      className="footer-social-link"
                      whileHover={{ scale: 1.2, rotate: 5 }}
                      whileTap={{ scale: 0.9 }}
                      transition={{ type: "spring", stiffness: 400, damping: 17 }}
                    >
                      <Icon className="h-6 w-6" />
                    </motion.a>
                  ))}
                </div>
              </div>
            </div>
          </motion.div>
        </div>
      </footer>
    </>
  )
}

const features = [
  {
    title: "Real-Time Market Data",
    description:
      "Practice with live market data from NSE and BSE exchanges with real-time price updates and comprehensive market movements.",
    icon: TrendingUp,
  },
  {
    title: "Virtual Portfolio Management",
    description:
      "Track your virtual investments and performance with detailed analytics, comprehensive portfolio insights, and advanced reporting.",
    icon: BarChart3,
  },
  {
    title: "Advanced Market Analysis",
    description:
      "Access professional-grade technical and fundamental analysis tools with interactive charts, indicators, and market research.",
    icon: LineChart,
  },
  {
    title: "Risk-Free Learning Environment",
    description:
      "Learn and improve your trading skills without risking real money in a completely safe, simulated trading environment.",
    icon: Shield,
  },
  {
    title: "Lightning Fast Execution",
    description:
      "Experience ultra-fast order execution and real-time market updates for the most seamless trading experience possible.",
    icon: Zap,
  },
  {
    title: "Performance Tracking & Analytics",
    description:
      "Get detailed insights from your trading history, patterns, and performance metrics to continuously improve your trading strategy.",
    icon: Target,
  },
]
