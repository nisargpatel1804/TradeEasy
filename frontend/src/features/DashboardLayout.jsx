import { useState, useMemo, useEffect } from "react";
import { Outlet } from "react-router-dom";
import Navbar from "./Navbar.jsx";
import WatchlistSidebar from "./WatchlistSidebar.jsx";
import { Button } from "../assets/ui/button.jsx";
import { X } from "lucide-react";

const NAVBAR_HEIGHT_DESKTOP = 108; // base height for the fixed header on large screens
const NAVBAR_HEIGHT_MOBILE = 168; // mobile header is taller due to ticker chips row
const SIDEBAR_WIDTH = 340; // px – matches the visual reference width

const DashboardLayout = () => {
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);
  const [navbarHeight, setNavbarHeight] = useState(NAVBAR_HEIGHT_DESKTOP);

  useEffect(() => {
    const updateHeight = () => {
      if (typeof window === "undefined") {
        return;
      }
      const nextHeight = window.innerWidth >= 1024 ? NAVBAR_HEIGHT_DESKTOP : NAVBAR_HEIGHT_MOBILE;
      setNavbarHeight(nextHeight);
    };

    updateHeight();
    window.addEventListener("resize", updateHeight);
    return () => window.removeEventListener("resize", updateHeight);
  }, []);

  const layoutPaddingStyle = useMemo(() => ({
    paddingTop: `${navbarHeight}px`,
  }), [navbarHeight]);

  const sidebarStyle = useMemo(() => ({
    top: `${navbarHeight}px`,
    height: `calc(100vh - ${navbarHeight}px)`,
    width: `${SIDEBAR_WIDTH}px`,
  }), [navbarHeight]);

  return (
    <div className="min-h-screen bg-slate-50 text-gray-900">
      <Navbar onToggleSidebar={() => setIsMobileSidebarOpen(true)} />

      {/* Desktop layout */}
      <div className="flex relative" style={layoutPaddingStyle}>
        <aside
          className="hidden lg:block fixed left-0 border-r border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/75"
          style={sidebarStyle}
        >
          <div className="h-full overflow-y-auto">
            <WatchlistSidebar />
          </div>
        </aside>

        <main className="flex-1 w-full min-h-screen px-4 pb-10 lg:ml-[340px] lg:px-8">
          <Outlet />
        </main>
      </div>

      {/* Mobile drawer */}
      {isMobileSidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-40">
          <div className="absolute inset-0 bg-slate-900/60" onClick={() => setIsMobileSidebarOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-[85%] max-w-xs bg-white shadow-xl flex flex-col">
            <div className="flex items-center justify-between px-4 py-3 border-b">
              <p className="text-sm font-semibold text-slate-700">Watchlist</p>
              <Button variant="ghost" size="icon" onClick={() => setIsMobileSidebarOpen(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <WatchlistSidebar onClose={() => setIsMobileSidebarOpen(false)} isMobile />
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DashboardLayout;
