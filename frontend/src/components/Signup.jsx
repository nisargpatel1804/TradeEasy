import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { signup } from "@/services/auth";
import { Input } from "@/ui/input";
import { Button } from "@/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/card";
import { Label } from "@/ui/label";
import { Loader2, ClipboardCopy } from "lucide-react";

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
  const navigate = useNavigate();

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value.trim() });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setClientId("");

    if (formData.password !== formData.confirmPassword) {
      setError("Passwords do not match");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        email: formData.email.trim(),
        mobile: `+91${formData.mobile.trim()}`,
        password: formData.password,
        confirmPassword: formData.confirmPassword,
      };

      const response = await signup(payload);
      setClientId(response.client_id);
      setShowModal(true);
    } catch (err) {
      setError(err.message || "Signup failed. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = async () => {
    if (clientId) {
      await navigator.clipboard.writeText(clientId);
      alert("Client ID copied to clipboard!");
    }
  };

  const handleModalClose = () => {
    setShowModal(false);
    navigate("/login");
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-white">
      <Card className="w-[400px] shadow-xl border border-gray-200">
        <CardHeader>
          <CardTitle className="text-center text-xl font-bold text-black">
            Sign Up
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            {error && <p className="text-red-500 text-center text-sm">{error}</p>}
            <div>
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={formData.email}
                onChange={handleChange}
                required
              />
            </div>
            <div>
              <Label htmlFor="mobile">Mobile (+91)</Label>
              <Input
                id="mobile"
                name="mobile"
                type="tel"
                value={formData.mobile}
                onChange={handleChange}
                required
                pattern="\d{10}"
                placeholder="Enter 10-digit mobile number"
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
            <div>
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
            <Button
              type="submit"
              className="w-full bg-black text-white hover:bg-gray-900"
              disabled={loading}
            >
              {loading ? <Loader2 className="animate-spin w-5 h-5" /> : "Sign Up"}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* ✅ Modal */}
      {showModal && (
        <div className="fixed inset-0 flex items-center justify-center bg-black bg-opacity-50 z-50">
          <div className="bg-white rounded-xl p-6 w-[90%] max-w-sm shadow-lg text-center space-y-4">
            <h2 className="text-lg font-semibold text-green-600">Signup Successful!</h2>
            <p className="text-sm text-gray-700">Your Client ID is:</p>
            <div className="flex justify-center items-center gap-2 bg-gray-100 rounded-md px-3 py-2">
              <span className="font-mono font-semibold text-black">{clientId}</span>
              <button onClick={handleCopy} title="Copy Client ID">
                <ClipboardCopy className="w-5 h-5 text-gray-700 hover:text-black" />
              </button>
            </div>
            <p className="text-xs text-gray-500">Please copy and save this ID securely.</p>
            <Button
              onClick={handleModalClose}
              className="w-full bg-black text-white hover:bg-gray-900"
            >
              OK
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default Signup;
