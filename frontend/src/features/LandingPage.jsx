import { useEffect, useMemo, useState } from "react";
import { useAuth } from "../context/AuthContext.jsx";
import { signup as register } from "../services/auth.js";
import { Card, CardContent, CardHeader, CardTitle } from "../assets/ui/card.jsx";
import { Button } from "../assets/ui/button.jsx";
import { Input } from "../assets/ui/input.jsx";
import { Label } from "../assets/ui/label.jsx";
import { useToast } from "../assets/ui/use-toast.js";
import { Loader2, TrendingUp } from "lucide-react";

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
      ? "Log in to access your dashboard."
      : "Create your account and start trading with virtual money.";
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
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto flex min-h-screen max-w-5xl items-center px-4 py-10">
        <div className="grid w-full gap-6 lg:grid-cols-2">
          <div className="hidden lg:flex flex-col justify-center">
            <div className="mb-6 flex items-center gap-2 text-slate-900">
              <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm">
                <TrendingUp className="h-5 w-5" />
              </div>
              <div>
                <p className="text-sm font-semibold uppercase tracking-wide text-slate-500">TradeEasy</p>
                <p className="text-2xl font-bold leading-tight">A clean dashboard-first trading experience</p>
              </div>
            </div>

            <div className="space-y-3 rounded-3xl border border-slate-100 bg-white p-5 shadow-sm">
              <p className="text-sm font-semibold text-slate-900">What you get</p>
              <ul className="space-y-2 text-sm text-slate-600">
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Real-time market data + compact dashboard UI
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Watchlist, movers, orders, portfolio in one place
                </li>
                <li className="flex items-start gap-2">
                  <span className="mt-1 h-1.5 w-1.5 rounded-full bg-amber-500" />
                  Safe auth flow with clean UX feedback
                </li>
              </ul>
            </div>
          </div>

          <Card className="w-full rounded-3xl border border-slate-100 shadow-sm">
            <CardHeader className="space-y-3 pb-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-sm lg:hidden">
                    <TrendingUp className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-xl font-semibold text-slate-900">
                      {mode === MODE.login ? "Login" : "Sign up"}
                    </CardTitle>
                    <p className="text-xs font-medium text-slate-500">{subtitle}</p>
                  </div>
                </div>

                <div className="flex rounded-full border border-slate-200 bg-slate-50 p-1 text-[11px]">
                  <button
                    type="button"
                    className={`rounded-full px-3 py-1 font-semibold transition-colors ${
                      mode === MODE.login ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
                    }`}
                    onClick={() => {
                      setMode(MODE.login);
                      setError("");
                    }}
                  >
                    Login
                  </button>
                  <button
                    type="button"
                    className={`rounded-full px-3 py-1 font-semibold transition-colors ${
                      mode === MODE.signup ? "bg-slate-900 text-white" : "text-slate-600 hover:text-slate-900"
                    }`}
                    onClick={() => {
                      setMode(MODE.signup);
                      setError("");
                    }}
                  >
                    Sign up
                  </button>
                </div>
              </div>
            </CardHeader>

            <CardContent className="pt-2">
              {error && (
                <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                  {error}
                </div>
              )}

              {mode === MODE.login ? (
                <form onSubmit={handleSubmitLogin} className="space-y-4">
                  <div className="grid gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="client_id" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Client ID
                      </Label>
                      <Input
                        id="client_id"
                        name="client_id"
                        value={loginForm.client_id}
                        onChange={(e) => setLoginForm((prev) => ({ ...prev, client_id: e.target.value.toUpperCase() }))}
                        placeholder="e.g. ABC1234"
                        required
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="password" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Password
                      </Label>
                      <Input
                        id="password"
                        name="password"
                        type="password"
                        value={loginForm.password}
                        onChange={(e) => setLoginForm((prev) => ({ ...prev, password: e.target.value }))}
                        placeholder="••••••••"
                        required
                      />
                    </div>

                    <label className="flex items-center gap-2 text-sm text-slate-600">
                      <input
                        type="checkbox"
                        checked={Boolean(loginForm.remember_me)}
                        onChange={(e) => setLoginForm((prev) => ({ ...prev, remember_me: e.target.checked }))}
                        className="h-4 w-4 rounded border-slate-300 text-slate-900"
                      />
                      Remember me
                    </label>
                  </div>

                  <Button type="submit" className="w-full rounded-2xl font-semibold" disabled={isSubmitting}>
                    {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Log In"}
                  </Button>

                  <p className="text-center text-xs text-slate-500">
                    New here?{" "}
                    <button
                      type="button"
                      className="font-semibold text-slate-900 hover:underline"
                      onClick={() => {
                        setMode(MODE.signup);
                        setError("");
                      }}
                    >
                      Create an account
                    </button>
                  </p>
                </form>
              ) : (
                <form onSubmit={handleSubmitSignup} className="space-y-4">
                  <div className="grid gap-4">
                    <div className="space-y-1.5">
                      <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Email
                      </Label>
                      <Input
                        id="email"
                        name="email"
                        type="email"
                        value={signupForm.email}
                        onChange={(e) => setSignupForm((prev) => ({ ...prev, email: e.target.value }))}
                        placeholder="you@example.com"
                        required
                      />
                    </div>

                    <div className="space-y-1.5">
                      <Label htmlFor="mobile" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                        Mobile
                      </Label>
                      <div className="flex">
                        <span className="inline-flex items-center rounded-l-2xl border border-r-0 border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700">
                          +91
                        </span>
                        <Input
                          id="mobile"
                          name="mobile"
                          inputMode="numeric"
                          value={signupForm.mobile}
                          onChange={(e) => setSignupForm((prev) => ({ ...prev, mobile: e.target.value.replace(/\D/g, "").slice(0, 10) }))}
                          placeholder="9876543210"
                          className="rounded-l-none"
                          required
                        />
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="signup_password" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Password
                        </Label>
                        <Input
                          id="signup_password"
                          name="password"
                          type="password"
                          value={signupForm.password}
                          onChange={(e) => setSignupForm((prev) => ({ ...prev, password: e.target.value }))}
                          required
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="confirmPassword" className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                          Confirm
                        </Label>
                        <Input
                          id="confirmPassword"
                          name="confirmPassword"
                          type="password"
                          value={signupForm.confirmPassword}
                          onChange={(e) => setSignupForm((prev) => ({ ...prev, confirmPassword: e.target.value }))}
                          required
                        />
                      </div>
                    </div>
                  </div>

                  <Button type="submit" className="w-full rounded-2xl font-semibold" disabled={isSubmitting}>
                    {isSubmitting ? <Loader2 className="h-5 w-5 animate-spin" /> : "Create Account"}
                  </Button>

                  <p className="text-center text-xs text-slate-500">
                    Already have an account?{" "}
                    <button
                      type="button"
                      className="font-semibold text-slate-900 hover:underline"
                      onClick={() => {
                        setMode(MODE.login);
                        setError("");
                      }}
                    >
                      Login
                    </button>
                  </p>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default LandingPage;


