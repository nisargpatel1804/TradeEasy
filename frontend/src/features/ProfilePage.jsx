import { useEffect, useState } from "react";
import { fetchProfile as fetchProfileApi, updateProfile } from "@/services/api";
import { isAuthenticatedSync } from "@/services/auth";
import { Input } from "@/assets/ui/input";
import { Button } from "@/assets/ui/button";
import { Card, CardContent } from "@/assets/ui/card";
import { Skeleton } from "@/assets/ui/skeleton";
import { motion } from "framer-motion";
import { useDataContext } from "@/context/DataContext";

const ProfilePage = () => {
  const [profile, setProfile] = useState({ email: "", mobile: "" });
  const [loading, setLoading] = useState(true);
  const [updating, setUpdating] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const { getProfile: getProfileFromContext } = useDataContext();

  useEffect(() => {
    const fetchProfile = async () => {
      setLoading(true);
      setError("");

      // Check if user is authenticated
      if (!isAuthenticatedSync()) {
        setError("User not authenticated. Please log in.");
        setLoading(false);
        return;
      }

      try {
        const response = await fetchProfileApi();
        setProfile(response);
      } catch (err) {
        console.error("Profile fetch error:", err);
        setError(err.error || "Failed to fetch profile");
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, []);

  const handleUpdateProfile = async () => {
    setUpdating(true);
    setError("");
    setSuccess("");

    // ✅ Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(profile.email)) {
      setError("Invalid email format");
      setUpdating(false);
      return;
    }

    // ✅ Validate mobile number format (Assuming 10-digit)
    const mobileRegex = /^\d{10}$/;
    if (!mobileRegex.test(profile.mobile)) {
      setError("Invalid mobile number (10 digits required)");
      setUpdating(false);
      return;
    }

    try {
      // Check if user is authenticated
      if (!isAuthenticatedSync()) {
        throw new Error("User not authenticated");
      }

      await updateProfile(profile);
      setSuccess("Profile updated successfully!");

      try {
        let refreshedProfile = null;
        if (typeof getProfileFromContext === "function") {
          refreshedProfile = await getProfileFromContext(true);
        } else {
          refreshedProfile = await fetchProfileApi();
        }
        if (refreshedProfile) {
          setProfile(refreshedProfile);
        }
      } catch (refreshError) {
        console.warn("Profile refresh after update failed:", refreshError);
      }
    } catch (err) {
      console.error("Profile update error:", err);
      setError(err.error || "Failed to update profile");
    } finally {
      setUpdating(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-white">
        <Skeleton className="w-96 h-32" aria-label="Loading profile..." />
      </div>
    );
  }

  return (
    <div className="p-8 bg-white flex flex-col items-center">
      <motion.h2
        className="text-2xl font-semibold mb-6"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5 }}
      >
        Profile
      </motion.h2>

      {error && <p className="text-red-600 mb-4 font-medium">{error}</p>}
      {success && <p className="text-green-600 mb-4 font-medium">{success}</p>}

      <motion.div
        className="w-full max-w-md"
        initial={{ opacity: 0, scale: 0.9 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.5 }}
      >
        <Card className="p-6 bg-gray-100 rounded-lg shadow-md">
          <CardContent className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-700">
                Email
              </label>
              <Input
                id="email"
                type="email"
                placeholder="Enter your email"
                value={profile.email}
                onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                aria-label="Email input"
              />
            </div>
            <div>
              <label htmlFor="mobile" className="block text-sm font-medium text-gray-700">
                Mobile
              </label>
              <Input
                id="mobile"
                type="tel"
                placeholder="Enter your mobile number"
                value={profile.mobile}
                onChange={(e) => setProfile({ ...profile, mobile: e.target.value })}
                aria-label="Mobile input"
              />
            </div>
            <Button
              className="bg-black text-white w-full"
              onClick={handleUpdateProfile}
              disabled={updating}
              aria-label="Update Profile Button"
            >
              {updating ? "Updating..." : "Update Profile"}
            </Button>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
};

export default ProfilePage;
