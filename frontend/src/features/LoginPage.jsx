import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useAuth } from "../context/AuthContext.jsx";
import { Input } from "../assets/ui/input.jsx";
import { Button } from "../assets/ui/button.jsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../assets/ui/card.jsx";
import { Label } from "../assets/ui/label.jsx";
import { useToast } from "../assets/ui/use-toast.js";
import { Loader2 } from "lucide-react";

/**
 * LoginPage component for user authentication.
 * It uses the AuthContext to handle the login process.
 */
const LoginPage = () => {
  const [formData, setFormData] = useState({ client_id: "", password: "" });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const { login } = useAuth(); // The login function from AuthContext does all the heavy lifting.
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleChange = (e) => {
    const { name, value } = e.target;
    // Convert Client ID to uppercase as the user types for better UX
    const processedValue = name === 'client_id' ? value.toUpperCase().trim() : value;
    setFormData((prev) => ({ ...prev, [name]: processedValue }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    if (!formData.client_id || !formData.password) {
      setError("Client ID and password are required.");
      return;
    }

    setIsLoading(true);

    try {
      // Call the login function from the context.
      // It will handle the API call, update global state, and navigate on success.
      await login({
        client_id: formData.client_id,
        password: formData.password,
      });

      // On successful login, AuthContext will navigate to '/dashboard'.
      // A toast provides immediate feedback.
      toast({
        title: "Login Successful!",
        description: "Welcome back to TradeEasy.",
      });

    } catch (err) {
      // The AuthContext's login function rejects with an error on failure.
      const errorMessage = err.message || "Invalid credentials. Please try again.";
      setError(errorMessage);
      toast({
        title: "Login Failed",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-gray-100 p-4">
      <Card className="w-full max-w-md shadow-xl border-gray-200">
        <CardHeader className="text-center">
          <CardTitle className="text-3xl font-bold">Welcome Back</CardTitle>
          <CardDescription>Log in to access your dashboard.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <p className="text-red-600 bg-red-50 p-3 rounded-md text-center text-sm font-semibold">{error}</p>}
            
            <div className="space-y-1.5">
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
            
            <div className="space-y-1.5">
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                name="password"
                type="password"
                placeholder="••••••••"
                value={formData.password}
                onChange={handleChange}
                required
              />
            </div>
            
            <Button type="submit" className="w-full font-semibold" disabled={isLoading}>
              {isLoading ? <Loader2 className="animate-spin w-5 h-5" /> : "Log In"}
            </Button>
          </form>
          <p className="mt-6 text-center text-sm text-gray-600">
            Don&apos;t have an account?{" "}
            <Link to="/signup" className="font-semibold text-blue-600 hover:underline">
              Sign Up
            </Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
};

export default LoginPage;

