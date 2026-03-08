import { CreditCard, KeyRound, LayoutGrid, Scale, Shield, SlidersHorizontal, Users, Waypoints, DollarSign, Image } from 'lucide-react';
import { useState } from 'react';
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
  const [activeTab, setActiveTab] = useState<'users' | 'pricing' | 'cards' | 'payments' | 'integrations' | 'auth-providers' | 'settings' | 'audit' | 'legal-privacy' | 'legal-terms'>('users');
  const currentAdminRole = 'Admin' as const;

  const adminItems = [
    { id: 'users', label: 'User Management', icon: Users, active: true, group: 'main' },
    { id: 'pricing', label: 'Pricing Plans', icon: DollarSign, active: true, group: 'main' },
    { id: 'cards', label: 'Card Templates', icon: Image, active: true, group: 'main' },
    { id: 'payments', label: 'Payments', icon: CreditCard, active: true, group: 'main' },
    { id: 'integrations', label: 'Integrations', icon: LayoutGrid, active: true, group: 'main' },
    { id: 'auth-providers', label: 'Login Providers', icon: KeyRound, active: true, group: 'main' },
    { id: 'settings', label: 'Platform Settings', icon: SlidersHorizontal, active: false, group: 'main' },
    { id: 'audit', label: 'Audit Log', icon: Waypoints, active: false, group: 'main' },
    { id: 'legal-privacy', label: 'Privacy Policy', icon: Scale, active: true, group: 'legal' },
    { id: 'legal-terms', label: 'Terms of Service', icon: Scale, active: true, group: 'legal' },
  ];

  return (
    <div className="min-h-screen bg-[#f5f6fa]">
      <div className="flex min-h-screen">
        <aside className="hidden w-[280px] shrink-0 border-r border-slate-200 bg-white lg:flex lg:flex-col">
          <div className="border-b border-slate-200 px-6 py-6">
            <div className="inline-flex items-center gap-2 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.18em] text-slate-700">
              <Shield size={14} />
              Admin
            </div>
            <div className="mt-4 text-2xl font-black tracking-[-0.03em] text-slate-950">Admin Console</div>
            <p className="mt-2 text-sm leading-6 text-slate-500">Platform controls, users, permissions, and account governance.</p>
          </div>

          <nav className="flex-1 px-4 py-5 space-y-1 overflow-y-auto">
            {adminItems.filter((i) => i.group === 'main').map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  disabled={!item.active}
                  onClick={() => item.active && setActiveTab(item.id as typeof activeTab)}
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

            <div className="pt-4 pb-1 px-4">
              <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Legal</p>
            </div>
            {adminItems.filter((i) => i.group === 'legal').map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setActiveTab(item.id as typeof activeTab)}
                  className={`flex w-full items-center gap-3 rounded-2xl px-4 py-3 text-left text-sm font-semibold transition-colors ${
                    activeTab === item.id
                      ? 'bg-slate-950 text-white'
                      : 'text-slate-700 hover:bg-slate-100'
                  }`}
                >
                  <Icon size={18} />
                  {item.label}
                </button>
              );
            })}
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
