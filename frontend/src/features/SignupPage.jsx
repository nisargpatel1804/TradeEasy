import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { authService } from "@/services/auth.js";
import { Input } from "@/assets/ui/input.jsx";
import { Button } from "@/assets/ui/button.jsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/assets/ui/card.jsx";
import { Label } from "@/assets/ui/label.jsx";
import { Loader2, ClipboardCopy, CheckCircle } from "lucide-react";

const Signup = () => {
  const [formData, setFormData] = useState({
    email: "",
    mobile: "",
    password: "",
    confirmPassword: "",
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [clientId, setClientId] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setClientId("");

    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }

    setLoading(true);
    try {
      // The authService handles the payload transformation (e.g., confirmPassword)
      const response = await authService.signup({
        email: formData.email.trim(),
        mobile: `+91${formData.mobile.trim()}`,
        password: formData.password,
        confirmPassword: formData.confirmPassword,
      });
      
      if (response.client_id) {
        setClientId(response.client_id);
        setShowModal(true);
      } else {
        setError(response.error || "An unknown error occurred during signup.");
      }

    } catch (err) {
      setError(err.message || "Signup failed. The email or mobile may already be in use.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (clientId) {
      await navigator.clipboard.writeText(clientId);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000); // Reset after 2 seconds
    }
  };

  const handleModalClose = () => {
    setShowModal(false);
    navigate("/login");
  };

  return (
    <>
      <div className="flex items-center justify-center min-h-screen bg-gray-50 p-4">
        <Card className="w-full max-w-md shadow-lg border-gray-200">
          <CardHeader className="text-center">
            <CardTitle className="text-2xl font-bold">Create an Account</CardTitle>
            <CardDescription>Enter your details to start your trading journey.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && <p className="text-red-500 text-center text-sm font-medium">{error}</p>}
              <div className="space-y-2">
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  name="email"
                  type="email"
                  placeholder="name@example.com"
                  value={formData.email}
                  onChange={handleChange}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="mobile">Mobile Number</Label>
                 <div className="flex items-center">
                  <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-gray-300 bg-gray-50 text-gray-500 text-sm h-10">
                    +91
                  </span>
                  <Input
                    id="mobile"
                    name="mobile"
                    type="tel"
                    className="rounded-l-none"
                    value={formData.mobile}
                    onChange={handleChange}
                    required
                    pattern="\d{10}"
                    title="Please enter a 10-digit mobile number."
                    placeholder="9876543210"
                  />
                </div>
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
              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input
                  id="confirmPassword"
                  name="confirmPassword"
                  type="password"
                  value={formData.confirmPassword}
                  onChange={handleChange}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? <Loader2 className="animate-spin w-5 h-5" /> : "Create Account"}
              </Button>
            </form>
            <div className="mt-4 text-center text-sm">
              Already have an account?{" "}
              <Link to="/login" className="underline font-medium">
                Log in
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Success Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-60 backdrop-blur-sm">
          <div className="bg-white rounded-xl p-6 w-[90%] max-w-sm shadow-2xl text-center space-y-4 animate-in fade-in-0 zoom-in-95">
            <h2 className="text-xl font-semibold text-green-600">Signup Successful!</h2>
            <p className="text-sm text-gray-600">Your Client ID has been generated. Please save it securely for login.</p>
            <div className="flex justify-center items-center gap-2 bg-gray-100 rounded-md px-3 py-2 border">
              <span className="font-mono text-lg font-bold text-gray-800 tracking-wider">{clientId}</span>
              <Button onClick={handleCopy} variant="ghost" size="icon" className="h-8 w-8">
                {isCopied ? <CheckCircle className="w-5 h-5 text-green-500" /> : <ClipboardCopy className="w-5 h-5 text-gray-600" />}
              </Button>
            </div>
            <Button onClick={handleModalClose} className="w-full">
              Proceed to Login
            </Button>
          </div>
        </div>
      )}
    </>
  );
};

export default Signup;

