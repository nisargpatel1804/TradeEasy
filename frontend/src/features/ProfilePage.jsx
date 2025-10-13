import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { toast } from "react-hot-toast";
import * as api from "../services/api.js";
import { useDataContext } from "../context/DataContext.jsx";
import { Skeleton } from "../assets/ui/skeleton.jsx";
import { Card, CardContent, CardHeader, CardTitle } from "../assets/ui/card.jsx";
import { Input } from "../assets/ui/input.jsx";
import { Button } from "../assets/ui/button.jsx";
import { Label } from "../assets/ui/label.jsx";
import { User, Mail, Smartphone, Loader2 } from "lucide-react";

const ProfilePage = () => {
  const { profileData: initialProfile, refreshProfile } = useDataContext();
  const [profile, setProfile] = useState({ username: "", email: "", mobile: "" });
  const [initialData, setInitialData] = useState({ username: "", email: "", mobile: "" });
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (initialProfile) {
      // The mobile number from backend includes +91, remove it for editing
      const mobileForInput = initialProfile.mobile ? initialProfile.mobile.replace(/^\+91/, '') : '';
      const data = {
        username: initialProfile.username || '',
        email: initialProfile.email || '',
        mobile: mobileForInput,
      };
      setProfile(data);
      setInitialData(data); // Store initial state to compare against
      setIsLoading(false);
    }
  }, [initialProfile]);

  const hasChanges = () => {
    return (
      profile.username !== initialData.username ||
      profile.email !== initialData.email ||
      profile.mobile !== initialData.mobile
    );
  };

  const handleChange = (e) => {
    setProfile({ ...profile, [e.target.name]: e.target.value });
    setError(null); // Clear previous errors on change
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!hasChanges() || isUpdating) return;
    
    // Frontend validation
    if (!/^\d{10}$/.test(profile.mobile)) {
        toast.error("Mobile number must be 10 digits.");
        setError("Mobile number must be 10 digits.");
        return;
    }
     if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profile.email)) {
        toast.error("Please enter a valid email address.");
        setError("Please enter a valid email address.");
        return;
    }

    setIsUpdating(true);
    setError(null);

    try {
      // Add back the +91 prefix before sending to the backend
      const payload = { ...profile, mobile: `+91${profile.mobile}` };
      const response = await api.updateProfile(payload);

      if (response.success) {
        toast.success("Profile updated successfully!");
        // Refresh the global context and local state
        await refreshProfile();
      } else {
        throw new Error(response.message || "Failed to update profile.");
      }
    } catch (err) {
      setError(err.message);
      toast.error(`Update failed: ${err.message}`);
    } finally {
      setIsUpdating(false);
    }
  };

  if (isLoading) {
    return (
        <div className="p-4 sm:p-6 lg:p-8 space-y-4">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-64 w-full max-w-lg" />
        </div>
    );
  }

  return (
    <motion.div
      className="p-4 sm:p-6 lg:p-8"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <Card className="max-w-lg mx-auto">
        <CardHeader>
          <CardTitle className="text-2xl font-bold flex items-center gap-2">
            <User />
            My Profile
          </CardTitle>
        </CardHeader>
        <CardContent>
            <div className="text-sm bg-blue-50 border border-blue-200 text-blue-800 rounded-lg p-3 mb-6">
                <strong>Client ID:</strong> {initialProfile?.client_id || 'N/A'} <br/>
                <strong>Account Balance:</strong> ₹{initialProfile?.balance?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
            </div>
            
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && <p className="text-sm text-red-600 bg-red-50 p-3 rounded-md">{error}</p>}
            
            <div className="space-y-2">
              <Label htmlFor="username" className="flex items-center gap-2"><User size={16} /> Username</Label>
              <Input
                id="username"
                name="username"
                type="text"
                value={profile.username}
                onChange={handleChange}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email" className="flex items-center gap-2"><Mail size={16} /> Email</Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={profile.email}
                onChange={handleChange}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mobile" className="flex items-center gap-2"><Smartphone size={16} /> Mobile Number</Label>
              <div className="flex items-center">
                <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-gray-300 bg-gray-50 text-gray-500 text-sm h-10">
                    +91
                </span>
                <Input
                    id="mobile"
                    name="mobile"
                    type="tel"
                    className="rounded-l-none"
                    value={profile.mobile}
                    onChange={handleChange}
                    maxLength="10"
                />
              </div>
            </div>

            <Button type="submit" className="w-full" disabled={isUpdating || !hasChanges()}>
              {isUpdating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating...</> : "Save Changes"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
};

export default ProfilePage;

