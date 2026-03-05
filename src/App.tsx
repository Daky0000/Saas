import { useState, useEffect, useCallback } from 'react';
import { BarChart4, FileText, Palette, Share2, TrendingUp, Settings, Menu, X, LogOut } from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Posts from './pages/Posts';
import Cards from './pages/Cards';
import Connects from './pages/Connects';
import Analytics from './pages/Analytics';
import Profile from './pages/Profile';
import Auth from './pages/Auth';
import OAuthCallback from './pages/OAuthCallback';
import { useOAuthCallback } from './hooks/useOAuth';

type PageType = 'dashboard' | 'posts' | 'cards' | 'connects' | 'analytics' | 'profile';
const PAGE_PATHS: Record<PageType, string> = {
  dashboard: '/dashboard',
  posts: '/posts',
  cards: '/cards',
  connects: '/connects',
  analytics: '/analytics',
  profile: '/profile',
};

const PATH_TO_PAGE = new Map<string, PageType>(
  Object.entries(PAGE_PATHS).map(([page, path]) => [path, page as PageType])
);

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [currentPage, setCurrentPage] = useState<PageType>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isOAuthCallback, setIsOAuthCallback] = useState(false);
  useOAuthCallback();

  const getPageFromPath = useCallback((pathname: string): PageType | null => {
    return PATH_TO_PAGE.get(pathname) ?? null;
  }, []);

  const navigatePath = useCallback((path: string, replace = false) => {
    if (replace) {
      window.history.replaceState({}, document.title, path);
      return;
    }
    window.history.pushState({}, document.title, path);
  }, []);

  const navigateToPage = useCallback(
    (page: PageType, replace = false) => {
      setCurrentPage(page);
      const path = PAGE_PATHS[page];
      if (window.location.pathname !== path || window.location.search) {
        navigatePath(path, replace);
      }
    },
    [navigatePath]
  );

  useEffect(() => {
    const pathname = window.location.pathname;
    const isCallback = pathname.startsWith('/auth/') && pathname.includes('callback');
    setIsOAuthCallback(isCallback);

    const session = localStorage.getItem('auth_session');
    const token = localStorage.getItem('auth_token');
    const loggedIn = Boolean(session || token);
    setIsAuthenticated(loggedIn);

    if (isCallback) {
      return;
    }

    if (!loggedIn) {
      if (pathname !== '/login') {
        navigatePath('/login', true);
      }
      return;
    }

    const pageFromPath = getPageFromPath(pathname);
    if (pageFromPath) {
      setCurrentPage(pageFromPath);
      return;
    }

    if (pathname === '/' || pathname === '/login') {
      navigateToPage('dashboard', true);
      return;
    }

    navigateToPage('dashboard', true);
  }, [getPageFromPath, navigatePath, navigateToPage]);

  useEffect(() => {
    const handlePopState = () => {
      const pathname = window.location.pathname;
      const isCallback = pathname.startsWith('/auth/') && pathname.includes('callback');
      setIsOAuthCallback(isCallback);

      if (isCallback) {
        return;
      }

      if (!isAuthenticated) {
        if (pathname !== '/login') {
          navigatePath('/login', true);
        }
        return;
      }

      const pageFromPath = getPageFromPath(pathname);
      if (pageFromPath) {
        setCurrentPage(pageFromPath);
        return;
      }

      if (pathname === '/login' || pathname === '/') {
        navigateToPage('dashboard', true);
        return;
      }

      navigateToPage('dashboard', true);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [getPageFromPath, isAuthenticated, navigatePath, navigateToPage]);

  const handleLogin = () => {
    localStorage.setItem('auth_session', 'true');
    setIsAuthenticated(true);
    navigateToPage('dashboard', true);
  };

  const handleLogout = () => {
    localStorage.removeItem('auth_session');
    localStorage.removeItem('auth_token');
    localStorage.removeItem('auth_user');
    setIsAuthenticated(false);
    navigatePath('/login', true);
  };

  if (!isAuthenticated && !isOAuthCallback) {
    return <Auth onLogin={handleLogin} />;
  }

  const menuItems = [
    { id: 'dashboard', label: 'Dashboard', icon: BarChart4 },
    { id: 'posts', label: 'Posts', icon: FileText },
    { id: 'cards', label: 'Cards', icon: Palette },
    { id: 'connects', label: 'Connects', icon: Share2 },
    { id: 'analytics', label: 'Analytics', icon: TrendingUp },
    { id: 'profile', label: 'Profile', icon: Settings },
  ];

  const renderPage = () => {
    if (isOAuthCallback) {
      return <OAuthCallback />;
    }

    switch (currentPage) {
      case 'dashboard':
        return <Dashboard />;
      case 'posts':
        return <Posts />;
      case 'cards':
        return <Cards />;
      case 'connects':
        return <Connects />;
      case 'analytics':
        return <Analytics />;
      case 'profile':
        return <Profile />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside className={`${
        sidebarOpen ? 'w-64' : 'w-20'
      } bg-white border-r border-gray-200 transition-all duration-300 hidden md:flex flex-col`}>
        <div className="p-6 border-b border-gray-100">
          <div className="text-2xl font-black text-gray-900">
            {sidebarOpen ? '馃帹 Dakyworld hub' : '馃帹'}
          </div>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          {menuItems.map(item => {
            const IconComponent = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => navigateToPage(item.id as PageType)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-medium ${
                  currentPage === item.id
                    ? 'bg-blue-50 text-blue-600 shadow-sm'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <IconComponent size={20} />
                {sidebarOpen && <span>{item.label}</span>}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gray-100 space-y-2">
          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-medium text-red-600 hover:bg-red-50"
          >
            <LogOut size={20} />
            {sidebarOpen && <span>Logout</span>}
          </button>
          
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="w-full text-gray-500 hover:text-gray-700 transition-colors text-sm py-2"
          >
            {sidebarOpen ? '← Collapse' : '→'}
          </button>
        </div>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Mobile Header */}
        <header className="bg-white border-b border-gray-100 px-4 py-4 flex md:hidden items-center justify-between">
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
          <h1 className="text-xl font-black">馃帹 Dakyworld hub</h1>
          <div className="w-10"></div>
        </header>

        {/* Mobile Sidebar */}
        {sidebarOpen && (
          <div className="md:hidden bg-white p-4 border-b border-gray-100">
            <nav className="space-y-2">
              {menuItems.map(item => {
                const IconComponent = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      navigateToPage(item.id as PageType);
                      setSidebarOpen(false);
                    }}
                    className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-medium ${
                      currentPage === item.id
                        ? 'bg-blue-50 text-blue-600'
                        : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <IconComponent size={20} />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </nav>
          </div>
        )}

        {/* Page Content */}
        <main className="flex-1 overflow-auto p-6 md:p-8">
          {renderPage()}
        </main>
      </div>
    </div>
  );
}

export default App;

