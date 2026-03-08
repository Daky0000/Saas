import { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  BarChart4,
  FileText,
  LogOut,
  Menu,
  Palette,
  Receipt,
  Settings,
  Share2,
  TrendingUp,
  X,
} from 'lucide-react';
import Dashboard from './pages/Dashboard';
import Posts from './pages/Posts';
import Cards from './pages/Cards';
import Integrations from './pages/Integrations';
import Admin from './pages/Admin';
import Analytics from './pages/Analytics';
import Pricing from './pages/Pricing';
import Profile from './pages/Profile';
import Auth from './pages/Auth';
import OAuthCallback from './pages/OAuthCallback';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import Landing from './pages/Landing';
import AdvancedTemplateCardModal from './components/AdvancedTemplateCardModal';
import { TemplateEditorProvider } from './hooks/useTemplateEditor';
import { useOAuthCallback } from './hooks/useOAuth';
import {
  AppUser,
  clearStoredUser,
  getStoredUser,
  isProfileComplete,
  normalizeUser,
  setStoredUser,
} from './utils/userSession';

type PageType = 'dashboard' | 'posts' | 'cards' | 'integrations' | 'pricing' | 'admin' | 'analytics' | 'profile';

type AuthMeResponse = {
  success: boolean;
  user?: Partial<AppUser> & { id?: string; email?: string };
};

const safeJson = async <T,>(response: Response): Promise<T | null> => {
  try {
    return (await response.json()) as T;
  } catch {
    return null;
  }
};

const rawApiBaseUrl = (import.meta.env.VITE_API_BASE_URL || '').trim();
const API_BASE_URL = rawApiBaseUrl.includes('api.yourdomain.com')
  ? ''
  : rawApiBaseUrl.replace(/\/$/, '');

const PAGE_PATHS: Record<PageType, string> = {
  dashboard: '/dashboard',
  posts: '/posts',
  cards: '/cards',
  integrations: '/integrations',
  pricing: '/pricing',
  admin: '/admin/users',
  analytics: '/analytics',
  profile: '/profile',
};

const PATH_TO_PAGE = new Map<string, PageType>(
  Object.entries(PAGE_PATHS).map(([page, path]) => [path, page as PageType])
);
PATH_TO_PAGE.set('/connects', 'integrations');
PATH_TO_PAGE.set('/admin', 'admin');

async function fetchCurrentUser(token: string): Promise<AppUser | null> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/me`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      return null;
    }

    const payload = await safeJson<AuthMeResponse>(response);
    if (!payload) {
      return null;
    }

    if (!payload.success || !payload.user?.id || !payload.user?.email) {
      return null;
    }

    return normalizeUser({
      id: payload.user.id,
      email: payload.user.email,
      name: payload.user.name ?? null,
      username: payload.user.username ?? null,
      phone: payload.user.phone ?? null,
      country: payload.user.country ?? null,
      role: payload.user.role === 'admin' ? 'admin' : 'user',
      avatar: payload.user.avatar ?? null,
      cover: payload.user.cover ?? null,
    });
  } catch {
    return null;
  }
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authUser, setAuthUser] = useState<AppUser | null>(() => getStoredUser());
  const [currentPage, setCurrentPage] = useState<PageType>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [isOAuthCallback, setIsOAuthCallback] = useState(false);

  useOAuthCallback();

  useEffect(() => {
    const resetFlag = 'force_auth_reset_done';
    if (sessionStorage.getItem(resetFlag) === '1') {
      return;
    }

    localStorage.removeItem('auth_session');
    localStorage.removeItem('auth_token');
    clearStoredUser();
    sessionStorage.setItem(resetFlag, '1');
  }, []);

  const getPageFromPath = useCallback((pathname: string): PageType | null => {
    if (PATH_TO_PAGE.has(pathname)) return PATH_TO_PAGE.get(pathname)!;
    if (pathname.startsWith('/admin')) return 'admin';
    return null;
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

  const getDefaultPageForUser = useCallback(
    (user: AppUser | null): PageType => (user?.role === 'admin' ? 'admin' : 'dashboard'),
    [],
  );

  useEffect(() => {
    let canceled = false;

    const pathname = window.location.pathname;
    const callbackPath = pathname.startsWith('/auth/') && pathname.includes('callback');
    setIsOAuthCallback(callbackPath);

    const hasSession = Boolean(localStorage.getItem('auth_session'));
    const token = localStorage.getItem('auth_token');
    const loggedIn = Boolean(hasSession || token);
    setIsAuthenticated(loggedIn);

    if (loggedIn) {
      const storedUser = getStoredUser();
      setAuthUser(storedUser);

      if (token) {
        void fetchCurrentUser(token).then((user) => {
          if (canceled) {
            return;
          }

          if (!user) {
            localStorage.removeItem('auth_session');
            localStorage.removeItem('auth_token');
            clearStoredUser();
            setAuthUser(null);
            setIsAuthenticated(false);
            if (window.location.pathname !== '/login') {
              navigatePath('/login', true);
            }
            return;
          }

          const persisted = setStoredUser(user);
          setAuthUser(persisted);
        });
      }
    } else {
      clearStoredUser();
      setAuthUser(null);
    }

    if (callbackPath) {
      return () => {
        canceled = true;
      };
    }

    if (!loggedIn) {
      const publicPaths = ['/', '/privacy', '/terms', '/login'];
      if (!publicPaths.includes(pathname)) {
        navigatePath('/login', true);
      }
      return () => {
        canceled = true;
      };
    }

    const pageFromPath = getPageFromPath(pathname);
    if (pageFromPath) {
      setCurrentPage(pageFromPath);
      return () => {
        canceled = true;
      };
    }

    navigateToPage(getDefaultPageForUser(getStoredUser()), true);
    return () => {
      canceled = true;
    };
  }, [getDefaultPageForUser, getPageFromPath, navigatePath, navigateToPage]);

  useEffect(() => {
    const handlePopState = () => {
      const pathname = window.location.pathname;
      const callbackPath = pathname.startsWith('/auth/') && pathname.includes('callback');
      setIsOAuthCallback(callbackPath);

      if (callbackPath) {
        return;
      }

      if (!isAuthenticated) {
        const publicPaths = ['/', '/privacy', '/terms', '/login'];
        if (!publicPaths.includes(pathname)) {
          navigatePath('/login', true);
        }
        return;
      }

      const pageFromPath = getPageFromPath(pathname);
      if (pageFromPath) {
        setCurrentPage(pageFromPath);
        return;
      }

      navigateToPage(getDefaultPageForUser(getStoredUser()), true);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [getDefaultPageForUser, getPageFromPath, isAuthenticated, navigatePath, navigateToPage]);

  const handleLogin = (user: AppUser) => {
    localStorage.setItem('auth_session', 'true');
    setIsAuthenticated(true);
    const storedUser = setStoredUser(user);
    setAuthUser(storedUser);
    navigateToPage(getDefaultPageForUser(storedUser), true);
  };

  const handleLogout = () => {
    localStorage.removeItem('auth_session');
    localStorage.removeItem('auth_token');
    clearStoredUser();
    setAuthUser(null);
    setIsAuthenticated(false);
    navigatePath('/login', true);
  };

  const handleUserUpdated = (user: AppUser) => {
    const storedUser = setStoredUser(user);
    setAuthUser(storedUser);
  };

  const currentPathname = window.location.pathname;
  // Public pages — only serve to unauthenticated visitors
  if (currentPathname === '/privacy') return <PrivacyPolicy />;
  if (currentPathname === '/terms') return <TermsOfService />;
  if ((currentPathname === '/' || currentPathname === '') && !isAuthenticated) {
    return <Landing onLoginClick={() => navigatePath('/login', true)} />;
  }

  if (!isAuthenticated && !isOAuthCallback) {
    return <Auth onLogin={handleLogin} />;
  }

  if (isAuthenticated && currentPage === 'admin' && authUser?.role !== 'admin') {
    navigateToPage('dashboard', true);
    return <Dashboard currentUser={authUser} />;
  }

  if (isAuthenticated && currentPage === 'admin' && !isOAuthCallback) {
    return (
      <TemplateEditorProvider>
        <Admin currentUser={authUser} />
        <AdvancedTemplateCardModal />
      </TemplateEditorProvider>
    );
  }

  const profileNeedsAttention = !isProfileComplete(authUser);
  const menuItems = [
    { id: 'dashboard' as const, label: 'Dashboard', icon: BarChart4 },
    { id: 'posts' as const, label: 'Posts', icon: FileText },
    { id: 'cards' as const, label: 'Cards', icon: Palette },
    { id: 'integrations' as const, label: 'Integrations', icon: Share2 },
    { id: 'pricing' as const, label: 'Pricing', icon: Receipt },
    { id: 'analytics' as const, label: 'Analytics', icon: TrendingUp },
    { id: 'profile' as const, label: 'Profile', icon: Settings },
  ];

  const renderPage = () => {
    if (isOAuthCallback) {
      return <OAuthCallback />;
    }

    switch (currentPage) {
      case 'dashboard':
        return <Dashboard currentUser={authUser} />;
      case 'posts':
        return <Posts />;
      case 'cards':
        return <Cards />;
      case 'integrations':
        return <Integrations />;
      case 'pricing':
        return <Pricing />;
      case 'admin':
        return <Admin currentUser={authUser} />;
      case 'analytics':
        return <Analytics />;
      case 'profile':
        return <Profile currentUser={authUser} onUserUpdated={handleUserUpdated} />;
      default:
        return <Dashboard currentUser={authUser} />;
    }
  };

  return (
    <TemplateEditorProvider>
      <div className="flex h-screen bg-gray-50">
      <aside
        className={`${
          sidebarOpen ? 'w-64' : 'w-20'
        } bg-white border-r border-gray-200 transition-all duration-300 hidden md:flex flex-col`}
      >
        <div className="p-6 border-b border-gray-100">
          <div className="text-2xl font-black text-gray-900">{sidebarOpen ? 'Dakyworld hub' : 'DH'}</div>
        </div>

        <nav className="flex-1 p-4 space-y-2">
          {menuItems.map((item) => {
            const IconComponent = item.icon;
            return (
              <button
                key={item.id}
                onClick={() => navigateToPage(item.id)}
                className={`w-full relative flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-medium ${
                  currentPage === item.id
                    ? 'bg-blue-50 text-blue-600 shadow-sm'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <IconComponent size={20} />
                {sidebarOpen && <span>{item.label}</span>}
                {item.id === 'profile' && profileNeedsAttention && (
                  <span
                    className="absolute right-3 top-3 text-red-500"
                    title="Complete your profile"
                    aria-label="Profile incomplete"
                  >
                    <AlertCircle size={14} />
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div className="p-4 border-t border-gray-100 space-y-2">
          {authUser?.role === 'admin' && (
            <button
              onClick={() => navigateToPage('admin')}
              className="w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-100"
            >
              Open Admin Portal
            </button>
          )}

          <button
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-medium text-red-600 hover:bg-red-50"
          >
            <LogOut size={20} />
            {sidebarOpen && <span>Logout</span>}
          </button>

          <button
            onClick={() => setSidebarOpen((previous) => !previous)}
            className="w-full text-gray-500 hover:text-gray-700 transition-colors text-sm py-2"
          >
            {sidebarOpen ? 'Collapse' : 'Expand'}
          </button>
        </div>
      </aside>

      <div className="flex-1 flex flex-col overflow-hidden">
        <header className="bg-white border-b border-gray-100 px-4 py-4 flex md:hidden items-center justify-between">
          <button
            onClick={() => setSidebarOpen((previous) => !previous)}
            className="p-2 hover:bg-gray-100 rounded-lg"
          >
            {sidebarOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
          <h1 className="text-xl font-black">Dakyworld hub</h1>
          <div className="w-10" />
        </header>

        {sidebarOpen && (
          <div className="md:hidden bg-white p-4 border-b border-gray-100">
            <nav className="space-y-2">
              {menuItems.map((item) => {
                const IconComponent = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => {
                      navigateToPage(item.id);
                      setSidebarOpen(false);
                    }}
                    className={`w-full relative flex items-center gap-3 px-4 py-3 rounded-xl transition-all duration-200 font-medium ${
                      currentPage === item.id ? 'bg-blue-50 text-blue-600' : 'text-gray-700 hover:bg-gray-50'
                    }`}
                  >
                    <IconComponent size={20} />
                    <span>{item.label}</span>
                    {item.id === 'profile' && profileNeedsAttention && (
                      <span className="absolute right-3 top-3 text-red-500" aria-label="Profile incomplete">
                        <AlertCircle size={14} />
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>
            {authUser?.role === 'admin' && (
              <button
                onClick={() => {
                  navigateToPage('admin');
                  setSidebarOpen(false);
                }}
                className="mt-3 w-full rounded-xl border border-gray-200 bg-gray-50 px-4 py-3 text-sm font-semibold text-gray-700"
              >
                Open Admin Portal
              </button>
            )}
          </div>
        )}

        <main className="flex-1 overflow-auto p-6 md:p-8">{renderPage()}</main>
      </div>
    </div>

      <AdvancedTemplateCardModal />
    </TemplateEditorProvider>
  );
}

export default App;
