import { useState } from "react";
import { Link } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { Input } from "../assets/ui/input.jsx";
import { Button } from "../assets/ui/button.jsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../assets/ui/card.jsx";
import { Label } from "../assets/ui/label.jsx";
import { Loader2 } from "lucide-react";
import { useToast } from "@/assets/ui/use-toast";

const LOGIN_ERROR_MESSAGES = {
  400: "Client ID and password are required.",
  401: "Invalid client ID or password.",
  403: "Your account is inactive. Please contact support to reactivate it.",
  429: "Too many login attempts. Please wait a moment before trying again.",
  500: "We're experiencing issues right now. Please try again shortly.",
  default: "Login failed. Please check your credentials.",
};

const Login = () => {
  const [formData, setFormData] = useState({ client_id: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const { login } = useAuth(); // Get the login function from our AuthContext
  const { toast } = useToast();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      // Use the context's login function. It handles the API call,
      // state update, and navigation on success.
      const response = await login(formData);

      if (response?.success) {
        const description = response.message || "Logged in successfully.";
        toast({
          title: "Login successful",
          description,
        });
        setError("");
      }
    } catch (err) {
      const status = err?.status;
  const fallback = LOGIN_ERROR_MESSAGES[status] || LOGIN_ERROR_MESSAGES.default;
  const hasServerMessage = typeof err?.message === "string" && err.message.trim().length > 0;
  const description = hasServerMessage ? err.message : fallback;
      const toastTitle =
        status === 403
          ? "Account inactive"
          : status === 429
            ? "Too many attempts"
            : "Login failed";

      setError(description);

      toast({
        title: toastTitle,
        description,
        variant: "destructive",
      });

      if (status === 401) {
        setFormData({ client_id: "", password: "" });
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
      <Card className="w-full max-w-md shadow-lg border-gray-200">
        <CardHeader className="text-center">
          <CardTitle className="text-2xl font-bold">Welcome Back</CardTitle>
          <CardDescription>Enter your Client ID and password to access your account.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <p className="text-red-500 text-center text-sm font-medium">{error}</p>}
            <div className="space-y-2">
              <Label htmlFor="client_id">Client ID</Label>
              <Input
                id="client_id"
                name="client_id"
                type="text"
                placeholder="e.g., ABC1234"
                value={formData.client_id}
                onChange={handleChange}
                required
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                value={formData.password}
                onChange={handleChange}
                required
              />
            </div>
            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? <Loader2 className="animate-spin w-5 h-5" /> : "Log In"}
            </Button>
          </form>
          <div className="mt-4 text-center text-sm">
            Don&apos;t have an account?{" "}
            <Link to="/signup" className="underline font-medium">
              Sign up
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;

