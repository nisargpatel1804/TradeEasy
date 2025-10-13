import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { signup as register } from "../services/auth.js";
import { Input } from "../assets/ui/input.jsx";
import { Button } from "../assets/ui/button.jsx";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../assets/ui/card.jsx";
import { Label } from "../assets/ui/label.jsx";
import { useToast } from "../assets/ui/use-toast.js";
import { Loader2, ClipboardCopy, CheckCircle } from "lucide-react";

/**
 * Signup component for user registration.
 * Handles form input, submission, and displays a success modal with the new Client ID.
 */
const SignupPage = () => {
  const [formData, setFormData] = useState({
    email: "",
    mobile: "",
    password: "",
    confirmPassword: "",
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [newClientId, setNewClientId] = useState("");
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    // --- Frontend Validation ---
    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (formData.password.length < 8) {
      setError("Password must be at least 8 characters long.");
      return;
    }
    if (!/^\d{10}$/.test(formData.mobile)) {
        setError("Please enter a valid 10-digit mobile number.");
        return;
    }

    setIsLoading(true);

    try {
      // --- API Call ---
      // The authService will handle the actual API request.
  const response = await register({
        email: formData.email.trim(),
        mobile: `+91${formData.mobile.trim()}`, // Backend expects +91 format
        password: formData.password,
        confirmPassword: formData.confirmPassword,
      });

      if (response.success && response.client_id) {
        setNewClientId(response.client_id);
        setIsModalOpen(true); // Show success modal
        toast({
          title: "Account Created!",
          description: "Please save your Client ID to log in.",
        });
      } else {
        setError(response.message || "An unexpected error occurred.");
      }
    } catch (err) {
      // Catches errors from the API service (e.g., network issues, 409 Conflict)
      setError(err.message || "Signup failed. Please try again.");
    } finally {
      setIsLoading(false);
    }
  };

  const handleCopyToClipboard = async () => {
    if (newClientId) {
      try {
        await navigator.clipboard.writeText(newClientId);
        setIsCopied(true);
        toast({ title: "Client ID copied to clipboard!" });
        setTimeout(() => setIsCopied(false), 2500); // Reset icon after 2.5 seconds
      } catch (err) {
        toast({
          title: "Copy Failed",
          description: "Could not copy to clipboard. Please copy it manually.",
          variant: "destructive",
        });
      }
    }
  };

  const closeModalAndRedirect = () => {
    setIsModalOpen(false);
    navigate("/login");
  };

  return (
    <>
      <div className="flex items-center justify-center min-h-screen bg-gray-100 p-4">
        <Card className="w-full max-w-md shadow-xl border-gray-200">
          <CardHeader className="text-center">
            <CardTitle className="text-3xl font-bold">Create Account</CardTitle>
            <CardDescription>Join TradeEasy to start your investment journey.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {error && <p className="text-red-600 bg-red-50 p-3 rounded-md text-center text-sm font-semibold">{error}</p>}
              
              <div className="space-y-1.5">
                <Label htmlFor="email">Email Address</Label>
                <Input id="email" name="email" type="email" placeholder="you@example.com" value={formData.email} onChange={handleChange} required />
              </div>
              
              <div className="space-y-1.5">
                <Label htmlFor="mobile">Mobile Number</Label>
                <div className="flex">
                    <span className="inline-flex items-center px-3 text-sm text-gray-900 bg-gray-200 border border-r-0 border-gray-300 rounded-l-md">
                        +91
                    </span>
                    <Input id="mobile" name="mobile" type="tel" placeholder="9876543210" value={formData.mobile} onChange={handleChange} required className="rounded-l-none" />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="password">Password</Label>
                <Input id="password" name="password" type="password" value={formData.password} onChange={handleChange} required />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="confirmPassword">Confirm Password</Label>
                <Input id="confirmPassword" name="confirmPassword" type="password" value={formData.confirmPassword} onChange={handleChange} required />
              </div>

              <Button type="submit" className="w-full font-semibold" disabled={isLoading}>
                {isLoading ? <Loader2 className="animate-spin w-5 h-5" /> : "Create Account"}
              </Button>
            </form>
            <p className="mt-6 text-center text-sm text-gray-600">
              Already have an account?{" "}
              <Link to="/login" className="font-semibold text-blue-600 hover:underline">
                Log In
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Success Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50 backdrop-blur-sm">
          <div className="bg-white rounded-lg p-6 md:p-8 w-11/12 max-w-sm shadow-2xl text-center space-y-4 transform transition-all animate-in fade-in-0 zoom-in-95">
            <h2 className="text-2xl font-bold text-gray-800">Signup Successful!</h2>
            <p className="text-sm text-gray-600">
              Your unique Client ID is ready. Please save it securely. You will need it to log in.
            </p>
            <div className="flex justify-center items-center gap-2 bg-gray-100 rounded-lg p-3 border border-gray-200">
              <span className="font-mono text-xl font-bold text-gray-900 tracking-widest">{newClientId}</span>
              <Button onClick={handleCopyToClipboard} variant="ghost" size="icon" className="h-9 w-9">
                {isCopied ? <CheckCircle className="w-5 h-5 text-green-600" /> : <ClipboardCopy className="w-5 h-5 text-gray-500" />}
              </Button>
            </div>
            <Button onClick={closeModalAndRedirect} className="w-full font-semibold">
              Proceed to Login
            </Button>
          </div>
        </div>
      )}
    </>
  );
};

export default SignupPage;

