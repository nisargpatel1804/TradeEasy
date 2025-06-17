import { useEffect, useState } from "react";
import { getProfile, updateProfile, isAuthenticated } from "@/services/auth";
import { Input } from "@/ui/input";
import { Button } from "@/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/ui/card";
import { Label } from "@/ui/label";
import { Skeleton } from "@/ui/skeleton";
import { useNavigate } from "react-router-dom";

const Profile = () => {
  const [profile, setProfile] = useState({ email: "", mobile: "" });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [updating, setUpdating] = useState(false);
  const navigate = useNavigate();

  // Fetch profile on component mount
  useEffect(() => {
    if (!isAuthenticated()) {
      navigate("/login"); // Redirect to login if not authenticated
      return;
    }

    const fetchProfileData = async () => {
      setLoading(true);
      setError("");

      try {
        const profileData = await getProfile(); // Fetch profile data
        if (profileData) {
          setProfile({
            email: profileData.email || "",
            mobile: profileData.mobile || "",
          });
        }
      } catch (err) {
        setError(err.message || "Failed to fetch profile");
        if (err.message === "Session expired. Please log in again.") {
          navigate("/login"); // Redirect to login on session expiry
        }
      } finally {
        setLoading(false);
      }
    };

    fetchProfileData();
  }, [navigate]);

  // Handle Profile Update
  const handleUpdateProfile = async () => {
    setUpdating(true);
    setError("");

    try {
      const updatedData = await updateProfile(profile); // Update profile
      if (updatedData) {
        alert("Profile updated successfully");
        setProfile(updatedData); // Update local state with new data
      }
    } catch (err) {
      setError(err.message || "Failed to update profile");
      if (err.message === "Session expired. Please log in again.") {
        navigate("/login"); // Redirect to login on session expiry
      }
    } finally {
      setUpdating(false);
    }
  };

  // Handle form input changes
  const handleInputChange = (e) => {
    const { id, value } = e.target;
    setProfile((prevProfile) => ({
      ...prevProfile,
      [id]: value,
    }));
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-white">
      <Card className="w-[400px] shadow-xl">
        <CardHeader>
          <CardTitle className="text-center text-xl font-bold text-black">
            Profile
          </CardTitle>
        </CardHeader>

        <CardContent>
          {loading ? (
            <div className="space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-12 w-full" />
            </div>
          ) : (
            <form
              className="space-y-4"
              onSubmit={(e) => {
                e.preventDefault();
                handleUpdateProfile();
              }}
            >
              {error && (
                <p className="text-red-500 text-center text-sm">{error}</p>
              )}

              <div>
                <Label htmlFor="email">Email</Label>
                <Input
                  id="email"
                  type="email"
                  value={profile.email}
                  onChange={handleInputChange}
                  required
                />
              </div>

              <div>
                <Label htmlFor="mobile">Mobile</Label>
                <Input
                  id="mobile"
                  type="tel"
                  value={profile.mobile}
                  onChange={handleInputChange}
                  required
                />
              </div>

              <Button
                type="submit"
                className="w-full bg-black text-white hover:bg-gray-900"
                disabled={updating}
              >
                {updating ? "Updating..." : "Update Profile"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

export default Profile;