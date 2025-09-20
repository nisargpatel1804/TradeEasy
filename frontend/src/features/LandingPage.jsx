import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "@/context/AuthContext.jsx";
import { Button } from "@/assets/ui/button.jsx";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/assets/ui/dropdown-menu.jsx";
import {
  TrendingUp,
  Menu,
  BarChart3,
  LineChart,
  Shield,
  Zap,
  Target,
  ArrowRight,
} from "lucide-react";

// The words to animate in the hero section
const words = ["stock", "investor", "analyst", "opportunity"];
const MotionLink = motion(Link);

export default function LandingPage() {
  // State for the animated hero text
  const [wordIndex, setWordIndex] = useState(0);

  // Get authentication state and logout function from the AuthContext
  const { isLoggedIn, logout } = useAuth();

  // Effect to cycle through the animated words
  useEffect(() => {
    const interval = setInterval(() => {
      setWordIndex((prev) => (prev + 1) % words.length);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  const handleLogout = () => {
    // The logout function from AuthContext handles API call, state change, and redirection.
    logout();
  };

  return (
    <div className="bg-white text-gray-800">
      {/* --- Header --- */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-white/80 backdrop-blur-lg border-b border-gray-200">
        <nav className="container mx-auto px-6 py-3 flex justify-between items-center">
          <Link to="/" className="flex items-center gap-2">
            <TrendingUp className="h-7 w-7 text-blue-600" />
            <span className="text-xl font-bold text-gray-900">TradeEasy</span>
          </Link>

          {/* Desktop Navigation */}
          <div className="hidden md:flex items-center gap-4">
            {isLoggedIn ? (
              <>
                <Button asChild variant="ghost">
                  <Link to="/dashboard">Dashboard</Link>
                </Button>
                <Button onClick={handleLogout} variant="destructive">
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
                {isLoggedIn ? (
                  <>
                    <DropdownMenuItem asChild>
                      <Link to="/dashboard">Dashboard</Link>
                    </DropdownMenuItem>
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
        </nav>
      </header>

      {/* --- Main Content --- */}
      <main>
        {/* Hero Section */}
        <section className="pt-32 pb-20 text-center bg-gray-50">
          <div className="container mx-auto px-6">
            <motion.h1 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.8 }}
              className="text-4xl md:text-6xl font-extrabold text-gray-900 leading-tight"
            >
              Every{" "}
              <span className="text-blue-600 inline-block">
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
              className="mt-6 max-w-2xl mx-auto text-lg text-gray-600"
            >
              Practice trading with virtual money in real market conditions.
              Learn, strategize, and master the art of trading without risking real capital.
            </motion.p>
            {!isLoggedIn && (
              <motion.div 
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.8, delay: 0.4 }}
                className="mt-8 flex justify-center gap-4"
              >
                <Button asChild size="lg" className="group">
                  <MotionLink to="/signup">
                    Get Started Free
                    <ArrowRight className="ml-2 h-5 w-5 transition-transform group-hover:translate-x-1" />
                  </MotionLink>
                </Button>
              </motion.div>
            )}
          </div>
        </section>

        {/* Features Section */}
        <section className="py-20">
          <div className="container mx-auto px-6">
            <div className="text-center mb-12">
              <h2 className="text-3xl md:text-4xl font-bold text-gray-900">Why Choose TradeEasy?</h2>
              <p className="mt-4 text-lg text-gray-600">The tools you need to succeed in a risk-free environment.</p>
            </div>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-8">
              {features.map((feature, index) => (
                <motion.div 
                  key={index}
                  initial={{ opacity: 0, y: 30 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ duration: 0.5, delay: index * 0.1 }}
                  className="bg-white p-6 rounded-xl border border-gray-200 shadow-sm"
                >
                  <div className="flex items-center justify-center h-12 w-12 rounded-full bg-blue-100 text-blue-600">
                    <feature.icon className="h-6 w-6" />
                  </div>
                  <h3 className="mt-5 text-xl font-semibold">{feature.title}</h3>
                  <p className="mt-2 text-gray-600">{feature.description}</p>
                </motion.div>
              ))}
            </div>
          </div>
        </section>
      </main>

      {/* --- Footer --- */}
      <footer className="bg-gray-900 text-white">
        <div className="container mx-auto px-6 py-8 text-center">
            <p>© {new Date().getFullYear()} TradeEasy. All rights reserved.</p>
            <p className="text-sm text-gray-400 mt-2">A virtual trading platform for educational purposes.</p>
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

