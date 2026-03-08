import { ChevronDown, CreditCard, KeyRound, LayoutGrid, Scale, Shield, SlidersHorizontal, Users, Waypoints, DollarSign, Image } from 'lucide-react';
import { useEffect, useState } from 'react';
import { AppUser } from '../utils/userSession';
import UserManagementPage from '../components/admin/UserManagementPage';
import PricingManagement from '../components/admin/PricingManagement';
import AdminCardsManagement from '../components/admin/AdminCardsManagement';
import PaymentManagement from '../components/admin/PaymentManagement';
import AdminIntegrationsManagement from '../components/admin/AdminIntegrationsManagement';
import AdminAuthProviders from '../components/admin/AdminAuthProviders';
import PrivacyPolicy from './PrivacyPolicy';
import TermsOfService from './TermsOfService';

type AdminProps = {
  currentUser: AppUser | null;
};

const Admin = ({ currentUser }: AdminProps) => {
  type AdminTab = 'users' | 'pricing' | 'cards' | 'payments' | 'integrations' | 'auth-providers' | 'settings' | 'audit' | 'legal-privacy' | 'legal-terms';

  const TAB_PATHS: Record<AdminTab, string> = {
    users: '/admin/users',
    pricing: '/admin/pricing',
    cards: '/admin/cards',
    payments: '/admin/payments',
    integrations: '/admin/integrations',
    'auth-providers': '/admin/auth-providers',
    settings: '/admin/settings',
    audit: '/admin/audit',
    'legal-privacy': '/admin/legal/privacy',
    'legal-terms': '/admin/legal/terms',
  };

  const PATH_TO_TAB: Record<string, AdminTab> = Object.fromEntries(
    Object.entries(TAB_PATHS).map(([tab, path]) => [path, tab as AdminTab])
  );

  const getInitialTab = (): AdminTab => PATH_TO_TAB[window.location.pathname] ?? 'users';

  const [activeTab, setActiveTab] = useState<AdminTab>(getInitialTab);
  const [legalOpen, setLegalOpen] = useState(() => {
    const path = window.location.pathname;
    return path === '/admin/legal/privacy' || path === '/admin/legal/terms';
  });
  const currentAdminRole = 'Admin' as const;

  const navigateTab = (tab: AdminTab) => {
    setActiveTab(tab);
    window.history.pushState({}, '', TAB_PATHS[tab]);
  };

  const adminItems = [
    { id: 'users', label: 'User Management', icon: Users, active: true },
    { id: 'pricing', label: 'Pricing Plans', icon: DollarSign, active: true },
    { id: 'cards', label: 'Card Templates', icon: Image, active: true },
    { id: 'payments', label: 'Payments', icon: CreditCard, active: true },
    { id: 'integrations', label: 'Integrations', icon: LayoutGrid, active: true },
    { id: 'auth-providers', label: 'Login Providers', icon: KeyRound, active: true },
    { id: 'settings', label: 'Platform Settings', icon: SlidersHorizontal, active: false },
    { id: 'audit', label: 'Audit Log', icon: Waypoints, active: false },
  ];

  const legalItems = [
    { id: 'legal-privacy' as const, label: 'Privacy Policy' },
    { id: 'legal-terms' as const, label: 'Terms of Service' },
  ];

  const isLegalActive = activeTab === 'legal-privacy' || activeTab === 'legal-terms';

  useEffect(() => {
    const onPop = () => {
      const tab = PATH_TO_TAB[window.location.pathname];
      if (tab) {
        setActiveTab(tab);
        setLegalOpen(tab === 'legal-privacy' || tab === 'legal-terms');
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  return (
    <div className="min-h-screen bg-[#f5f6fa]">
      <div className="flex min-h-screen">
        <aside className="hidden w-[280px] shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col h-screen sticky top-0">
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

            {/* Legal accordion — sits directly after Audit Log */}
            <div>
              <button
                type="button"
                onClick={() => setLegalOpen((prev) => !prev)}
                className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition-colors ${
                  isLegalActive ? 'bg-slate-950 text-white' : 'text-slate-700 hover:bg-slate-100'
                }`}
              >
                <Scale size={18} />
                <span className="flex-1">Legal</span>
                <ChevronDown
                  size={15}
                  className={`transition-transform duration-200 ${legalOpen || isLegalActive ? 'rotate-180' : ''}`}
                />
              </button>

              {(legalOpen || isLegalActive) && (
                <div className="mt-1 ml-4 flex flex-col gap-0.5 border-l-2 border-slate-100 pl-3">
                  {legalItems.map((item) => (
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
        </aside>

        <div className="flex-1">
          <header className="border-b border-slate-200 bg-white px-6 py-5">
            <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="text-sm font-semibold text-slate-500">Admin Dashboard</div>
                <div className="mt-1 text-2xl font-black tracking-[-0.03em] text-slate-950">Control center</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600">
                Signed in as{' '}
                <span className="font-semibold text-slate-900">
                  {currentUser?.name?.trim() || currentUser?.email || 'Admin'}
                </span>{' '}
                · {currentAdminRole}
              </div>
            </div>
          </header>

          <main className="px-4 py-6 md:px-6">
            {activeTab === 'users' && <UserManagementPage currentAdminRole={currentAdminRole} />}
            {activeTab === 'pricing' && <PricingManagement />}
            {activeTab === 'cards' && <AdminCardsManagement />}
            {activeTab === 'payments' && <PaymentManagement />}
            {activeTab === 'integrations' && <AdminIntegrationsManagement />}
            {activeTab === 'auth-providers' && <AdminAuthProviders />}
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
            {activeTab === 'legal-privacy' && (
              <div className="rounded-2xl border border-slate-200 bg-white p-8">
                <PrivacyPolicy embedded />
              </div>
            )}
            {activeTab === 'legal-terms' && (
              <div className="rounded-2xl border border-slate-200 bg-white p-8">
                <TermsOfService embedded />
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
};

export default Admin;
