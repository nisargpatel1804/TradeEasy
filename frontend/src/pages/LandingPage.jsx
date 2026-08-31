import { useEffect, useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { useAuth } from "../context/AuthContext.jsx";
import { signup as register } from "../services/api.js";
import { Card, CardContent, CardHeader, CardTitle } from "../components/ui/card.jsx";
import { Button } from "../components/ui/button.jsx";
import { Input } from "../components/ui/input.jsx";
import { Label } from "../components/ui/label.jsx";
import { useToast } from "../components/ui/use-toast.js";
import { Loader2, TrendingUp, Activity, ShieldCheck, Sparkles } from "lucide-react";

const MODE = {
  login: "login",
  signup: "signup",
};

const LandingPage = ({ initialMode = MODE.login }) => {
  const { login } = useAuth();
  const { toast } = useToast();

  const [mode, setMode] = useState(initialMode === MODE.signup ? MODE.signup : MODE.login);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");

  const [loginForm, setLoginForm] = useState({ client_id: "", password: "", remember_me: false });
  const [signupForm, setSignupForm] = useState({ email: "", mobile: "", password: "", confirmPassword: "" });

  useEffect(() => {
    setMode(initialMode === MODE.signup ? MODE.signup : MODE.login);
    setError("");
    setIsSubmitting(false);
  }, [initialMode]);

  const subtitle = useMemo(() => {
    return mode === MODE.login
      ? "Welcome back. Access your trading desk."
      : "Start your paper-trading journey today.";
  }, [mode]);

  const handleSubmitLogin = async (event) => {
    event.preventDefault();
    setError("");

    if (!loginForm.client_id || !loginForm.password) {
      setError("Client ID and password are required.");
      return;
    }

    setIsSubmitting(true);
    try {
      await login({
        client_id: loginForm.client_id.toUpperCase().trim(),
        password: loginForm.password,
        remember_me: Boolean(loginForm.remember_me),
      });
      // AuthContext now shows a success toast before navigating
    } catch (err) {
      const message = err?.message || "Invalid credentials. Please try again.";
      setError(message);
      toast({ title: "Login failed", description: message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmitSignup = async (event) => {
    event.preventDefault();
    setError("");

    if (signupForm.password !== signupForm.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if ((signupForm.password || "").length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    if (!/^\d{10}$/.test(signupForm.mobile || "")) {
      setError("Please enter a valid 10-digit mobile number.");
      return;
    }

    setIsSubmitting(true);
    try {
      const response = await register({
        email: signupForm.email.trim(),
        mobile: `+91${signupForm.mobile.trim()}`,
        password: signupForm.password,
        confirm_password: signupForm.confirmPassword,
      });

      if (!response?.success || !response?.client_id) {
        const message = response?.message || "Signup failed. Please try again.";
        setError(message);
        toast({ title: "Signup failed", description: message, variant: "destructive" });
        return;
      }

      // Auto-login after signup (no separate login step).
      await login({
        client_id: String(response.client_id).toUpperCase().trim(),
        password: signupForm.password,
        remember_me: true,
      });

      // context toast already shown, additional feedback not needed
    } catch (err) {
      const message = err?.message || "Signup failed. Please try again.";
      setError(message);
      toast({ title: "Signup failed", description: message, variant: "destructive" });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="relative min-h-screen w-full overflow-hidden bg-slate-50 selection:bg-blue-100 selection:text-blue-900">
      
      {/* --- Ambient Background Orbs --- */}
      <div className="pointer-events-none absolute -left-40 -top-40 h-[500px] w-[500px] rounded-full bg-blue-400/30 mix-blend-multiply blur-[128px] animate-blob" />
      <div className="pointer-events-none absolute -right-40 top-20 h-[500px] w-[500px] rounded-full bg-emerald-300/30 mix-blend-multiply blur-[128px] animate-blob animation-delay-2000" />
      <div className="pointer-events-none absolute -bottom-40 left-1/2 h-[500px] w-[500px] -translate-x-1/2 rounded-full bg-indigo-300/30 mix-blend-multiply blur-[128px] animate-blob animation-delay-4000" />

      <div className="relative z-10 mx-auto flex min-h-screen max-w-7xl items-center justify-center p-4 sm:p-6 lg:p-8">
        <div className="grid w-full items-center gap-12 lg:grid-cols-2 lg:gap-24">
          
          {/* --- Left Column: Hero & Marketing --- */}
          <div className="hidden flex-col justify-center lg:flex relative">
            <div className="mb-8 flex items-center gap-3 text-slate-900">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 text-white shadow-xl shadow-slate-900/20">
                <TrendingUp className="h-6 w-6" />
              </div>
              <span className="text-2xl font-bold tracking-tight">TradeEasy</span>
            </div>

            <h1 className="text-5xl font-extrabold leading-[1.1] tracking-tight text-slate-900 mb-6">
              Paper trading, <br />
              <span className="bg-gradient-to-r from-blue-600 to-indigo-600 bg-clip-text text-transparent">
                perfected.
              </span>
            </h1>
            
            <p className="text-lg text-slate-600 mb-10 max-w-lg leading-relaxed">
              Experience the thrill of the Indian stock market with zero financial risk. Real-time Nifty 50 ticks, institutional-grade execution models, and advanced portfolio analytics.
            </p>

            <div className="space-y-5 max-w-md">
              <div className="flex items-center gap-4 rounded-2xl bg-white/60 p-4 shadow-sm ring-1 ring-slate-200/50 backdrop-blur-sm transition-all hover:bg-white/80 hover:shadow-md">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                  <Activity className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold text-slate-900">Live WebSockets</p>
                  <p className="text-sm text-slate-500">Sub-second tick accuracy directly from the exchange.</p>
                </div>
              </div>
              
              <div className="flex items-center gap-4 rounded-2xl bg-white/60 p-4 shadow-sm ring-1 ring-slate-200/50 backdrop-blur-sm transition-all hover:bg-white/80 hover:shadow-md">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-indigo-100 text-indigo-600">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <div>
                  <p className="font-semibold text-slate-900">Risk-Free Environment</p>
                  <p className="text-sm text-slate-500">Test strategies with a virtual ₹1,000,000 starting wallet.</p>
                </div>
              </div>
            </div>

            {/* Floating Mock UI Elements to show off the frontend capability */}
            <motion.div 
              animate={{ y: [0, -15, 0] }}
              transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
              className="absolute right-0 top-32 w-56 rounded-3xl border border-white/40 bg-white/70 p-5 shadow-2xl backdrop-blur-xl hidden xl:block"
            >
              <p className="text-xs font-bold uppercase tracking-wider text-slate-500">Total P&L</p>
              <p className="text-3xl font-black text-emerald-600 mt-1">+₹14,250</p>
              <div className="mt-3 inline-flex items-center gap-1 rounded-full bg-emerald-100/80 px-2.5 py-1 text-[11px] font-bold text-emerald-700">
                <TrendingUp className="h-3.5 w-3.5" /> +2.45% today
              </div>
            </motion.div>

            <motion.div 
              animate={{ y: [0, 15, 0] }}
              transition={{ duration: 7, repeat: Infinity, ease: "easeInOut", delay: 1 }}
              className="absolute -right-12 bottom-12 w-64 rounded-3xl border border-white/40 bg-white/70 p-5 shadow-2xl backdrop-blur-xl hidden xl:block"
            >
              <div className="flex justify-between items-start mb-2">
                <div>
                  <p className="font-bold text-slate-900">RELIANCE</p>
                  <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">NSE</p>
                </div>
                <Sparkles className="h-5 w-5 text-amber-500" />
              </div>
              <div className="flex items-end justify-between mt-4">
                <p className="text-2xl font-black text-slate-900">₹2,954.20</p>
                <p className="text-sm font-bold text-emerald-600">+1.2%</p>
              </div>
            </motion.div>
          </div>

          {/* --- Right Column: Auth Form --- */}
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }} 
            animate={{ opacity: 1, scale: 1 }} 
            transition={{ duration: 0.4, ease: "easeOut" }}
            className="w-full max-w-md mx-auto lg:ml-auto"
          >
            <Card className="overflow-hidden rounded-[2.5rem] border border-white/80 bg-white/60 shadow-[0_8px_30px_rgb(0,0,0,0.08)] backdrop-blur-2xl">
              <CardHeader className="space-y-4 px-8 pb-4 pt-8">
                <div className="flex items-center gap-3 lg:hidden mb-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-900 to-slate-800 text-white shadow-md">
                    <TrendingUp className="h-5 w-5" />
                  </div>
                  <span className="text-xl font-bold tracking-tight text-slate-900">TradeEasy</span>
                </div>

                <div>
                  <CardTitle className="text-2xl font-bold text-slate-900">
                    {mode === MODE.login ? "Sign in" : "Create account"}
                  </CardTitle>
                  <p className="mt-1.5 text-sm text-slate-500 font-medium">{subtitle}</p>
                </div>

                {/* Segmented Control Toggle */}
                <div className="flex w-full rounded-2xl bg-slate-200/50 p-1.5 shadow-inner">
                  <button
                    type="button"
                    className={`relative w-1/2 rounded-xl py-2 text-sm font-bold transition-all duration-300 ${
                      mode === MODE.login ? "text-slate-900 shadow-sm ring-1 ring-slate-900/5 bg-white" : "text-slate-500 hover:text-slate-700"
                    }`}
                    onClick={() => { setMode(MODE.login); setError(""); }}
                  >
                    Login
                  </button>
                  <button
                    type="button"
                    className={`relative w-1/2 rounded-xl py-2 text-sm font-bold transition-all duration-300 ${
                      mode === MODE.signup ? "text-slate-900 shadow-sm ring-1 ring-slate-900/5 bg-white" : "text-slate-500 hover:text-slate-700"
                    }`}
                    onClick={() => { setMode(MODE.signup); setError(""); }}
                  >
                    Sign up
                  </button>
                </div>
              </CardHeader>

              <CardContent className="px-8 pb-8 pt-2">
                <AnimatePresence mode="popLayout">
                  {error && (
                    <motion.div 
                      initial={{ opacity: 0, y: -10, height: 0 }} 
                      animate={{ opacity: 1, y: 0, height: "auto" }} 
                      exit={{ opacity: 0, y: -10, height: 0 }}
                      className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700 shadow-sm"
                    >
                      {error}
                    </motion.div>
                  )}
                </AnimatePresence>

                <AnimatePresence mode="wait">
                  {mode === MODE.login ? (
                    <motion.form 
                      key="login"
                      initial={{ opacity: 0, x: -15 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: 15 }}
                      transition={{ duration: 0.2 }}
                      onSubmit={handleSubmitLogin} 
                      className="space-y-5"
                    >
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="client_id" className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                            Client ID
                          </Label>
                          <Input
                            id="client_id"
                            name="client_id"
                            className="h-12 rounded-2xl bg-white/70 border-white shadow-sm transition-all focus:bg-white focus:ring-2 focus:ring-blue-500/20"
                            value={loginForm.client_id}
                            onChange={(e) => setLoginForm((prev) => ({ ...prev, client_id: e.target.value.toUpperCase() }))}
                            placeholder="e.g. ABC1234"
                            required
                          />
                        </div>

                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <Label htmlFor="password" className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                              Password
                            </Label>
                          </div>
                          <Input
                            id="password"
                            name="password"
                            type="password"
                            className="h-12 rounded-2xl bg-white/70 border-white shadow-sm transition-all focus:bg-white focus:ring-2 focus:ring-blue-500/20"
                            value={loginForm.password}
                            onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))}
                            placeholder="••••••••"
                            required
                          />
                        </div>

                        <label className="flex items-center gap-3 text-sm font-semibold text-slate-600 cursor-pointer w-fit group">
                          <div className="relative flex items-center">
                            <input
                              type="checkbox"
                              checked={Boolean(loginForm.remember_me)}
                              onChange={(e) => setLoginForm((prev) => ({ ...prev, remember_me: e.target.checked }))}
                              className="peer h-5 w-5 cursor-pointer appearance-none rounded-md border-2 border-slate-300 transition-all checked:border-blue-600 checked:bg-blue-600 group-hover:border-blue-500"
                            />
                            <svg className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-3 w-3 pointer-events-none opacity-0 peer-checked:opacity-100 text-white" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round">
                              <polyline points="20 6 9 17 4 12" />
                            </svg>
                          </div>
                          Keep me signed in
                        </label>
                      </div>

                      <Button type="submit" className="h-12 w-full rounded-2xl font-bold text-base bg-slate-900 text-white hover:bg-slate-800 shadow-xl shadow-slate-900/20 transition-all active:scale-[0.98]" disabled={isSubmitting}>
                        {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Access Dashboard"}
                      </Button>
                    </motion.form>
                  ) : (
                    <motion.form 
                      key="signup"
                      initial={{ opacity: 0, x: 15 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, x: -15 }}
                      transition={{ duration: 0.2 }}
                      onSubmit={handleSubmitSignup} 
                      className="space-y-5"
                    >
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="email" className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                            Email Address
                          </Label>
                          <Input
                            id="email"
                            name="email"
                            type="email"
                            className="h-12 rounded-2xl bg-white/70 border-white shadow-sm transition-all focus:bg-white focus:ring-2 focus:ring-blue-500/20"
                            value={signupForm.email}
                            onChange={(e) => setSignupForm((prev) => ({ ...prev, email: e.target.value }))}
                            placeholder="you@example.com"
                            required
                          />
                        </div>

                        <div className="space-y-2">
                          <Label htmlFor="mobile" className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                            Mobile Number
                          </Label>
                          <div className="flex shadow-sm rounded-2xl bg-white/70 border border-white transition-all focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-500/20">
                            <span className="flex items-center pl-4 pr-3 text-sm font-bold text-slate-500 border-r border-slate-200">
                              +91
                            </span>
                            <input
                              id="mobile"
                              name="mobile"
                              type="tel"
                              inputMode="numeric"
                              className="h-12 w-full bg-transparent px-3 text-sm font-semibold text-slate-900 placeholder:text-slate-400 focus:outline-none"
                              value={signupForm.mobile}
                              onChange={(e) => setSignupForm((prev) => ({ ...prev, mobile: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
                              placeholder="9876543210"
                              required
                            />
                          </div>
                        </div>

                        <div className="grid gap-4 sm:grid-cols-2">
                          <div className="space-y-2">
                            <Label htmlFor="signup_password" className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                              Password
                            </Label>
                            <Input
                              id="signup_password"
                              name="password"
                              type="password"
                              className="h-12 rounded-2xl bg-white/70 border-white shadow-sm transition-all focus:bg-white focus:ring-2 focus:ring-blue-500/20"
                              value={signupForm.password}
                              onChange={(e) => setSignupForm((prev) => ({ ...prev, password: e.target.value }))}
                              required
                            />
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="confirmPassword" className="text-[11px] font-bold uppercase tracking-widest text-slate-500">
                              Confirm
                            </Label>
                            <Input
                              id="confirmPassword"
                              name="confirmPassword"
                              type="password"
                              className="h-12 rounded-2xl bg-white/70 border-white shadow-sm transition-all focus:bg-white focus:ring-2 focus:ring-blue-500/20"
                              value={signupForm.confirmPassword}
                              onChange={(e) => setSignupForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                              required
                            />
                          </div>
                        </div>
                      </div>

                      <Button type="submit" className="h-12 w-full rounded-2xl font-bold text-base bg-slate-900 text-white hover:bg-slate-800 shadow-xl shadow-slate-900/20 transition-all active:scale-[0.98]" disabled={isSubmitting}>
                        {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Create Free Account"}
                      </Button>
                    </motion.form>
                  )}
                </AnimatePresence>
              </CardContent>
            </Card>
            
            <p className="mt-8 text-center text-sm text-slate-500">
              {mode === MODE.login ? "Don't have an account?" : "Already have an account?"} {" "}
              <button
                type="button"
                className="font-bold text-slate-900 hover:text-blue-600 transition-colors"
                onClick={() => {
                  setMode(mode === MODE.login ? MODE.signup : MODE.login);
                  setError("");
                }}
              >
                {mode === MODE.login ? "Sign up now" : "Log in here"}
              </button>
            </p>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

export default LandingPage;