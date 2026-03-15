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
import { User, Mail, Smartphone, Loader2, ArrowLeft } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { cn } from "../utils/cn.js";

const ProfilePage = () => {
  const { profileData: initialProfile, refreshProfile, setProfile: setContextProfile } = useDataContext();
  const navigate = useNavigate();
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
        // update context so other UI reflects the change immediately
        const updatedProfile = {
          ...initialProfile,
          username: profile.username.trim(),
          email: profile.email.trim().toLowerCase(),
          mobile: `+91${profile.mobile}`,
        };
        setContextProfile(updatedProfile);
        // also update the initialData snapshot so the form disables correctly
        setInitialData({ username: profile.username, email: profile.email, mobile: profile.mobile });
        // we no longer need to fetch from the server; context is now current
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
      <div className="mx-auto max-w-7xl space-y-3 pb-4 pt-2 px-2 sm:px-3 lg:px-4">
        <div className="flex items-center gap-2">
          <Skeleton className="h-9 w-9 rounded-full" />
          <div className="space-y-1">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-3 w-48" />
          </div>
        </div>
        <Skeleton className="h-80 w-full rounded-3xl" />
      </div>
    );
  }

  return (
    <motion.div
      className="mx-auto max-w-7xl space-y-3 pb-4 pt-2 px-2 sm:px-3 lg:px-4"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
    >
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="icon"
            className="h-9 w-9 shrink-0 rounded-full border-slate-200"
            onClick={() => navigate(-1)}
            aria-label="Back"
          >
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-lg font-semibold text-slate-900 sm:text-xl">Profile</h1>
            <p className="text-xs font-medium text-slate-500">Update your account details and contact info.</p>
          </div>
        </div>
      </header>

      <Card className="mx-auto w-full max-w-xl rounded-3xl border border-slate-100 shadow-sm">
        <CardHeader className="space-y-1">
          <CardTitle className="text-base font-semibold text-slate-900 flex items-center gap-2">
            <User className="h-4 w-4" />
            My Profile
          </CardTitle>
          <p className="text-xs font-medium text-slate-500">Client ID and balance are read-only.</p>
        </CardHeader>
        <CardContent>
          <div className="mb-4 rounded-3xl border border-slate-100 bg-slate-50/70 p-4 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Client ID</p>
                <p className="font-semibold text-slate-900">{initialProfile?.client_id || 'N/A'}</p>
              </div>
              <div className="text-right">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Balance</p>
                <p className="font-semibold text-slate-900">
                  ₹{initialProfile?.balance?.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
                </p>
              </div>
            </div>
          </div>
            
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="rounded-2xl border border-red-200 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700">
                {error}
              </div>
            )}
            
            <div className="space-y-2">
              <Label htmlFor="username" className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-2">
                <User className="h-4 w-4" /> Username
              </Label>
              <Input
                id="username"
                name="username"
                type="text"
                value={profile.username}
                onChange={handleChange}
              />
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="email" className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-2">
                <Mail className="h-4 w-4" /> Email
              </Label>
              <Input
                id="email"
                name="email"
                type="email"
                value={profile.email}
                onChange={handleChange}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="mobile" className="text-xs font-semibold uppercase tracking-wide text-slate-500 flex items-center gap-2">
                <Smartphone className="h-4 w-4" /> Mobile
              </Label>
              <div className="flex items-center">
                <span className="inline-flex items-center rounded-l-2xl border border-r-0 border-slate-200 bg-slate-50 px-3 text-sm font-semibold text-slate-700 h-10">
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

            <Button type="submit" className={cn("w-full rounded-2xl font-semibold", isUpdating && "opacity-90")} disabled={isUpdating || !hasChanges()}>
              {isUpdating ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" /> Updating...</> : "Save Changes"}
            </Button>
          </form>
        </CardContent>
      </Card>
    </motion.div>
  );
};

export default ProfilePage;

