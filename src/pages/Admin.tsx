import { ChevronDown, CreditCard, FileText, KeyRound, Menu, Shield, SlidersHorizontal, Users, Waypoints, DollarSign, Image, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AppUser } from '../utils/userSession';
import UserManagementPage from '../components/admin/UserManagementPage';
import PricingManagement from '../components/admin/PricingManagement';
import AdminCardsManagement from '../components/admin/AdminCardsManagement';
import PaymentManagement from '../components/admin/PaymentManagement';
import AdminAuthProviders from '../components/admin/AdminAuthProviders';
import AdminPagesManagement from '../components/admin/AdminPagesManagement';
import AdminMediaManagement from '../components/admin/AdminMediaManagement';

type AdminProps = {
  currentUser: AppUser | null;
};

const Admin = ({ currentUser }: AdminProps) => {
  type AdminTab =
    | 'users'
    | 'pricing'
    | 'cards'
    | 'payments'
    | 'auth-providers'
    | 'settings'
    | 'audit'
    | 'pages-home'
    | 'pages-tools'
    | 'pages-pricing-public'
    | 'pages-login'
    | 'pages-privacy'
    | 'pages-terms'
    | 'media';

  const TAB_PATHS: Record<AdminTab, string> = {
    users: '/admin/users',
    pricing: '/admin/pricing',
    cards: '/admin/cards',
    payments: '/admin/payments',
    'auth-providers': '/admin/auth-providers',
    settings: '/admin/settings',
    audit: '/admin/audit',
    'pages-home': '/admin/pages/home',
    'pages-tools': '/admin/pages/tools',
    'pages-pricing-public': '/admin/pages/pricing',
    'pages-login': '/admin/pages/login',
    'pages-privacy': '/admin/pages/privacy',
    'pages-terms': '/admin/pages/terms',
    media: '/admin/media',
  };

  const PATH_TO_TAB: Record<string, AdminTab> = Object.fromEntries(
    Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab as AdminTab])
  );

  const getInitialTab = (): AdminTab => PATH_TO_TAB[window.location.pathname] ?? 'users';

  const [activeTab, setActiveTab] = useState<AdminTab>(getInitialTab);
  const [pagesOpen, setPagesOpen] = useState(() => {
    return window.location.pathname.startsWith('/admin/pages');
  });
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const currentAdminRole = 'Admin' as const;

  const navigateTab = (tab: AdminTab) => {
    setActiveTab(tab);
    window.history.pushState({}, '', TAB_PATHS[tab]);
    setMobileNavOpen(false);
  };

  const adminItems = [
    { id: 'users', label: 'User Management', icon: Users, active: true },
    { id: 'pricing', label: 'Pricing Plans', icon: DollarSign, active: true },
    { id: 'cards', label: 'Card Templates', icon: Image, active: true },
    { id: 'payments', label: 'Payments', icon: CreditCard, active: true },
    { id: 'auth-providers', label: 'Login Providers', icon: KeyRound, active: true },
    { id: 'media', label: 'Media', icon: Image, active: true },
    { id: 'settings', label: 'Platform Settings', icon: SlidersHorizontal, active: false },
    { id: 'audit', label: 'Audit Log', icon: Waypoints, active: false },
  ];

  const pagesItems: { id: AdminTab; label: string }[] = [
    { id: 'pages-home', label: 'Homepage' },
    { id: 'pages-tools', label: 'Tools' },
    { id: 'pages-pricing-public', label: 'Pricing Page' },
    { id: 'pages-login', label: 'Login / Signup' },
    { id: 'pages-privacy', label: 'Privacy Policy' },
    { id: 'pages-terms', label: 'Terms of Service' },
  ];

  const isPagesActive = activeTab.startsWith('pages-');

  useEffect(() => {
    const onPop = () => {
      const tab = PATH_TO_TAB[window.location.pathname];
      if (tab) {
        setActiveTab(tab);
        setPagesOpen(tab.startsWith('pages-'));
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const SidebarContent = () => (
    <>
      <div className="border-b border-slate-200 px-6 py-6">
        <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-slate-700">
          <Shield size={14} />
          Admin
        </div>
        <div className="mt-4 text-2xl font-black tracking-[-0.03em] text-slate-950">Admin Console</div>
        <p className="mt-2 text-sm leading-6 text-slate-500">Platform controls, users, permissions, and account governance.</p>
      </div>

      <nav className="flex-1 min-h-0 px-4 py-5 overflow-y-auto flex flex-col gap-1">
        {adminItems.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              type="button"
              disabled={!item.active}
              onClick={() => item.active && navigateTab(item.id as AdminTab)}
              className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition-colors ${
                activeTab === item.id && item.active
                  ? 'bg-slate-950 text-white'
                  : item.active
                    ? 'text-slate-700 hover:bg-slate-100'
                    : 'cursor-not-allowed text-slate-400'
              }`}
            >
              <Icon size={18} />
              {item.label}
            </button>
          );
        })}

        {/* Pages accordion */}
        <div>
          <button
            type="button"
            onClick={() => setPagesOpen((prev) => !prev)}
            className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition-colors ${
              isPagesActive ? 'bg-slate-950 text-white' : 'text-slate-700 hover:bg-slate-100'
            }`}
          >
            <FileText size={18} />
            <span className="flex-1">Pages</span>
            <ChevronDown
              size={15}
              className={`transition-transform duration-200 ${pagesOpen || isPagesActive ? 'rotate-180' : ''}`}
            />
          </button>

          {(pagesOpen || isPagesActive) && (
            <div className="mt-1 ml-4 flex flex-col gap-0.5 border-l-2 border-slate-100 pl-3">
              {pagesItems.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigateTab(item.id)}
                  className={`flex w-full items-center rounded-xl px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                    activeTab === item.id
                      ? 'bg-slate-100 text-slate-950'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </nav>

      <div className="border-t border-slate-200 px-4 py-4">
        <button
          type="button"
          onClick={() => {
            window.history.pushState({}, document.title, '/dashboard');
            window.dispatchEvent(new PopStateEvent('popstate'));
          }}
          className="w-full rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
        >
          Return to Dakyworld Hub
        </button>
      </div>
    </>
  );

  return (
    <div className="min-h-screen bg-[#f5f6fa]">
      {/* Mobile nav overlay */}
      {mobileNavOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 lg:hidden"
          onClick={() => setMobileNavOpen(false)}
        />
      )}

      {/* Mobile slide-in sidebar */}
      <aside
        className={`fixed inset-y-0 left-0 z-50 flex w-[280px] flex-col bg-white shadow-2xl transition-transform duration-300 lg:hidden ${
          mobileNavOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <span className="text-sm font-bold text-slate-700">Admin Navigation</span>
          <button type="button" onClick={() => setMobileNavOpen(false)} className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100">
            <X size={18} />
          </button>
        </div>
        <div className="flex flex-1 flex-col overflow-hidden">
          <SidebarContent />
        </div>
      </aside>

      <div className="flex min-h-screen">
        {/* Desktop sidebar */}
        <aside className="hidden w-[280px] shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col h-screen sticky top-0">
          <SidebarContent />
        </aside>

        <div className="flex-1 min-w-0">
          <header className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6 sm:py-5">
            <div className="flex items-center gap-3">
              {/* Mobile hamburger */}
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-slate-200 text-slate-600 transition hover:bg-slate-50 lg:hidden"
              >
                <Menu size={18} />
              </button>
              <div className="flex flex-1 flex-col gap-1 min-w-0 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
                <div className="min-w-0">
                  <div className="text-xs font-semibold text-slate-500 sm:text-sm">Admin Dashboard</div>
                  <div className="text-lg font-black tracking-[-0.03em] text-slate-950 sm:text-2xl">Control center</div>
                </div>
                <div className="shrink-0 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600 sm:px-4 sm:py-3 sm:text-sm">
                  Signed in as{' '}
                  <span className="font-semibold text-slate-900">
                    {currentUser?.name?.trim() || currentUser?.email || 'Admin'}
                  </span>{' '}
                  · {currentAdminRole}
                </div>
              </div>
            </div>
          </header>

          <main className="px-4 py-6 md:px-6">
            {activeTab === 'users' && <UserManagementPage currentAdminRole={currentAdminRole} />}
            {activeTab === 'pricing' && <PricingManagement />}
            {activeTab === 'cards' && <AdminCardsManagement />}
            {activeTab === 'payments' && <PaymentManagement />}
            {activeTab === 'auth-providers' && <AdminAuthProviders />}
            {activeTab === 'media' && <AdminMediaManagement />}
            {activeTab === 'settings' && (
              <div className="rounded-2xl border border-slate-200 bg-white p-8">
                <p className="text-slate-600">Platform Settings coming soon...</p>
              </div>
            )}
            {activeTab === 'audit' && (
              <div className="rounded-2xl border border-slate-200 bg-white p-8">
                <p className="text-slate-600">Audit Log coming soon...</p>
              </div>
            )}
            {activeTab.startsWith('pages-') && (
              <AdminPagesManagement activePage={activeTab} />
            )}
          </main>
        </div>
      </div>
    </div>
  );
};

export default Admin;
