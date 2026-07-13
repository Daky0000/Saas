import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  BarChart4,
  Bell,
  Bot,
  Building2,
  ChevronDown,
  CreditCard,
  FileText,
  HelpCircle,
  Layers,
  Loader2,
  LogOut,
  Megaphone,
  Menu,
  Plus,
  Rocket,
  Shield,
  Sparkles,
  Star,
  TrendingUp,
  User,
  Waypoints,
  Settings,
} from 'lucide-react';
import NotificationBell from './components/NotificationBell';
import OnboardingWizard from './components/OnboardingWizard';
import PageTour, { PAGE_GUIDES } from './components/PageTour';
import AdvancedTemplateCardModal from './components/AdvancedTemplateCardModal';
import HelpModal from './components/HelpModal';
import ErrorBoundary from './components/ErrorBoundary';
import ChatWidget from './components/ChatWidget';
import ToastContainer from './components/ToastContainer';
import { ToastContext, useToast, useToastState } from './hooks/useToast';

// Pages — lazy-loaded to split the 3.7 MB bundle into per-route chunks
const Dashboard = lazy(() => import('./pages/Dashboard'));
const Posts = lazy(() => import('./pages/Posts'));
const Cards = lazy(() => import('./pages/Cards'));
const WorkflowPage = lazy(() => import('./pages/Workflow'));
const Admin = lazy(() => import('./pages/Admin'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Pricing = lazy(() => import('./pages/Pricing'));
const Profile = lazy(() => import('./pages/Profile'));
const Media = lazy(() => import('./pages/Media'));
const Integrations = lazy(() => import('./pages/Integrations'));
const Auth = lazy(() => import('./pages/Auth'));
const PrivacyPolicy = lazy(() => import('./pages/PrivacyPolicy'));
const TermsOfService = lazy(() => import('./pages/TermsOfService'));
const RefundPolicy = lazy(() => import('./pages/RefundPolicy'));
const Landing = lazy(() => import('./pages/Landing'));
const Tools = lazy(() => import('./pages/Tools'));
const PublicPricing = lazy(() => import('./pages/PublicPricing'));
const DataDeletion = lazy(() => import('./pages/DataDeletion'));
const OAuthCallback = lazy(() => import('./pages/OAuthCallback'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));
const VerifyEmail = lazy(() => import('./pages/VerifyEmail'));
const PostAutomation = lazy(() => import('./pages/PostAutomation'));
const MarketingOverview = lazy(() => import('./pages/MarketingOverview'));
const MarketingContacts = lazy(() => import('./pages/MarketingContacts'));
const MarketingEmail = lazy(() => import('./pages/MarketingEmail'));
const MarketingCampaigns = lazy(() => import('./pages/MarketingCampaigns'));
const MarketingSurveys = lazy(() => import('./pages/MarketingSurveys'));
const MarketingAutomations = lazy(() => import('./pages/MarketingAutomations'));
const MarketingForms = lazy(() => import('./pages/MarketingForms'));
const CRMCompanies = lazy(() => import('./pages/CRMCompanies'));
const CRMPipeline = lazy(() => import('./pages/CRMPipeline'));
const CRMLeadScoring = lazy(() => import('./pages/CRMLeadScoring'));
const GmailAgent = lazy(() => import('./pages/GmailAgent'));
const ConnectorHub = lazy(() => import('./pages/ConnectorHub'));
const ConnectorProviderSetup = lazy(() => import('./pages/ConnectorProviderSetup'));
const ConnectorSyncDashboard = lazy(() => import('./pages/ConnectorSyncDashboard'));
const PublicSurvey = lazy(() => import('./pages/PublicSurvey'));
const Workspace = lazy(() => import('./pages/Workspace'));
const AcceptInvite = lazy(() => import('./pages/AcceptInvite'));
const Billing = lazy(() => import('./pages/Billing'));
const Memory = lazy(() => import('./pages/Memory'));
const Changelog = lazy(() => import('./pages/Changelog'));
const AITeam = lazy(() => import('./pages/AITeam'));
const Discover = lazy(() => import('./pages/Discover'));
const Notifications = lazy(() => import('./pages/Notifications'));
const TasksPage = lazy(() => import('./components/tasks/TasksPage'));
const ProjectSettings = lazy(() => import('./pages/ProjectSettings'));
const SettingsPage = lazy(() => import('./pages/Settings'));
import { TemplateEditorProvider } from './hooks/useTemplateEditor';
import { WorkspaceProvider, useWorkspace } from './contexts/WorkspaceContext';
import { API_BASE_URL } from './utils/apiBase';
import {
  AppUser,
  clearStoredUser,
  getStoredUser,
  isProfileComplete,
  normalizeUser,
  setStoredUser,
} from './utils/userSession';

const PageFallback = () => (
  <div className="flex items-center justify-center h-full min-h-[200px]">
    <Loader2 className="h-6 w-6 animate-spin text-slate-300" />
  </div>
);

export type PageType =
  | 'dashboard'
  | 'notifications'
  | 'posts'
  | 'post-automation'
  | 'cards'
  | 'media'
  | 'analytics'
  | 'admin'
  | 'profile'
  | 'memory'
  | 'integrations'
  | 'marketing'
  | 'marketing-contacts'
  | 'marketing-email'
  | 'marketing-campaigns'
  | 'marketing-surveys'
  | 'marketing-automations'
  | 'marketing-forms'
  | 'crm-companies'
  | 'crm-pipeline'
  | 'crm-scoring'
  | 'gmail-agent'
  | 'connector-hub'
  | 'connector-setup'
  | 'connector-sync'
  | 'workspace'
  | 'billing'
  | 'pricing'
  | 'tasks'
  | 'project-settings'
  | 'settings'
  | 'workflow'
  | 'discover'
  | 'ai-team';

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

const PAGE_PATHS: Record<PageType, string> = {
  dashboard: '/dashboard',
  notifications: '/notifications',
  posts: '/posts',
  'post-automation': '/posts/automation',
  cards: '/cards',
  media: '/media',
  analytics: '/analytics',
  pricing: '/pricing',
  admin: '/admin/overview',
  profile: '/profile',
  memory: '/memory',
  integrations: '/integrations',
  marketing: '/marketing',
  'marketing-contacts': '/marketing/contacts',
  'marketing-email': '/marketing/email',
  'marketing-campaigns': '/marketing/campaigns',
  'marketing-surveys': '/marketing/surveys',
  'marketing-automations': '/marketing/automations',
  'marketing-forms': '/marketing/forms',
  'crm-companies': '/crm/companies',
  'crm-pipeline': '/crm/pipeline',
  'crm-scoring': '/crm/scoring',
  'gmail-agent': '/crm/gmail-agent',
  'connector-hub': '/connectors',
  'connector-setup': '/connectors/setup',
  'connector-sync': '/connectors/sync',
  workspace: '/workspace',
  billing: '/billing',
  tasks: '/tasks',
  'project-settings': '/project/settings',
  settings: '/settings',
  workflow: '/posts/workflow',
  discover: '/discover',
  'ai-team': '/ai-team',
};

const PATH_TO_PAGE = new Map<string, PageType>(
  Object.entries(PAGE_PATHS).map(([page, path]) => [path, page as PageType])
);
PATH_TO_PAGE.set('/admin', 'admin');
PATH_TO_PAGE.set('/mailing', 'marketing-email');
PATH_TO_PAGE.set('/campaign', 'marketing-campaigns');

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

type AppSidebarProps = {
  currentPage: PageType;
  authUser: AppUser | null;
  postsMenuOpen: boolean;
  setPostsMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  marketingMenuOpen: boolean;
  setMarketingMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  crmMenuOpen: boolean;
  setCrmMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  connectorMenuOpen: boolean;
  setConnectorMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  profileNeedsAttention: boolean;
  navigateToPage: (page: PageType, replace?: boolean) => void;
  handleLogout: () => void;
  onMobileClose?: () => void;
  goTasks: (filter?: string) => void;
  disabledNav: Set<string>;
};

function AppSidebar({
  currentPage,
  authUser,
  postsMenuOpen,
  setPostsMenuOpen,
  marketingMenuOpen,
  setMarketingMenuOpen,
  crmMenuOpen,
  setCrmMenuOpen,
  connectorMenuOpen,
  setConnectorMenuOpen,
  profileNeedsAttention,
  navigateToPage,
  handleLogout,
  onMobileClose,
  goTasks,
  disabledNav,
}: AppSidebarProps) {
  const navOn = (key: string) => authUser?.role === 'admin' || !disabledNav.has(key);
  const { currentOrg, currentProject, projects, refresh } = useWorkspace();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [addingProject, setAddingProject] = useState(false);
  const [newProjectName, setNewProjectName] = useState('');
  const [creatingProject, setCreatingProject] = useState(false);
  const [creatingWorkspace, setCreatingWorkspace] = useState(false);
  const [newWorkspaceName, setNewWorkspaceName] = useState('');
  const [workspaceCreating, setWorkspaceCreating] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const newProjectRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!userMenuOpen) return;
    function handle(e: MouseEvent) {
      if (userMenuRef.current && !userMenuRef.current.contains(e.target as Node)) {
        setUserMenuOpen(false);
      }
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setUserMenuOpen(false);
    }
    document.addEventListener('mousedown', handle);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handle);
      document.removeEventListener('keydown', handleKey);
    };
  }, [userMenuOpen]);

  useEffect(() => {
    if (addingProject) newProjectRef.current?.focus();
  }, [addingProject]);

  // Close add-project input on outside click
  const addProjectContainerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!addingProject) return;
    function handle(e: MouseEvent) {
      if (addProjectContainerRef.current && !addProjectContainerRef.current.contains(e.target as Node)) {
        setAddingProject(false);
        setNewProjectName('');
      }
    }
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [addingProject]);

  const go = (page: PageType) => {
    navigateToPage(page);
    onMobileClose?.();
    setUserMenuOpen(false);
  };

  const createProject = async () => {
    if (!newProjectName.trim() || !currentOrg) return;
    setCreatingProject(true);
    try {
      const token = localStorage.getItem('auth_token');
      await fetch(`${API_BASE_URL}/api/organizations/${currentOrg.id}/projects`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
        body: JSON.stringify({ name: newProjectName.trim(), color: '#6366f1' }),
      });
      await refresh();
      setNewProjectName('');
      setAddingProject(false);
    } finally {
      setCreatingProject(false);
    }
  };

  const createWorkspace = async () => {
    if (!newWorkspaceName.trim()) return;
    setWorkspaceCreating(true);
    try {
      const token = localStorage.getItem('auth_token');
      await fetch(`${API_BASE_URL}/api/organizations`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token ?? ''}` },
        body: JSON.stringify({ name: newWorkspaceName.trim() }),
      });
      await refresh();
      setNewWorkspaceName('');
      setCreatingWorkspace(false);
    } finally {
      setWorkspaceCreating(false);
    }
  };

  const toggleProject = (id: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const wsName = currentOrg?.name ?? 'Workspace';
  const projName = currentProject?.name ?? 'Project';
  const wsInitial = wsName[0].toUpperCase();
  const displayName = currentOrg?.name ?? authUser?.name ?? 'My Workspace';
  const userInitial = displayName[0].toUpperCase();
  const planLabel = authUser?.planName?.trim() || 'Free';
  const isFreePlan = planLabel.toLowerCase() === 'free';

  const cls = (active: boolean) =>
    `flex w-full items-center gap-2.5 border-l-2 py-[7px] pl-4 pr-3 text-[13px] font-medium transition-colors ${
      active
        ? 'border-indigo-600 bg-indigo-50/60 text-indigo-600'
        : 'border-transparent text-gray-500 hover:bg-gray-50 hover:text-gray-800'
    }`;

  const subCls = (active: boolean) =>
    `flex w-full items-center rounded py-[5px] px-3 text-[12px] font-medium transition-colors ${
      active ? 'text-indigo-600' : 'text-gray-400 hover:text-gray-700'
    }`;

  return (
    <div className="flex h-full flex-col bg-white">
      {/* ── Workspace header ── */}
      <div className="px-4 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-indigo-600 text-white text-sm font-black select-none">
            {wsInitial}
          </div>
          <div className="min-w-0">
            <p className="text-[13px] font-bold leading-snug text-gray-900 truncate">{wsName}</p>
            <p className="text-[13px] font-bold leading-snug text-gray-900 truncate">{projName}</p>
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">{authUser?.planName ?? 'Free'} Plan</p>
          </div>
        </div>
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 overflow-y-auto py-2 flex flex-col">

        {/* Dashboard */}
        {navOn('dashboard') && (
          <button type="button" data-tour-id="nav-dashboard" onClick={() => go('dashboard')} className={cls(currentPage === 'dashboard')}>
            <BarChart4 size={15} className="shrink-0" />
            <span className="flex-1 text-left">Dashboard</span>
          </button>
        )}

        {/* Notifications */}
        {navOn('notifications') && (
          <button type="button" onClick={() => go('notifications')} className={cls(currentPage === 'notifications')}>
            <Bell size={15} className="shrink-0" />
            <span className="flex-1 text-left">Notifications</span>
          </button>
        )}

        {/* Content (Posts + Automation + Media + Cards) */}
        {navOn('content') && (
          <>
            <button
              type="button"
              data-tour-id="nav-content"
              onClick={() => { setPostsMenuOpen(true); go('posts'); }}
              className={cls(currentPage === 'posts' || currentPage === 'post-automation' || currentPage === 'media' || currentPage === 'cards' || currentPage === 'workflow')}
            >
              <FileText size={15} className="shrink-0" />
              <span className="flex-1 text-left">Content</span>
              <span
                role="button"
                aria-label="Toggle submenu"
                onClick={(e) => { e.stopPropagation(); setPostsMenuOpen((p) => !p); }}
                className="shrink-0 -m-1 p-1 rounded hover:bg-gray-200/60"
              >
                <ChevronDown size={12} className={`text-gray-400 transition-transform ${postsMenuOpen ? 'rotate-180' : ''}`} />
              </span>
            </button>
            {postsMenuOpen && (
              <div className="ml-[18px] border-l border-gray-100 pl-3 py-0.5 flex flex-col">
                {([
                  { id: 'post-automation' as PageType, label: 'Automation', navKey: 'content-automation' },
                  { id: 'media' as PageType, label: 'Media', navKey: 'content-media' },
                  { id: 'cards' as PageType, label: 'AI Studio', navKey: 'content-studio' },
                  { id: 'workflow' as PageType, label: 'Workflow', navKey: 'content-workflow' },
                ] as { id: PageType; label: string; navKey: string }[]).filter(c => navOn(c.navKey)).map((c) => (
                  <button key={c.id} type="button" onClick={() => go(c.id)} className={subCls(currentPage === c.id)}>
                    {c.label}
                  </button>
                ))}
              </div>
            )}
          </>
        )}

        {/* AI Team */}
        {navOn('ai-team') && (
          <button type="button" onClick={() => go('ai-team')} className={cls(currentPage === 'ai-team')}>
            <Bot size={15} className="shrink-0" />
            <span className="flex-1 text-left">AI Team</span>
          </button>
        )}

        {/* Analytics */}
        {navOn('analytics') && (
          <button type="button" data-tour-id="nav-analytics" onClick={() => go('analytics')} className={cls(currentPage === 'analytics')}>
            <TrendingUp size={15} className="shrink-0" />
            <span className="flex-1 text-left">Analytics</span>
          </button>
        )}

        {/* ── Projects ── */}
        <div className="mt-1">
          <div className="flex items-center border-l-2 border-transparent pl-4 pr-2">
            <span className="flex-1 text-[11px] font-semibold uppercase tracking-widest text-gray-400">Projects</span>
            <button
              type="button"
              title="New project"
              onClick={() => setAddingProject((p) => !p)}
              className="rounded-lg p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-700 transition-colors"
            >
              <Plus size={13} />
            </button>
          </div>

          {/* No org — prompt to create workspace */}
          {!currentOrg && (
            <div className="ml-4 mr-2 mt-1 mb-1">
              {creatingWorkspace ? (
                <div className="flex items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50/40 px-2 py-1.5">
                  <input
                    autoFocus
                    value={newWorkspaceName}
                    onChange={(e) => setNewWorkspaceName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') void createWorkspace(); if (e.key === 'Escape') setCreatingWorkspace(false); }}
                    placeholder="Workspace name…"
                    className="flex-1 bg-transparent text-[12px] text-gray-800 placeholder-gray-400 focus:outline-none"
                  />
                  {workspaceCreating
                    ? <span className="text-indigo-400 text-[10px]">…</span>
                    : <button type="button" onClick={createWorkspace} disabled={!newWorkspaceName.trim()} className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 disabled:opacity-40">Create</button>
                  }
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setCreatingWorkspace(true)}
                  className="w-full rounded-xl border border-dashed border-indigo-200 bg-indigo-50/30 px-3 py-2 text-[11px] font-semibold text-indigo-500 hover:bg-indigo-50 hover:border-indigo-300 transition-colors"
                >
                  + Create your workspace
                </button>
              )}
            </div>
          )}

          {/* Inline new project input */}
          {addingProject && (
            <div ref={addProjectContainerRef} className="ml-4 mr-2 mt-1 mb-1">
              <div className="flex items-center gap-1 rounded-xl border border-indigo-200 bg-indigo-50/40 px-2 py-1.5">
                <input
                  ref={newProjectRef}
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') void createProject(); if (e.key === 'Escape') setAddingProject(false); }}
                  placeholder="Project name…"
                  className="flex-1 bg-transparent text-[12px] text-gray-800 placeholder-gray-400 focus:outline-none"
                />
                {creatingProject
                  ? <span className="text-indigo-400 text-[10px]">…</span>
                  : <button type="button" onClick={createProject} disabled={!newProjectName.trim()} className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800 disabled:opacity-40">Add</button>
                }
              </div>
            </div>
          )}

          {/* Project list */}
          {projects.map((proj) => {
            const isExpanded = expandedProjects.has(proj.id);
            const isCurrent = currentProject?.id === proj.id;
            return (
              <div key={proj.id}>
                <button
                  type="button"
                  onClick={() => { toggleProject(proj.id); }}
                  className={`flex w-full items-center gap-2 border-l-2 py-[6px] pl-5 pr-3 text-[13px] font-medium transition-colors ${
                    isCurrent ? 'border-indigo-400 text-indigo-600' : 'border-transparent text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                  }`}
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: proj.color || '#6366f1' }}
                  />
                  <span className="flex-1 truncate text-left">{proj.name}</span>
                  <ChevronDown size={11} className={`shrink-0 text-gray-400 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                </button>
                {isExpanded && (
                  <div className="ml-[22px] border-l border-gray-100 pl-3 pb-0.5 flex flex-col">
                    <a
                      href={PAGE_PATHS['project-settings']}
                      onClick={(e) => { e.preventDefault(); sessionStorage.removeItem('proj_settings_tab'); go('project-settings'); }}
                      className={`flex w-full items-center rounded py-[5px] px-3 text-[12px] font-medium transition-colors ${currentPage === 'project-settings' && typeof window !== 'undefined' && !window.location.search.includes('tab=team') ? 'text-indigo-600 font-semibold' : 'text-gray-400 hover:text-gray-700'}`}
                    >
                      General
                    </a>
                    <a
                      href={PAGE_PATHS['project-settings']}
                      onClick={(e) => { e.preventDefault(); sessionStorage.setItem('proj_settings_tab', 'team'); go('project-settings'); onMobileClose?.(); }}
                      className={`flex w-full items-center rounded py-[5px] px-3 text-[12px] font-medium transition-colors ${currentPage === 'project-settings' && typeof window !== 'undefined' && window.location.search.includes('tab=team') ? 'text-indigo-600 font-semibold' : 'text-gray-400 hover:text-gray-700'}`}
                    >
                      Team
                    </a>
                    <a
                      href={PAGE_PATHS['tasks']}
                      onClick={(e) => { e.preventDefault(); goTasks('all'); onMobileClose?.(); }}
                      className={`flex w-full items-center rounded py-[5px] px-3 text-[12px] font-medium transition-colors ${currentPage === 'tasks' ? 'text-indigo-600 font-semibold' : 'text-gray-400 hover:text-gray-700'}`}
                    >
                      All Tasks
                    </a>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ── Bottom nav items ── */}
        <div className="mt-2 border-t border-gray-100 pt-2">

          {/* CRM */}
          {navOn('crm') && (
            <>
              <button
                type="button"
                onClick={() => { setCrmMenuOpen(true); go('crm-pipeline'); }}
                className={cls(
                  currentPage === 'crm-companies' ||
                  currentPage === 'crm-pipeline' ||
                  currentPage === 'crm-scoring' ||
                  currentPage === 'gmail-agent'
                )}
              >
                <Building2 size={15} className="shrink-0" />
                <span className="flex-1 text-left">CRM</span>
                <span role="button" aria-label="Toggle submenu" onClick={(e) => { e.stopPropagation(); setCrmMenuOpen((p) => !p); }} className="shrink-0 -m-1 p-1 rounded hover:bg-gray-200/60">
                  <ChevronDown size={12} className={`text-gray-400 transition-transform ${crmMenuOpen ? 'rotate-180' : ''}`} />
                </span>
              </button>
              {crmMenuOpen && (
                <div className="ml-[18px] border-l border-gray-100 pl-3 py-0.5 flex flex-col">
                  {([
                    { id: 'crm-companies' as PageType, label: 'Companies', navKey: 'crm-companies' },
                    { id: 'crm-pipeline' as PageType, label: 'Deals', navKey: 'crm-pipeline' },
                    { id: 'crm-scoring' as PageType, label: 'Lead Scoring', navKey: 'crm-scoring' },
                    { id: 'gmail-agent' as PageType, label: 'Gmail Agent', navKey: 'crm-gmail-agent' },
                  ] as { id: PageType; label: string; navKey: string }[]).filter(c => navOn(c.navKey)).map((c) => (
                    <button key={c.id} type="button" onClick={() => go(c.id)} className={subCls(currentPage === c.id)}>
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {navOn('marketing') && (
            <>
              <button
                type="button"
                data-tour-id="nav-marketing"
                onClick={() => { setMarketingMenuOpen(true); go('marketing'); }}
                className={cls(
                  currentPage === 'marketing' ||
                  currentPage === 'marketing-contacts' ||
                  currentPage === 'marketing-email' ||
                  currentPage === 'marketing-campaigns' ||
                  currentPage === 'marketing-surveys' ||
                  currentPage === 'marketing-automations' ||
                  currentPage === 'marketing-forms'
                )}
              >
                <Megaphone size={15} className="shrink-0" />
                <span className="flex-1 text-left">Marketing</span>
                <span role="button" aria-label="Toggle submenu" onClick={(e) => { e.stopPropagation(); setMarketingMenuOpen((p) => !p); }} className="shrink-0 -m-1 p-1 rounded hover:bg-gray-200/60">
                  <ChevronDown size={12} className={`text-gray-400 transition-transform ${marketingMenuOpen ? 'rotate-180' : ''}`} />
                </span>
              </button>
              {marketingMenuOpen && (
                <div className="ml-[18px] border-l border-gray-100 pl-3 py-0.5 flex flex-col">
                  {([
                    { id: 'marketing' as PageType, label: 'Overview', navKey: 'marketing-overview' },
                    { id: 'marketing-contacts' as PageType, label: 'Contacts', navKey: 'marketing-contacts' },
                    { id: 'marketing-email' as PageType, label: 'Email', navKey: 'marketing-email' },
                    { id: 'marketing-campaigns' as PageType, label: 'Campaigns', navKey: 'marketing-campaigns' },
                    { id: 'marketing-surveys' as PageType, label: 'Surveys', navKey: 'marketing-surveys' },
                    { id: 'marketing-automations' as PageType, label: 'Automations', navKey: 'marketing-automations' },
                    { id: 'marketing-forms' as PageType, label: 'Forms', navKey: 'marketing-forms' },
                  ] as { id: PageType; label: string; navKey: string }[]).filter(c => navOn(c.navKey)).map((c) => (
                    <button key={c.id} type="button" onClick={() => go(c.id)} className={subCls(currentPage === c.id)}>
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {navOn('integrations') && (
            <button type="button" data-tour-id="nav-integrations" onClick={() => go('integrations')} className={cls(currentPage === 'integrations')}>
              <Waypoints size={15} className="shrink-0" />
              <span className="flex-1 text-left">Integrations</span>
            </button>
          )}

          {/* Connectors */}
          {navOn('connectors') && (
            <>
              <button
                type="button"
                onClick={() => { setConnectorMenuOpen(true); go('connector-hub'); }}
                className={cls(
                  currentPage === 'connector-hub' ||
                  currentPage === 'connector-setup' ||
                  currentPage === 'connector-sync'
                )}
              >
                <Layers size={15} className="shrink-0" />
                <span className="flex-1 text-left">Connectors</span>
                <span role="button" aria-label="Toggle submenu" onClick={(e) => { e.stopPropagation(); setConnectorMenuOpen((p) => !p); }} className="shrink-0 -m-1 p-1 rounded hover:bg-gray-200/60">
                  <ChevronDown size={12} className={`text-gray-400 transition-transform ${connectorMenuOpen ? 'rotate-180' : ''}`} />
                </span>
              </button>
              {connectorMenuOpen && (
                <div className="ml-[18px] border-l border-gray-100 pl-3 py-0.5 flex flex-col">
                  {([
                    { id: 'connector-hub' as PageType, label: 'Hub', navKey: 'connectors-hub' },
                    { id: 'connector-sync' as PageType, label: 'Sync Dashboard', navKey: 'connectors-sync' },
                  ] as { id: PageType; label: string; navKey: string }[]).filter(c => navOn(c.navKey)).map((c) => (
                    <button key={c.id} type="button" onClick={() => go(c.id)} className={subCls(currentPage === c.id)}>
                      {c.label}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}

          {navOn('billing') && (
            <button type="button" data-tour-id="nav-billing" onClick={() => go('billing')} className={cls(currentPage === 'billing')}>
              <CreditCard size={15} className="shrink-0" />
              <span className="flex-1 text-left">Billing</span>
            </button>
          )}
        </div>

        {/* Admin */}
        {authUser?.role === 'admin' && (
          <div className="border-t border-gray-100 pt-2 mt-1">
            <button type="button" data-tour-id="nav-admin" onClick={() => go('admin')} className={cls(currentPage === 'admin')}>
              <Shield size={15} className="shrink-0" />
              <span className="flex-1 text-left">Admin</span>
            </button>
          </div>
        )}
      </nav>

      {/* ── Notifications ── */}
      <div className="border-t border-gray-100 px-3 py-2 flex items-center justify-between">
        <span className="text-[11px] font-semibold text-gray-400 uppercase tracking-wide">Notifications</span>
        <NotificationBell />
      </div>

      {helpOpen && <HelpModal onClose={() => setHelpOpen(false)} />}

      {/* ── User card + dropdown ── */}
      <div ref={userMenuRef} className="relative px-3 pb-3 pt-1">
        {userMenuOpen && (
          <div role="menu" className="absolute bottom-full left-0 right-0 mb-1 rounded-2xl border border-gray-200 bg-white py-1.5 shadow-xl z-50 overflow-hidden">
            <div className="flex items-center gap-2.5 px-3.5 py-2.5">
              {authUser?.avatar ? (
                <img src={authUser.avatar} alt="" className="h-7 w-7 shrink-0 rounded-lg object-cover" />
              ) : (
                <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white text-[11px] font-black select-none">
                  {wsInitial}
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-gray-900 truncate">{displayName}</p>
                {authUser?.email
                  ? <p className="text-[10px] text-gray-400 truncate">{authUser.email}</p>
                  : <p className="text-[10px] uppercase tracking-widest text-gray-400">{planLabel} Plan</p>}
              </div>
              <span className="shrink-0 rounded-full bg-indigo-50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-indigo-600">{planLabel}</span>
            </div>
            <div className="mx-3 h-px bg-gray-100" />
            {isFreePlan ? (
              <button type="button" role="menuitem" onClick={() => go('billing')} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-indigo-600 hover:bg-indigo-50 transition-colors">
                <Star size={14} className="shrink-0" /> Upgrade
              </button>
            ) : (
              <button type="button" role="menuitem" onClick={() => go('billing')} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 transition-colors">
                <CreditCard size={14} className="shrink-0 text-gray-400" /> Billing
              </button>
            )}
            <button type="button" role="menuitem" onClick={() => go('memory')} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              <Sparkles size={14} className="shrink-0 text-gray-400" /> Personalization
            </button>
            <button type="button" role="menuitem" onClick={() => go('profile')} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              <User size={14} className="shrink-0 text-gray-400" />
              <span className="flex-1 text-left">Profile</span>
              {profileNeedsAttention && (
                <span className="flex shrink-0 items-center gap-1 text-[10px] font-semibold text-red-500">
                  <AlertCircle size={12} /> Incomplete
                </span>
              )}
            </button>
            <button type="button" role="menuitem" onClick={() => go('workspace')} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              <Building2 size={14} className="shrink-0 text-gray-400" /> Workspace
            </button>
            <button type="button" role="menuitem" onClick={() => go('settings')} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              <Settings size={14} className="shrink-0 text-gray-400" /> Settings
            </button>
            <div className="mx-3 my-1 h-px bg-gray-100" />
            <button type="button" role="menuitem" onClick={() => { window.open('/changelog', '_blank', 'noopener'); setUserMenuOpen(false); }} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              <Rocket size={14} className="shrink-0 text-gray-400" /> What's new
            </button>
            <button type="button" role="menuitem" onClick={() => { setHelpOpen(true); setUserMenuOpen(false); }} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              <HelpCircle size={14} className="shrink-0 text-gray-400" /> Help
            </button>
            <button type="button" role="menuitem" onClick={() => { handleLogout(); setUserMenuOpen(false); }} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-red-600 hover:bg-red-50 transition-colors">
              <LogOut size={14} className="shrink-0" /> Log out
            </button>
          </div>
        )}
        <button
          type="button"
          aria-haspopup="menu"
          aria-expanded={userMenuOpen}
          onClick={() => setUserMenuOpen((v) => !v)}
          className="flex w-full items-center gap-2.5 rounded-xl bg-gray-50 px-3 py-2.5 hover:bg-gray-100 transition-colors"
        >
          <div className="relative h-7 w-7 shrink-0">
            {authUser?.avatar ? (
              <img src={authUser.avatar} alt="" className="h-7 w-7 rounded-full object-cover" />
            ) : (
              <div className="flex h-7 w-7 items-center justify-center rounded-full bg-indigo-600 text-white text-[11px] font-black select-none">
                {userInitial}
              </div>
            )}
            {profileNeedsAttention && (
              <span className="absolute -top-0.5 -right-0.5 h-2 w-2 rounded-full bg-red-500 ring-2 ring-white" />
            )}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p className="text-[12px] font-semibold text-gray-900 leading-tight truncate">{displayName}</p>
            <p className="text-[10px] uppercase tracking-widest text-gray-400 leading-tight">{planLabel} Plan</p>
          </div>
          <ChevronDown size={13} className={`shrink-0 text-gray-400 transition-transform duration-200 ${userMenuOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>
    </div>
  );
}

function App() {
  const { addToast } = useToast();
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authUser, setAuthUser] = useState<AppUser | null>(() => getStoredUser());
  const [currentPage, setCurrentPage] = useState<PageType>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentPathname, setCurrentPathname] = useState(() => (typeof window !== 'undefined' ? window.location.pathname : '/'));
  const [postsMenuOpen, setPostsMenuOpen] = useState(false);
  const [marketingMenuOpen, setMarketingMenuOpen] = useState(false);
  const [crmMenuOpen, setCrmMenuOpen] = useState(false);
  const [connectorMenuOpen, setConnectorMenuOpen] = useState(false);
  const [disabledNav, setDisabledNav] = useState<Set<string>>(new Set());
  const [connectorSetupDomain, setConnectorSetupDomain] = useState<any>(null);
  const [currentTaskFilter, setCurrentTaskFilter] = useState('all');
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [pendingTour, setPendingTour] = useState(false);

  const goTasks = useCallback((filter = 'all') => {
    setCurrentTaskFilter(filter);
    setCurrentPage('tasks');
    const path = '/tasks';
    if (window.location.pathname !== path) {
      window.history.pushState({}, '', path);
      setCurrentPathname(path);
    }
  }, []);

  useEffect(() => {
    // Use localStorage (not sessionStorage) so the flag survives cross-origin
    // OAuth redirects (LinkedIn/Facebook/etc.). sessionStorage is cleared by some
    // browsers (Safari, Firefox strict mode) after navigating to an external domain
    // and back, causing auth_token to be wiped before OAuthCallback can read it.
    const resetFlag = 'force_auth_reset_v8';
    if (localStorage.getItem(resetFlag) === '1') {
      return;
    }

    localStorage.removeItem('auth_session');
    localStorage.removeItem('auth_token');
    clearStoredUser();
    localStorage.setItem(resetFlag, '1');
  }, []);

  const getPageFromPath = useCallback((pathname: string): PageType | null => {
    if (PATH_TO_PAGE.has(pathname)) return PATH_TO_PAGE.get(pathname)!;
    if (pathname.startsWith('/admin')) return 'admin';
    return null;
  }, []);

  const navigatePath = useCallback((path: string, replace = false) => {
    if (replace) {
      window.history.replaceState({}, document.title, path);
      setCurrentPathname(path);
      return;
    }
    window.history.pushState({}, document.title, path);
    setCurrentPathname(path);
  }, []);

  const navigateToPage = useCallback(
    (page: PageType, replace = false) => {
      setCurrentPage(page);
      if (page === 'posts' || page === 'post-automation' || page === 'media' || page === 'cards' || page === 'workflow') {
        setPostsMenuOpen(true);
      }
      if (page === 'marketing' || page === 'marketing-contacts' || page === 'marketing-email' || page === 'marketing-campaigns' || page === 'marketing-surveys' || page === 'marketing-automations') {
        setMarketingMenuOpen(true);
      }
      if (page === 'crm-companies' || page === 'crm-pipeline' || page === 'crm-scoring' || page === 'gmail-agent') {
        setCrmMenuOpen(true);
      }
      if (page === 'connector-hub' || page === 'connector-setup' || page === 'connector-sync') {
        setConnectorMenuOpen(true);
      }
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

  // Global 401 handler — auto-logout when any API call returns Unauthorized
  useEffect(() => {
    if (!isAuthenticated) return;

    const originalFetch = window.fetch.bind(window);
    window.fetch = async (...args) => {
      const response = await originalFetch(...args);
      if (response.status === 401) {
        const url = typeof args[0] === 'string' ? args[0] : args[0] instanceof URL ? args[0].href : '';
        // Only intercept API calls to our backend (not OAuth, external, or best-effort background calls)
        // Exclude media upload — it's fire-and-forget from the builder and shouldn't force logout
        if (url.includes('/api/') && !url.includes('/api/auth/') && !url.includes('/api/media')) {
          localStorage.removeItem('auth_session');
          localStorage.removeItem('auth_token');
          clearStoredUser();
          setAuthUser(null);
          setIsAuthenticated(false);
          addToast('error', 'Your session has expired. Please log in again.');
          navigatePath('/login', true);
        }
      }
      return response;
    };

    return () => {
      window.fetch = originalFetch;
    };
  }, [isAuthenticated, navigatePath]);

  useEffect(() => {
    if (!isAuthenticated) return;
    const token = localStorage.getItem('auth_token') ?? '';
    fetch(`${API_BASE_URL}/api/platform/nav-settings`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : { disabled: [] })
      .then(d => setDisabledNav(new Set(d.disabled ?? [])))
      .catch(() => {});
  }, [isAuthenticated]);

  useEffect(() => {
    let canceled = false;

    const pathname = window.location.pathname;
    if (pathname.startsWith('/auth/')) {
      setCurrentPathname(pathname);
      return () => {
        canceled = true;
      };
    }
    const hasSession = Boolean(localStorage.getItem('auth_session'));
    const token = localStorage.getItem('auth_token');
    if (hasSession && !token) {
      localStorage.removeItem('auth_session');
      clearStoredUser();
    }
    const loggedIn = Boolean(token);
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

    if (!loggedIn) {
      const publicPaths = ['/', '/privacy', '/terms', '/refund', '/login', '/tools', '/pricing', '/changelog', '/data-deletion', '/reset-password', '/verify-email'];
      if (!publicPaths.includes(pathname) && !pathname.startsWith('/invite/')) {
        navigatePath('/login', true);
      }
      return () => {
        canceled = true;
      };
    }

    const pageFromPath = getPageFromPath(pathname);
    if (pageFromPath) {
      setCurrentPage(pageFromPath);
      const contentPages: PageType[] = ['posts', 'post-automation', 'media', 'cards', 'workflow'];
      if (contentPages.includes(pageFromPath)) setPostsMenuOpen(true);
      const marketingPages: PageType[] = ['marketing', 'marketing-contacts', 'marketing-email', 'marketing-campaigns', 'marketing-surveys', 'marketing-automations'];
      if (marketingPages.includes(pageFromPath)) setMarketingMenuOpen(true);
      const crmPages: PageType[] = ['crm-companies', 'crm-pipeline', 'crm-scoring', 'gmail-agent'];
      if (crmPages.includes(pageFromPath)) setCrmMenuOpen(true);
      const connectorPages: PageType[] = ['connector-hub', 'connector-setup', 'connector-sync'];
      if (connectorPages.includes(pageFromPath)) setConnectorMenuOpen(true);
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
      setCurrentPathname(pathname);
      if (pathname.startsWith('/auth/')) {
        return;
      }

      if (!isAuthenticated) {
        const publicPaths = ['/', '/privacy', '/terms', '/refund', '/login', '/tools', '/pricing', '/changelog', '/data-deletion', '/reset-password', '/verify-email'];
        if (!publicPaths.includes(pathname) && !pathname.startsWith('/invite/')) {
          navigatePath('/login', true);
          setCurrentPathname('/login');
        }
        return;
      }

      const pageFromPath = getPageFromPath(pathname);
      if (pageFromPath) {
        setCurrentPage(pageFromPath);
        const contentPages: PageType[] = ['posts', 'post-automation', 'media', 'cards', 'workflow'];
        if (contentPages.includes(pageFromPath)) setPostsMenuOpen(true);
        const marketingPages: PageType[] = ['marketing', 'marketing-contacts', 'marketing-email', 'marketing-campaigns', 'marketing-surveys', 'marketing-automations'];
        if (marketingPages.includes(pageFromPath)) setMarketingMenuOpen(true);
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
    if (!localStorage.getItem('dw_onboarded')) setShowOnboarding(true);
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

  const goToLogin = () => { navigatePath('/login', true); setCurrentPathname('/login'); };
  // Public pages — always accessible regardless of auth state
  if (currentPathname === '/privacy') return <Suspense fallback={<PageFallback />}><PrivacyPolicy /></Suspense>;
  if (currentPathname === '/terms') return <Suspense fallback={<PageFallback />}><TermsOfService /></Suspense>;
  if (currentPathname === '/refund') return <Suspense fallback={<PageFallback />}><RefundPolicy /></Suspense>;
  if (currentPathname === '/tools') return <Suspense fallback={<PageFallback />}><Tools onLoginClick={goToLogin} /></Suspense>;
  if (currentPathname === '/changelog') return <Suspense fallback={<PageFallback />}><Changelog /></Suspense>;
  if (currentPathname === '/data-deletion') return <Suspense fallback={<PageFallback />}><DataDeletion /></Suspense>;
  if (currentPathname.startsWith('/auth/')) return <Suspense fallback={<PageFallback />}><OAuthCallback /></Suspense>;
  if (currentPathname === '/reset-password') return <Suspense fallback={<PageFallback />}><ResetPassword /></Suspense>;
  if (currentPathname === '/verify-email') return <Suspense fallback={<PageFallback />}><VerifyEmail /></Suspense>;
  if (currentPathname.startsWith('/invite/')) {
    const token = currentPathname.replace('/invite/', '');
    return <Suspense fallback={<PageFallback />}><AcceptInvite token={token} onLoginClick={goToLogin} /></Suspense>;
  }
  if (currentPathname === '/pricing' && !isAuthenticated) return <Suspense fallback={<PageFallback />}><PublicPricing onLoginClick={goToLogin} /></Suspense>;
  if (currentPathname.startsWith('/survey/')) {
    const surveyId = currentPathname.replace('/survey/', '');
    return <Suspense fallback={<PageFallback />}><PublicSurvey surveyId={surveyId} /></Suspense>;
  }
  if ((currentPathname === '/' || currentPathname === '') && !isAuthenticated) {
    return <Suspense fallback={<PageFallback />}><Landing onLoginClick={goToLogin} /></Suspense>;
  }

  if (!isAuthenticated) {
    return <Suspense fallback={<PageFallback />}><Auth onLogin={handleLogin} /></Suspense>;
  }

  if (isAuthenticated && currentPage === 'admin' && authUser?.role !== 'admin') {
    navigateToPage('dashboard', true);
    return <Suspense fallback={<PageFallback />}><Dashboard currentUser={authUser} /></Suspense>;
  }

  if (isAuthenticated && currentPage === 'admin') {
    return (
      <TemplateEditorProvider>
        <Suspense fallback={<PageFallback />}><Admin currentUser={authUser} /></Suspense>
        <AdvancedTemplateCardModal />
      </TemplateEditorProvider>
    );
  }

  const profileNeedsAttention = !isProfileComplete(authUser);

  const renderPage = () => {
    switch (currentPage) {
      case 'dashboard': return <Dashboard currentUser={authUser} />;
      case 'posts': return <Posts currentUser={authUser} />;
      case 'post-automation': return <PostAutomation />;
      case 'cards': return <Cards />;
      case 'pricing': return <Pricing />;
      case 'admin': return <Admin currentUser={authUser} />;
      case 'analytics': return <Analytics />;
      case 'profile': return <Profile currentUser={authUser} onUserUpdated={handleUserUpdated} />;
      case 'media': return <Media />;
      case 'integrations': return <Integrations />;
      case 'marketing': return <MarketingOverview navigateToPage={navigateToPage} />;
      case 'marketing-contacts': return <MarketingContacts />;
      case 'marketing-email': return <MarketingEmail />;
      case 'marketing-campaigns': return <MarketingCampaigns />;
      case 'marketing-surveys': return <MarketingSurveys />;
      case 'marketing-automations': return <MarketingAutomations />;
      case 'marketing-forms': return <MarketingForms />;
      case 'crm-companies': return <CRMCompanies />;
      case 'crm-pipeline': return <CRMPipeline />;
      case 'crm-scoring': return <CRMLeadScoring />;
      case 'gmail-agent': return <GmailAgent />;
      case 'connector-hub': return (
        <ConnectorHub
          onNavigateToSetup={(domain) => { setConnectorSetupDomain(domain); navigateToPage('connector-setup'); }}
          onNavigateToSync={() => navigateToPage('connector-sync')}
        />
      );
      case 'connector-setup': return connectorSetupDomain ? (
        <ConnectorProviderSetup
          domain={connectorSetupDomain}
          onBack={() => navigateToPage('connector-hub')}
        />
      ) : <ConnectorHub onNavigateToSetup={(d) => { setConnectorSetupDomain(d); navigateToPage('connector-setup'); }} onNavigateToSync={() => navigateToPage('connector-sync')} />;
      case 'connector-sync': return <ConnectorSyncDashboard onBack={() => navigateToPage('connector-hub')} />;
      case 'workspace': return <Workspace />;
      case 'billing': return <Billing />;
      case 'memory': return <Memory />;
      case 'notifications': return <Notifications />;
      case 'tasks': return <TasksPage initialFilter={currentTaskFilter} />;
      case 'project-settings': return <ProjectSettings />;
      case 'settings': return <SettingsPage currentUser={authUser} onUserUpdated={handleUserUpdated} onNavigateToBilling={() => navigateToPage('billing')} />;
      case 'workflow': return <WorkflowPage />;
      case 'discover': return <Discover />;
      case 'ai-team': return <AITeam />;
      default: return <Dashboard currentUser={authUser} />;
    }
  };

  const sidebarProps: AppSidebarProps = {
    currentPage,
    authUser,
    postsMenuOpen,
    setPostsMenuOpen,
    marketingMenuOpen,
    setMarketingMenuOpen,
    crmMenuOpen,
    setCrmMenuOpen,
    connectorMenuOpen,
    setConnectorMenuOpen,
    profileNeedsAttention,
    navigateToPage,
    handleLogout,
    goTasks,
    disabledNav,
  };

  const guide = PAGE_GUIDES[currentPage];

  return (
    <WorkspaceProvider>
    <TemplateEditorProvider>
      <div className="flex h-screen bg-gray-50">

        {/* Desktop sidebar — fixed width, always visible */}
        <aside className="hidden md:flex w-[220px] shrink-0 flex-col border-r border-gray-100 bg-white">
          <AppSidebar {...sidebarProps} />
        </aside>

        {/* Mobile overlay */}
        {sidebarOpen && (
          <>
            <div
              className="fixed inset-0 z-40 bg-black/30 md:hidden"
              onClick={() => setSidebarOpen(false)}
            />
            <aside className="fixed inset-y-0 left-0 z-50 flex w-[220px] flex-col bg-white shadow-xl md:hidden">
              <AppSidebar {...sidebarProps} onMobileClose={() => setSidebarOpen(false)} />
            </aside>
          </>
        )}

        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Mobile topbar */}
          <header className="flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3 md:hidden">
            <button
              type="button"
              onClick={() => setSidebarOpen((p) => !p)}
              className="rounded-lg p-2 text-gray-500 hover:bg-gray-100"
            >
              <Menu size={20} />
            </button>
            <span className="text-sm font-bold text-gray-900">Dakyworld Hub</span>
            <NotificationBell />
          </header>

          <main className="flex-1 overflow-auto p-5 md:p-7">
            <ErrorBoundary>
              <Suspense fallback={<PageFallback />}>{renderPage()}</Suspense>
            </ErrorBoundary>
          </main>
        </div>
      </div>

      <AdvancedTemplateCardModal />
      <ChatWidget />

      {/* Per-page quick guide */}
      {guide && (
        <PageTour
          key={currentPage}
          steps={guide.steps}
          pageTitle={guide.title}
          forceStart={pendingTour}
          onForceStartConsumed={() => setPendingTour(false)}
        />
      )}

      {/* First-time onboarding wizard (full-screen, shown before tour) */}
      {showOnboarding && (
        <OnboardingWizard
          onNavigate={(page) => navigateToPage(page as any)}
          onComplete={() => { setShowOnboarding(false); setPendingTour(true); }}
          onDismiss={() => setShowOnboarding(false)}
        />
      )}

    </TemplateEditorProvider>
    </WorkspaceProvider>
  );
}

function AppWithToast() {
  const toastState = useToastState();
  return (
    <ToastContext.Provider value={toastState}>
      <App />
      <ToastContainer />
    </ToastContext.Provider>
  );
}

export default AppWithToast;
