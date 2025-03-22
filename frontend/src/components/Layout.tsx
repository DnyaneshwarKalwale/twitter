import React, { useEffect, useState } from 'react';
import { Outlet, Link, useLocation } from 'react-router-dom';
import { Search, Database, Home, User, Users, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Layout = () => {
  const location = useLocation();
  const [username, setUsername] = useState<string | null>(null);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  
  // Load username from session storage
  useEffect(() => {
    const savedUser = sessionStorage.getItem('tweet-train-user');
    if (savedUser) {
      setUsername(savedUser);
    }
  }, [location.pathname]);
  
  const isActive = (path: string) => {
    return location.pathname === path;
  };

  const toggleMobileMenu = () => {
    setMobileMenuOpen(!mobileMenuOpen);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-blue-50 to-white">
      <header className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container flex h-14 max-w-screen-2xl items-center justify-between">
          <div className="flex items-center">
            <Link to="/" className="flex items-center space-x-2">
              <span className="font-bold text-xl">Tweet Manager</span>
            </Link>
          </div>
          
          {/* Mobile menu button */}
          <button 
            onClick={toggleMobileMenu}
            className="md:hidden flex items-center p-2 rounded-md"
            aria-label={mobileMenuOpen ? "Close menu" : "Open menu"}
          >
            {mobileMenuOpen ? (
              <X className="h-6 w-6" />
            ) : (
              <Menu className="h-6 w-6" />
            )}
          </button>
          
          {/* Desktop navigation */}
          <nav className="hidden md:flex items-center space-x-2 text-sm font-medium">
            <Link
              to="/"
              className={cn(
                "flex items-center rounded-md px-3 py-2 transition-colors hover:text-foreground",
                isActive("/")
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground"
              )}
            >
              <Home className="mr-2 h-4 w-4" />
              <span>Home</span>
            </Link>
            <Link
              to="/saved"
              className={cn(
                "flex items-center rounded-md px-3 py-2 transition-colors hover:text-foreground",
                isActive("/saved") && !location.pathname.includes("/saved/user/")
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground"
              )}
            >
              <Users className="mr-2 h-4 w-4" />
              <span>Saved By Users</span>
            </Link>
            {username && (
              <Link
                to={`/saved/user/${username}`}
                className={cn(
                  "flex items-center rounded-md px-3 py-2 transition-colors hover:text-foreground",
                  isActive(`/saved/user/${username}`)
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground"
                )}
              >
                <User className="mr-2 h-4 w-4" />
                <span>{username}'s Tweets</span>
              </Link>
            )}
          </nav>
        </div>
        
        {/* Mobile navigation */}
        {mobileMenuOpen && (
          <nav className="md:hidden flex flex-col py-3 bg-background border-t">
            <Link
              to="/"
              className={cn(
                "flex items-center rounded-md px-4 py-3 transition-colors hover:text-foreground",
                isActive("/")
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground"
              )}
              onClick={() => setMobileMenuOpen(false)}
            >
              <Home className="mr-2 h-5 w-5" />
              <span>Home</span>
            </Link>
            <Link
              to="/saved"
              className={cn(
                "flex items-center rounded-md px-4 py-3 transition-colors hover:text-foreground",
                isActive("/saved") && !location.pathname.includes("/saved/user/")
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground"
              )}
              onClick={() => setMobileMenuOpen(false)}
            >
              <Users className="mr-2 h-5 w-5" />
              <span>Saved By Users</span>
            </Link>
            {username && (
              <Link
                to={`/saved/user/${username}`}
                className={cn(
                  "flex items-center rounded-md px-4 py-3 transition-colors hover:text-foreground",
                  isActive(`/saved/user/${username}`)
                    ? "bg-muted text-foreground"
                    : "text-muted-foreground"
                )}
                onClick={() => setMobileMenuOpen(false)}
              >
                <User className="mr-2 h-5 w-5" />
                <span>{username}'s Tweets</span>
              </Link>
            )}
          </nav>
        )}
      </header>

      <main className="container max-w-3xl mx-auto px-4 py-8">
        <Outlet />
      </main>
      
      <footer className="container max-w-3xl mx-auto px-4 py-6 border-t mt-auto">
        <div className="flex items-center justify-center">
          <div className="text-sm text-muted-foreground">
            
          </div>
        </div>
      </footer>
    </div>
  );
}; 