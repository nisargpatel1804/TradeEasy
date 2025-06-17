import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { login, isAuthenticated } from "@/services/auth";
import { Input } from "@/ui/input";
import { Button } from "@/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/card";
import { Label } from "@/ui/label";
import { Loader2 } from "lucide-react";

const Login = () => {
  const [formData, setFormData] = useState({ client_id: "", password: "" });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value.trim() });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError("");

    try {
      const response = await login(formData.client_id, formData.password);

      if (response.error) {
        setError(response.error);
      } else if (response.client_id) {
        localStorage.setItem("client_id", response.client_id);
        localStorage.setItem("isAuthenticated", "true");
        if (isAuthenticated()) {
          navigate("/dashboard"); // Redirect after successful login
        } else {
          setError("Authentication failed. Please try again.");
        }
      } else {
        setError("Invalid credentials. Please try again.");
      }
    } catch (err) {
      setError(err.message || "Login failed. Please check your credentials.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-white">
      <Card className="w-[400px] shadow-xl border border-gray-200">
        <CardHeader>
          <CardTitle className="text-center text-xl font-bold text-black">
            Login
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <p className="text-red-500 text-center text-sm">{error}</p>}

            <div>
              <Label htmlFor="client_id">Client ID</Label>
              <Input
                id="client_id"
                name="client_id"
                type="text"
                value={formData.client_id}
                onChange={handleChange}
                required
              />
            </div>

            <div>
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

            <Button
              type="submit"
              className="w-full bg-black text-white hover:bg-gray-900"
              disabled={loading}
            >
              {loading ? <Loader2 className="animate-spin w-5 h-5" /> : "Login"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
};

export default Login;