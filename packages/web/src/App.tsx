import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  BarChart4,
  Bell,
  CheckCircle2,
  ChevronDown,
  CreditCard,
  FileText,
  HelpCircle,
  LogOut,
  Mail,
  Megaphone,
  Menu,
  Plus,
  Shield,
  Sparkles,
  Star,
  TrendingUp,
  User,
  Waypoints,
  Settings,
} from 'lucide-react';
import Dashboard from './pages/Dashboard';
import NotificationBell from './components/NotificationBell';
import OnboardingWizard from './components/OnboardingWizard';
import PageTour, { PAGE_GUIDES } from './components/PageTour';
import Posts from './pages/Posts';
import Cards from './pages/Cards';
import Admin from './pages/Admin';
import Analytics from './pages/Analytics';
import Pricing from './pages/Pricing';
import Profile from './pages/Profile';
import Media from './pages/Media';
import Integrations from './pages/Integrations';
import Auth from './pages/Auth';
import PrivacyPolicy from './pages/PrivacyPolicy';
import TermsOfService from './pages/TermsOfService';
import Landing from './pages/Landing';
import Tools from './pages/Tools';
import PublicPricing from './pages/PublicPricing';
import DataDeletion from './pages/DataDeletion';
import OAuthCallback from './pages/OAuthCallback';
import ChatWidget from './components/ChatWidget';
import PostAutomation from './pages/PostAutomation';
import Mailing from './pages/Mailing';
import Campaign from './pages/Campaign';
import Workspace from './pages/Workspace';
import AcceptInvite from './pages/AcceptInvite';
import Billing from './pages/Billing';
import Memory from './pages/Memory';
import Notifications from './pages/Notifications';
import TasksPage from './components/tasks/TasksPage';
import ProjectSettings from './pages/ProjectSettings';
import AdvancedTemplateCardModal from './components/AdvancedTemplateCardModal';
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

type PageType =
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
  | 'mailing'
  | 'campaign'
  | 'workspace'
  | 'billing'
  | 'pricing'
  | 'tasks'
  | 'project-settings';

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
  admin: '/admin/users',
  profile: '/profile',
  memory: '/memory',
  integrations: '/integrations',
  mailing: '/mailing',
  campaign: '/campaign',
  workspace: '/workspace',
  billing: '/billing',
  tasks: '/tasks',
  'project-settings': '/project/settings',
};

const PATH_TO_PAGE = new Map<string, PageType>(
  Object.entries(PAGE_PATHS).map(([page, path]) => [path, page as PageType])
);
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

type AppSidebarProps = {
  currentPage: PageType;
  authUser: AppUser | null;
  postsMenuOpen: boolean;
  setPostsMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
  profileNeedsAttention: boolean;
  navigateToPage: (page: PageType, replace?: boolean) => void;
  handleLogout: () => void;
  onMobileClose?: () => void;
  goTasks: (filter?: string) => void;
};

function AppSidebar({
  currentPage,
  authUser,
  postsMenuOpen,
  setPostsMenuOpen,
  profileNeedsAttention,
  navigateToPage,
  handleLogout,
  onMobileClose,
  goTasks,
}: AppSidebarProps) {
  const { currentOrg, currentProject, projects, refresh } = useWorkspace();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
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
    document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
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
      await fetch(`${(import.meta as any).env?.VITE_API_URL ?? ''}/api/organizations/${currentOrg.id}/projects`, {
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
      await fetch(`${(import.meta as any).env?.VITE_API_URL ?? ''}/api/organizations`, {
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
            <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-widest text-gray-400">Free Plan</p>
          </div>
        </div>
      </div>

      {/* ── Nav ── */}
      <nav className="flex-1 overflow-y-auto py-2 flex flex-col">

        {/* Dashboard */}
        <button type="button" onClick={() => go('dashboard')} className={cls(currentPage === 'dashboard')}>
          <BarChart4 size={15} className="shrink-0" />
          <span className="flex-1 text-left">Dashboard</span>
        </button>

        {/* Notifications */}
        <button type="button" onClick={() => go('notifications')} className={cls(currentPage === 'notifications')}>
          <Bell size={15} className="shrink-0" />
          <span className="flex-1 text-left">Notifications</span>
        </button>

        {/* Content (Posts + Automation + Media + Cards) */}
        <button
          type="button"
          onClick={() => { setPostsMenuOpen((p) => !p); go('posts'); }}
          className={cls(currentPage === 'posts' || currentPage === 'post-automation' || currentPage === 'media' || currentPage === 'cards')}
        >
          <FileText size={15} className="shrink-0" />
          <span className="flex-1 text-left">Content</span>
          <ChevronDown size={12} className={`shrink-0 text-gray-400 transition-transform ${postsMenuOpen ? 'rotate-180' : ''}`} />
        </button>
        {postsMenuOpen && (
          <div className="ml-[18px] border-l border-gray-100 pl-3 py-0.5 flex flex-col">
            {([
              { id: 'post-automation' as PageType, label: 'Automation' },
              { id: 'media' as PageType, label: 'Media' },
              { id: 'cards' as PageType, label: 'Cards' },
            ] as { id: PageType; label: string }[]).map((c) => (
              <button key={c.id} type="button" onClick={() => go(c.id)} className={subCls(currentPage === c.id)}>
                {c.label}
              </button>
            ))}
          </div>
        )}

        {/* Analytics */}
        <button type="button" onClick={() => go('analytics')} className={cls(currentPage === 'analytics')}>
          <TrendingUp size={15} className="shrink-0" />
          <span className="flex-1 text-left">Analytics</span>
        </button>

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
          <button type="button" onClick={() => go('mailing')} className={cls(currentPage === 'mailing')}>
            <Mail size={15} className="shrink-0" />
            <span className="flex-1 text-left">Mailing</span>
          </button>
          <button type="button" onClick={() => go('campaign')} className={cls(currentPage === 'campaign')}>
            <Megaphone size={15} className="shrink-0" />
            <span className="flex-1 text-left">Campaigns</span>
          </button>
          <button type="button" onClick={() => go('integrations')} className={cls(currentPage === 'integrations')}>
            <Waypoints size={15} className="shrink-0" />
            <span className="flex-1 text-left">Integrations</span>
          </button>
          <button type="button" onClick={() => go('billing')} className={cls(currentPage === 'billing')}>
            <CreditCard size={15} className="shrink-0" />
            <span className="flex-1 text-left">Billing</span>
          </button>
        </div>

        {/* Admin */}
        {authUser?.role === 'admin' && (
          <div className="border-t border-gray-100 pt-2 mt-1">
            <button type="button" onClick={() => go('admin')} className={cls(currentPage === 'admin')}>
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

      {/* ── Settings ── */}
      <div className="border-t border-gray-100">
        <button type="button" onClick={() => go('profile')} className={cls(currentPage === 'profile')}>
          <Settings size={15} className="shrink-0" />
          <span className="flex-1 text-left">Settings</span>
          {profileNeedsAttention && <AlertCircle size={12} className="text-red-500 shrink-0" />}
        </button>
      </div>

      {/* ── User card + dropdown ── */}
      <div ref={userMenuRef} className="relative px-3 pb-3 pt-1">
        {userMenuOpen && (
          <div className="absolute bottom-full left-0 right-0 mb-1 rounded-2xl border border-gray-200 bg-white py-1.5 shadow-xl z-50 overflow-hidden">
            <div className="flex items-center gap-2.5 px-3.5 py-2.5">
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white text-[11px] font-black select-none">
                {wsInitial}
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[12px] font-semibold text-gray-900 truncate">{displayName}</p>
                <p className="text-[10px] uppercase tracking-widest text-gray-400">Free Plan</p>
              </div>
              <CheckCircle2 size={13} className="text-indigo-500 shrink-0" />
            </div>
            <div className="mx-3 h-px bg-gray-100" />
            <button type="button" onClick={() => go('billing')} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-indigo-600 hover:bg-indigo-50 transition-colors">
              <Star size={14} className="shrink-0" /> Upgrade
            </button>
            <button type="button" onClick={() => go('memory')} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              <Sparkles size={14} className="shrink-0 text-gray-400" /> Personalization
            </button>
            <button type="button" onClick={() => go('profile')} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              <User size={14} className="shrink-0 text-gray-400" /> Profile
            </button>
            <button type="button" onClick={() => go('profile')} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              <Settings size={14} className="shrink-0 text-gray-400" /> Settings
            </button>
            <div className="mx-3 my-1 h-px bg-gray-100" />
            <button type="button" className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-gray-700 hover:bg-gray-50 transition-colors">
              <HelpCircle size={14} className="shrink-0 text-gray-400" /> Help
            </button>
            <button type="button" onClick={() => { handleLogout(); setUserMenuOpen(false); }} className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-[13px] font-medium text-red-600 hover:bg-red-50 transition-colors">
              <LogOut size={14} className="shrink-0" /> Log out
            </button>
          </div>
        )}
        <button
          type="button"
          onClick={() => setUserMenuOpen((v) => !v)}
          className="flex w-full items-center gap-2.5 rounded-xl bg-gray-50 px-3 py-2.5 hover:bg-gray-100 transition-colors"
        >
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-indigo-600 text-white text-[11px] font-black select-none">
            {userInitial}
          </div>
          <div className="min-w-0 flex-1 text-left">
            <p className="text-[12px] font-semibold text-gray-900 leading-tight truncate">{displayName}</p>
            <p className="text-[10px] uppercase tracking-widest text-gray-400 leading-tight">Free Plan</p>
          </div>
          <ChevronDown size={13} className={`shrink-0 text-gray-400 transition-transform duration-200 ${userMenuOpen ? 'rotate-180' : ''}`} />
        </button>
      </div>
    </div>
  );
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [authUser, setAuthUser] = useState<AppUser | null>(() => getStoredUser());
  const [currentPage, setCurrentPage] = useState<PageType>('dashboard');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [currentPathname, setCurrentPathname] = useState(() => (typeof window !== 'undefined' ? window.location.pathname : '/'));
  const [postsMenuOpen, setPostsMenuOpen] = useState(false);
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
      if (page === 'posts' || page === 'post-automation') {
        setPostsMenuOpen(true);
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
      const publicPaths = ['/', '/privacy', '/terms', '/login', '/tools', '/pricing', '/data-deletion'];
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
      if (pageFromPath === 'posts' || pageFromPath === 'post-automation') {
        setPostsMenuOpen(true);
      }
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
        const publicPaths = ['/', '/privacy', '/terms', '/login', '/tools', '/pricing', '/data-deletion'];
        if (!publicPaths.includes(pathname) && !pathname.startsWith('/invite/')) {
          navigatePath('/login', true);
          setCurrentPathname('/login');
        }
        return;
      }

      const pageFromPath = getPageFromPath(pathname);
      if (pageFromPath) {
        setCurrentPage(pageFromPath);
        if (pageFromPath === 'posts' || pageFromPath === 'post-automation') {
          setPostsMenuOpen(true);
        }
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
  if (currentPathname === '/privacy') return <PrivacyPolicy />;
  if (currentPathname === '/terms') return <TermsOfService />;
  if (currentPathname === '/tools') return <Tools onLoginClick={goToLogin} />;
  if (currentPathname === '/data-deletion') return <DataDeletion />;
  if (currentPathname.startsWith('/auth/')) return <OAuthCallback />;
  if (currentPathname.startsWith('/invite/')) {
    const token = currentPathname.replace('/invite/', '');
    return <AcceptInvite token={token} onLoginClick={goToLogin} />;
  }
  if (currentPathname === '/pricing' && !isAuthenticated) return <PublicPricing onLoginClick={goToLogin} />;
  if ((currentPathname === '/' || currentPathname === '') && !isAuthenticated) {
    return <Landing onLoginClick={goToLogin} />;
  }

  if (!isAuthenticated) {
    return <Auth onLogin={handleLogin} />;
  }

  if (isAuthenticated && currentPage === 'admin' && authUser?.role !== 'admin') {
    navigateToPage('dashboard', true);
    return <Dashboard currentUser={authUser} />;
  }

  if (isAuthenticated && currentPage === 'admin') {
    return (
      <TemplateEditorProvider>
        <Admin currentUser={authUser} />
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
      case 'mailing': return <Mailing />;
      case 'campaign': return <Campaign />;
      case 'workspace': return <Workspace />;
      case 'billing': return <Billing />;
      case 'memory': return <Memory />;
      case 'notifications': return <Notifications />;
      case 'tasks': return <TasksPage initialFilter={currentTaskFilter} />;
      case 'project-settings': return <ProjectSettings />;
      default: return <Dashboard currentUser={authUser} />;
    }
  };

  const sidebarProps: AppSidebarProps = {
    currentPage,
    authUser,
    postsMenuOpen,
    setPostsMenuOpen,
    profileNeedsAttention,
    navigateToPage,
    handleLogout,
    goTasks,
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

          <main className="flex-1 overflow-auto p-5 md:p-7">{renderPage()}</main>
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

export default App;
