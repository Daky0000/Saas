import React, { useState, useEffect, useCallback } from 'react';
import {
  AlertCircle,
  CheckCircle,
  Loader,
  Plus,
  X,
  LogOut,
  RefreshCw,
  Settings,
  Clock,
  AlertTriangle,
  Zap,
  Globe,
} from 'lucide-react';
import { useConnectedAccounts, useOAuthConnect } from '../hooks/useOAuth';
import { SocialPlatform, ConnectedAccount, AutoPostingConfig, ContentVariation, RepostingSchedule, ErrorLog } from '../types/oauth';
import { wordpressService } from '../services/wordpressService';

interface Notification {
  id: string;
  type: 'success' | 'error';
  message: string;
}

interface ConnectionModalState {
  isOpen: boolean;
  platform: SocialPlatform | null;
}

const PLATFORMS: SocialPlatform[] = ['Instagram', 'Twitter', 'LinkedIn', 'Facebook', 'TikTok'];

const PLATFORM_COLORS: Record<SocialPlatform, string> = {
  Instagram: 'from-pink-500 to-purple-500',
  Twitter: 'from-blue-400 to-blue-600',
  LinkedIn: 'from-blue-600 to-blue-800',
  Facebook: 'from-blue-500 to-blue-700',
  TikTok: 'from-gray-900 to-pink-600',
};

const PLATFORM_ICONS: Record<SocialPlatform, string> = {
  Instagram: '📷',
  Twitter: '𝕏',
  LinkedIn: '💼',
  Facebook: 'f',
  TikTok: '♪',
};

export const Connects: React.FC = () => {
  const [activeTab, setActiveTab] = useState('accounts');
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [modalState, setModalState] = useState<ConnectionModalState>({
    isOpen: false,
    platform: null,
  });

  // WordPress connection state
  const [wpConnected, setWpConnected] = useState(false);
  const [wpSiteUrl, setWpSiteUrl] = useState<string | null>(null);
  const [wpModalOpen, setWpModalOpen] = useState(false);
  const [wpConnecting, setWpConnecting] = useState(false);
  const [wpConnectError, setWpConnectError] = useState<string | null>(null);
  const [wpForm, setWpForm] = useState({ siteUrl: '', username: '', password: '', applicationPassword: '', webhookUrl: '' });
  const [wpModalTab, setWpModalTab] = useState<'make' | 'wordpress_api'>('make');
  const [wpConnectionType, setWpConnectionType] = useState<'make_webhook' | 'wordpress_api' | null>(null);
  const [wpStatusLoading, setWpStatusLoading] = useState(true);

  const { accounts, loading, error, refetch, disconnect } = useConnectedAccounts();
  const [autoPostingConfigs, setAutoPostingConfigs] = useState<AutoPostingConfig[]>([]);
  const [contentVariations, setContentVariations] = useState<ContentVariation[]>([]);
  const [repostingSchedules, setRepostingSchedules] = useState<RepostingSchedule[]>([]);
  const [errorLogs, setErrorLogs] = useState<ErrorLog[]>([]);

  // Fetch WordPress connection status
  const fetchWpStatus = useCallback(async () => {
    setWpStatusLoading(true);
    const result = await wordpressService.getStatus();
    setWpStatusLoading(false);
    if (result.success) {
      setWpConnected(!!result.connected);
      setWpSiteUrl(result.siteUrl ?? null);
      setWpConnectionType(result.connectionType ?? null);
    }
  }, []);

  useEffect(() => {
    fetchWpStatus();
  }, [fetchWpStatus]);

  // Handle OAuth callbacks from URL params
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const success = params.get('success');
    const errorMsg = params.get('error');

    if (success === 'true') {
      addNotification('Successfully connected account!', 'success');
      refetch();
      window.history.replaceState({}, document.title, window.location.pathname);
    }

    if (errorMsg) {
      addNotification(`Connection failed: ${decodeURIComponent(errorMsg)}`, 'error');
      window.history.replaceState({}, document.title, window.location.pathname);
    }
  }, [refetch]);

  // Load mock data
  useEffect(() => {
    // Mock auto posting configs
    setAutoPostingConfigs([
      {
        id: '1',
        platform: 'Instagram',
        enabled: true,
        carbonCopy: 'Keep it original',
        format: 'Standard',
        autoHashtags: true,
        maxLength: 2200,
      },
      {
        id: '2',
        platform: 'Twitter',
        enabled: true,
        carbonCopy: 'Adapt for platform',
        format: 'Thread',
        autoHashtags: false,
        maxLength: 280,
      },
      {
        id: '3',
        platform: 'LinkedIn',
        enabled: false,
        carbonCopy: 'Professional tone',
        format: 'Article',
        autoHashtags: true,
        maxLength: 3000,
      },
    ]);

    // Mock content variations
    setContentVariations([
      {
        platform: 'Instagram',
        type: 'Image Caption',
        format: 'Emoji-rich, conversational',
        adaptations: ['Add emojis', 'Use hashtags', 'Include call-to-action'],
      },
      {
        platform: 'Twitter',
        type: 'Tweet',
        format: 'Concise, engaging',
        adaptations: ['Thread format', 'Quote format', 'Reply chains'],
      },
      {
        platform: 'LinkedIn',
        type: 'Post',
        format: 'Professional, thought-leadership',
        adaptations: ['Article link', 'Professional insights', 'Industry updates'],
      },
    ]);

    // Mock reposting schedules
    setRepostingSchedules([
      {
        id: '1',
        title: 'Morning Boost',
        frequency: 'Daily at 9 AM',
        platforms: ['Instagram', 'Twitter', 'LinkedIn'],
        lastRepost: '2026-03-04 09:00',
        nextRepost: '2026-03-05 09:00',
        performance: 'Excellent',
      },
      {
        id: '2',
        title: 'Evening Engagement',
        frequency: 'Daily at 6 PM',
        platforms: ['Instagram', 'Facebook'],
        lastRepost: '2026-03-03 18:00',
        nextRepost: '2026-03-04 18:00',
        performance: 'Good',
      },
    ]);

    // Mock error logs
    setErrorLogs([
      {
        id: '1',
        timestamp: '2026-03-04 14:23',
        platform: 'Twitter',
        error: 'Rate limit exceeded',
        type: 'rate-limit',
        status: 'active',
      },
      {
        id: '2',
        timestamp: '2026-03-03 10:15',
        platform: 'Instagram',
        error: 'Token expired, please reauthorize',
        type: 'auth',
        status: 'resolved',
      },
    ]);
  }, []);

  const addNotification = useCallback((message: string, type: 'success' | 'error') => {
    const id = Math.random().toString(36).substring(7);
    setNotifications((prev) => [...prev, { id, type, message }]);

    setTimeout(() => {
      setNotifications((prev) => prev.filter((n) => n.id !== id));
    }, 4000);
  }, []);

  const handleConnect = useCallback((platform: SocialPlatform) => {
    setModalState({ isOpen: true, platform });
  }, []);

  const handleDisconnect = useCallback(
    async (platform: SocialPlatform) => {
      const result = await disconnect(platform);
      if (result.success) {
        addNotification(`Disconnected from ${platform}`, 'success');
      } else {
        addNotification(`Failed to disconnect from ${platform}`, 'error');
      }
    },
    [disconnect, addNotification]
  );

  const handleConnectWordPress = useCallback(async () => {
    setWpConnectError(null);
    if (wpModalTab === 'make') {
      const url = wpForm.webhookUrl.trim();
      if (!url || (!url.startsWith('https://') && !url.startsWith('http://'))) {
        setWpConnectError('Enter a valid Make webhook URL (https:// or http://).');
        return;
      }
      setWpConnecting(true);
      const result = await wordpressService.connectWebhook(url);
      setWpConnecting(false);
      if (result.success) {
        addNotification(result.message || 'WordPress (Make) connected successfully', 'success');
        setWpModalOpen(false);
        setWpForm((f) => ({ ...f, webhookUrl: '' }));
        fetchWpStatus();
      } else {
        setWpConnectError(result.error || 'Connection failed');
      }
      return;
    }
    if (!wpForm.siteUrl.trim() || !wpForm.username.trim()) {
      setWpConnectError('Site URL and Username are required.');
      return;
    }
    if (!wpForm.password.trim() && !wpForm.applicationPassword.trim()) {
      setWpConnectError('Enter your WordPress login password or an Application Password.');
      return;
    }
    setWpConnecting(true);
    const result = await wordpressService.connect({
      siteUrl: wpForm.siteUrl.trim(),
      username: wpForm.username.trim(),
      password: wpForm.password.trim() || undefined,
      applicationPassword: wpForm.applicationPassword.trim() || undefined,
    });
    setWpConnecting(false);
    if (result.success) {
      addNotification(result.message || 'WordPress Connected Successfully', 'success');
      setWpModalOpen(false);
      setWpForm({ siteUrl: '', username: '', password: '', applicationPassword: '', webhookUrl: '' });
      fetchWpStatus();
    } else {
      setWpConnectError(result.error || 'Connection failed');
    }
  }, [wpModalTab, wpForm, addNotification, fetchWpStatus]);

  const handleDisconnectWordPress = useCallback(async () => {
    const result = await wordpressService.disconnect();
    if (result.success) {
      addNotification('WordPress disconnected', 'success');
      setWpConnected(false);
      setWpSiteUrl(null);
    } else {
      addNotification(result.error || 'Failed to disconnect', 'error');
    }
  }, [addNotification]);

  const handleConfirmConnection = useCallback(
    async (platform: SocialPlatform | null) => {
      if (platform) {
        const { connect } = useOAuthConnect(platform);
        try {
          await connect();
        } catch (err) {
          addNotification('Failed to initiate connection', 'error');
        }
      }
      setModalState({ isOpen: false, platform: null });
    },
    [addNotification]
  );

  const getConnectedAccount = (platform: SocialPlatform): ConnectedAccount | undefined => {
    return accounts.find((acc) => acc.platform === platform);
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-gray-50 to-gray-100 p-6">
      {/* Header */}
      <div className="max-w-6xl mx-auto mb-8">
        <h1 className="text-4xl font-bold text-gray-900 mb-2">Connected Accounts</h1>
        <p className="text-gray-600">
          Manage your social media connections, configure auto-posting, and monitor account activity.
        </p>
      </div>

      {/* Notifications */}
      <div className="fixed top-4 right-4 z-50 space-y-2">
        {notifications.map((notif) => (
          <div
            key={notif.id}
            className={`flex items-center gap-3 px-4 py-3 rounded-lg shadow-lg text-white ${
              notif.type === 'success' ? 'bg-green-500' : 'bg-red-500'
            }`}
          >
            {notif.type === 'success' ? (
              <CheckCircle size={20} />
            ) : (
              <AlertCircle size={20} />
            )}
            <span>{notif.message}</span>
            <button
              onClick={() =>
                setNotifications((prev) => prev.filter((n) => n.id !== notif.id))
              }
              className="ml-2 hover:opacity-80"
            >
              <X size={16} />
            </button>
          </div>
        ))}
      </div>

      {/* Main Content */}
      <div className="max-w-6xl mx-auto">
        {/* Tabs */}
        <div className="mb-8 flex gap-2 border-b border-gray-300 bg-white rounded-t-lg p-1 overflow-x-auto">
          {['accounts', 'auto-posting', 'variations', 'reposting', 'errors'].map((tab) => (
            <button
              key={tab}
              onClick={() => setActiveTab(tab)}
              className={`px-4 py-3 font-medium whitespace-nowrap border-b-2 transition-colors ${
                activeTab === tab
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-gray-600 hover:text-gray-900'
              }`}
            >
              {tab === 'accounts' && 'OAuth & Accounts'}
              {tab === 'auto-posting' && 'Auto Posting'}
              {tab === 'variations' && 'Variations'}
              {tab === 'reposting' && 'Auto Reposting'}
              {tab === 'errors' && 'Error Handling'}
            </button>
          ))}
        </div>

        {/* OAuth & Accounts Tab */}
        {activeTab === 'accounts' && (
          <div className="space-y-6">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {PLATFORMS.map((platform) => {
                const connected = getConnectedAccount(platform);
                return (
                  <div
                    key={platform}
                    className="bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow"
                  >
                    <div
                      className={`h-24 bg-gradient-to-r ${PLATFORM_COLORS[platform]} flex items-center justify-center text-white text-4xl`}
                    >
                      {PLATFORM_ICONS[platform]}
                    </div>

                    <div className="p-4">
                      <h3 className="text-lg font-semibold text-gray-900 mb-2">
                        {platform}
                      </h3>

                      {loading && !connected ? (
                        <div className="flex items-center gap-2 text-gray-600 mb-4">
                          <Loader size={16} className="animate-spin" />
                          <span className="text-sm">Loading...</span>
                        </div>
                      ) : connected ? (
                        <div className="mb-4">
                          <div className="flex items-center gap-2 text-green-600 mb-2">
                            <CheckCircle size={16} />
                            <span className="text-sm font-medium">Connected</span>
                          </div>
                          <div className="space-y-1 text-sm">
                            <p className="text-gray-700">
                              <span className="font-medium">Handle:</span> @{connected.handle}
                            </p>
                            <p className="text-gray-700">
                              <span className="font-medium">Followers:</span> {connected.followers}
                            </p>
                            {connected.expiresAt && (
                              <p className="text-gray-700">
                                <span className="font-medium">Token Expires:</span> {connected.expiresAt}
                              </p>
                            )}
                          </div>
                        </div>
                      ) : (
                        <div className="bg-gray-50 rounded p-2 mb-4">
                          <p className="text-sm text-gray-600">
                            Not connected. Click Connect to link your {platform} account.
                          </p>
                        </div>
                      )}

                      <div className="flex gap-2">
                        {!connected ? (
                          <button
                            onClick={() => handleConnect(platform)}
                            className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                          >
                            <Plus size={16} />
                            Connect
                          </button>
                        ) : (
                          <>
                            <button
                              onClick={() => handleConnect(platform)}
                              className="flex-1 flex items-center justify-center gap-2 bg-orange-500 hover:bg-orange-600 text-white font-medium py-2 px-4 rounded-lg transition-colors text-sm"
                            >
                              <RefreshCw size={16} />
                              Reauth
                            </button>
                            <button
                              onClick={() => handleDisconnect(platform)}
                              className="flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 font-medium py-2 px-4 rounded-lg transition-colors"
                            >
                              <LogOut size={16} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* WordPress connection card */}
            <div className="mt-8">
              <h3 className="text-lg font-semibold text-gray-900 mb-4">WordPress</h3>
              <div className="bg-white rounded-lg border border-gray-200 overflow-hidden hover:shadow-lg transition-shadow max-w-sm">
                <div className="h-24 bg-gradient-to-r from-blue-600 to-indigo-600 flex items-center justify-center text-white">
                  <Globe size={40} />
                </div>
                <div className="p-4">
                  <h3 className="text-lg font-semibold text-gray-900 mb-2">WordPress</h3>
                  {wpStatusLoading ? (
                    <div className="flex items-center gap-2 text-gray-600 mb-4">
                      <Loader size={16} className="animate-spin" />
                      <span className="text-sm">Loading...</span>
                    </div>
                  ) : wpConnected ? (
                    <div className="mb-4">
                      <div className="flex items-center gap-2 text-green-600 mb-2">
                        <CheckCircle size={16} />
                        <span className="text-sm font-medium">Connected</span>
                        {wpConnectionType === 'make_webhook' && (
                          <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded">Make</span>
                        )}
                      </div>
                      {wpSiteUrl && wpConnectionType === 'wordpress_api' && (
                        <p className="text-sm text-gray-700 truncate" title={wpSiteUrl}>
                          <span className="font-medium">Site:</span> {wpSiteUrl}
                        </p>
                      )}
                      {wpConnectionType === 'make_webhook' && (
                        <p className="text-sm text-gray-600">Publishing via Make webhook</p>
                      )}
                    </div>
                  ) : (
                    <div className="bg-red-50 border border-red-100 rounded p-2 mb-4">
                      <div className="flex items-center gap-2 text-red-600 mb-1">
                        <span className="w-2 h-2 rounded-full bg-red-500" aria-hidden />
                        <span className="text-sm font-medium">Not connected</span>
                      </div>
                      <p className="text-sm text-gray-600">
                        Click Connect to link your WordPress site via Application Password.
                      </p>
                    </div>
                  )}
                  <div className="flex gap-2">
                    {!wpConnected ? (
                      <button
                        onClick={() => {
                          setWpConnectError(null);
                          setWpForm((f) => ({ ...f, siteUrl: '', username: '', password: '', applicationPassword: '', webhookUrl: '' }));
                          setWpModalOpen(true);
                        }}
                        className="flex-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-700 text-white font-medium py-2 px-4 rounded-lg transition-colors"
                      >
                        <Plus size={16} />
                        Connect WordPress
                      </button>
                    ) : (
                      <button
                        onClick={handleDisconnectWordPress}
                        className="flex items-center justify-center gap-2 bg-red-50 hover:bg-red-100 text-red-600 font-medium py-2 px-4 rounded-lg transition-colors"
                      >
                        <LogOut size={16} />
                        Disconnect
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 rounded-lg p-4 flex items-gap-3">
                <AlertCircle className="text-red-600 flex-shrink-0" size={20} />
                <p className="text-red-800">{error}</p>
              </div>
            )}
          </div>
        )}

        {/* Auto Posting Tab */}
        {activeTab === 'auto-posting' && (
          <div className="space-y-6">
            <div className="grid gap-4">
              {autoPostingConfigs.map((config) => (
                <div
                  key={config.id}
                  className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-lg transition-shadow"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div className="flex items-center gap-3">
                      <div className="flex items-center justify-center w-12 h-12 bg-blue-100 rounded-lg text-blue-600 text-xl">
                        {PLATFORM_ICONS[config.platform]}
                      </div>
                      <div>
                        <h3 className="text-lg font-semibold text-gray-900">
                          {config.platform}
                        </h3>
                        <p className="text-sm text-gray-600">
                          {config.enabled ? '✓ Enabled' : '✗ Disabled'}
                        </p>
                      </div>
                    </div>
                    <button className="p-2 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                      <Settings size={20} />
                    </button>
                  </div>

                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="bg-gray-50 rounded p-3">
                      <p className="text-xs text-gray-600 font-medium mb-1">Content Copy</p>
                      <p className="text-sm font-semibold text-gray-900">{config.carbonCopy}</p>
                    </div>
                    <div className="bg-gray-50 rounded p-3">
                      <p className="text-xs text-gray-600 font-medium mb-1">Format</p>
                      <p className="text-sm font-semibold text-gray-900">{config.format}</p>
                    </div>
                    <div className="bg-gray-50 rounded p-3">
                      <p className="text-xs text-gray-600 font-medium mb-1">Max Length</p>
                      <p className="text-sm font-semibold text-gray-900">{config.maxLength}</p>
                    </div>
                    <div className="bg-gray-50 rounded p-3">
                      <p className="text-xs text-gray-600 font-medium mb-1">Auto Hashtags</p>
                      <p className="text-sm font-semibold text-gray-900">
                        {config.autoHashtags ? '✓ Yes' : '✗ No'}
                      </p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Content Variations Tab */}
        {activeTab === 'variations' && (
          <div className="space-y-6">
            <div className="grid gap-4">
              {contentVariations.map((variation, idx) => (
                <div
                  key={idx}
                  className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-lg transition-shadow"
                >
                  <div className="flex items-center gap-3 mb-4">
                    <div className="flex items-center justify-center w-10 h-10 bg-purple-100 rounded-lg text-purple-600 text-lg">
                      {PLATFORM_ICONS[variation.platform]}
                    </div>
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {variation.platform}
                      </h3>
                      <p className="text-sm text-gray-600">{variation.type}</p>
                    </div>
                  </div>

                  <div className="bg-purple-50 rounded p-4 mb-4">
                    <p className="text-sm font-medium text-gray-700 mb-2">Format Style:</p>
                    <p className="text-sm text-gray-900">{variation.format}</p>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-3">Content Adaptations:</p>
                    <ul className="space-y-2">
                      {variation.adaptations.map((adaptation, i) => (
                        <li
                          key={i}
                          className="flex items-center gap-2 text-sm text-gray-700 bg-gray-50 rounded p-2"
                        >
                          <span className="w-2 h-2 bg-purple-500 rounded-full"></span>
                          {adaptation}
                        </li>
                      ))}
                    </ul>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Auto Reposting Tab */}
        {activeTab === 'reposting' && (
          <div className="space-y-6">
            <div className="grid gap-4">
              {repostingSchedules.map((schedule) => (
                <div
                  key={schedule.id}
                  className="bg-white rounded-lg border border-gray-200 p-6 hover:shadow-lg transition-shadow"
                >
                  <div className="flex items-start justify-between mb-4">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">
                        {schedule.title}
                      </h3>
                      <p className="text-sm text-gray-600 flex items-center gap-2 mt-1">
                        <Clock size={14} />
                        {schedule.frequency}
                      </p>
                    </div>
                    <div className="text-right">
                      <span
                        className={`inline-block px-3 py-1 rounded-full text-sm font-medium ${
                          schedule.performance === 'Excellent'
                            ? 'bg-green-100 text-green-800'
                            : schedule.performance === 'Good'
                            ? 'bg-blue-100 text-blue-800'
                            : schedule.performance === 'Fair'
                            ? 'bg-yellow-100 text-yellow-800'
                            : 'bg-red-100 text-red-800'
                        }`}
                      >
                        {schedule.performance}
                      </span>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-4 mb-4">
                    <div className="bg-gray-50 rounded p-3">
                      <p className="text-xs text-gray-600 font-medium mb-1">Last Repost</p>
                      <p className="text-sm font-semibold text-gray-900">{schedule.lastRepost}</p>
                    </div>
                    <div className="bg-gray-50 rounded p-3">
                      <p className="text-xs text-gray-600 font-medium mb-1">Next Repost</p>
                      <p className="text-sm font-semibold text-gray-900">{schedule.nextRepost}</p>
                    </div>
                  </div>

                  <div>
                    <p className="text-sm font-medium text-gray-700 mb-2">Platforms:</p>
                    <div className="flex flex-wrap gap-2">
                      {schedule.platforms.map((platform) => (
                        <span
                          key={platform}
                          className="inline-flex items-center gap-1 px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-sm font-medium"
                        >
                          {PLATFORM_ICONS[platform]}
                          {platform}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error Handling Tab */}
        {activeTab === 'errors' && (
          <div className="space-y-6">
            <div className="grid gap-4">
              {errorLogs.length === 0 ? (
                <div className="bg-green-50 border border-green-200 rounded-lg p-8 text-center">
                  <Zap className="w-12 h-12 text-green-500 mx-auto mb-3" />
                  <p className="text-green-800 font-semibold">All systems operational</p>
                  <p className="text-green-700 text-sm">No errors detected</p>
                </div>
              ) : (
                errorLogs.map((log) => (
                  <div
                    key={log.id}
                    className={`rounded-lg border p-6 ${
                      log.status === 'active'
                        ? 'bg-red-50 border-red-200'
                        : 'bg-gray-50 border-gray-200'
                    } hover:shadow-lg transition-shadow`}
                  >
                    <div className="flex items-start justify-between mb-4">
                      <div className="flex items-center gap-3">
                        {log.status === 'active' ? (
                          <AlertTriangle className="text-red-600" size={24} />
                        ) : (
                          <CheckCircle className="text-gray-400" size={24} />
                        )}
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium text-gray-600">
                              {log.platform}
                            </span>
                            <span
                              className={`px-2 py-1 rounded text-xs font-medium ${
                                log.type === 'auth'
                                  ? 'bg-blue-100 text-blue-800'
                                  : log.type === 'rate-limit'
                                  ? 'bg-yellow-100 text-yellow-800'
                                  : log.type === 'api'
                                  ? 'bg-purple-100 text-purple-800'
                                  : 'bg-gray-100 text-gray-800'
                              }`}
                            >
                              {log.type}
                            </span>
                          </div>
                          <p className="text-sm text-gray-600 mt-1">{log.timestamp}</p>
                        </div>
                      </div>
                      <span
                        className={`px-3 py-1 rounded-full text-xs font-medium ${
                          log.status === 'active'
                            ? 'bg-red-100 text-red-800'
                            : 'bg-green-100 text-green-800'
                        }`}
                      >
                        {log.status === 'active' ? 'Active' : 'Resolved'}
                      </span>
                    </div>
                    <p className={`text-sm ${log.status === 'active' ? 'text-red-800' : 'text-gray-700'}`}>
                      {log.error}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Connection Modal */}
      {modalState.isOpen && modalState.platform && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full mx-4 p-6">
            <div className="flex items-center gap-3 mb-4">
              <div
                className={`flex items-center justify-center w-12 h-12 bg-gradient-to-r ${
                  PLATFORM_COLORS[modalState.platform]
                } rounded-lg text-white text-2xl`}
              >
                {PLATFORM_ICONS[modalState.platform]}
              </div>
              <div>
                <h2 className="text-xl font-bold text-gray-900">
                  Connect {modalState.platform}
                </h2>
              </div>
            </div>

            <div className="bg-blue-50 rounded-lg p-4 mb-6">
              <p className="text-sm text-blue-900">
                You will be redirected to {modalState.platform} to authorize this connection. Make
                sure you have an account and are logged in.
              </p>
            </div>

            <div className="space-y-3 mb-6">
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <CheckCircle size={16} className="text-green-600" />
                <span>Secure OAuth connection</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <CheckCircle size={16} className="text-green-600" />
                <span>No password required</span>
              </div>
              <div className="flex items-center gap-2 text-sm text-gray-700">
                <CheckCircle size={16} className="text-green-600" />
                <span>Full control over permissions</span>
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setModalState({ isOpen: false, platform: null })}
                className="flex-1 px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => handleConfirmConnection(modalState.platform)}
                className={`flex-1 px-4 py-2 text-white rounded-lg font-medium transition-colors bg-gradient-to-r ${
                  modalState.platform && PLATFORM_COLORS[modalState.platform]
                } hover:opacity-90`}
              >
                Continue
              </button>
            </div>
          </div>
        </div>
      )}

      {/* WordPress Connect Modal */}
      {wpModalOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 p-6 max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-12 h-12 bg-gradient-to-r from-blue-600 to-indigo-600 rounded-lg text-white">
                  <Globe size={24} />
                </div>
                <h2 className="text-xl font-bold text-gray-900">Connect WordPress</h2>
              </div>
              <button
                onClick={() => {
                  setWpModalOpen(false);
                  setWpConnectError(null);
                }}
                className="text-gray-500 hover:text-gray-700 p-1"
              >
                <X size={20} />
              </button>
            </div>

            {/* Tabs: Make (Webhook) | WordPress API */}
            <div className="flex gap-1 p-1 bg-gray-100 rounded-lg mb-4">
              <button
                type="button"
                onClick={() => { setWpModalTab('make'); setWpConnectError(null); }}
                className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${wpModalTab === 'make' ? 'bg-white text-indigo-600 shadow' : 'text-gray-600 hover:text-gray-900'}`}
              >
                Via Make (Webhook)
              </button>
              <button
                type="button"
                onClick={() => { setWpModalTab('wordpress_api'); setWpConnectError(null); }}
                className={`flex-1 py-2 px-3 rounded-md text-sm font-medium transition-colors ${wpModalTab === 'wordpress_api' ? 'bg-white text-indigo-600 shadow' : 'text-gray-600 hover:text-gray-900'}`}
              >
                Via WordPress API
              </button>
            </div>

            {wpModalTab === 'make' ? (
              <>
                <div className="text-sm text-gray-700 bg-gray-50 border border-gray-200 rounded-lg p-4 mb-4">
                  <p className="font-semibold text-gray-900 mb-2">To connect WordPress via Make:</p>
                  <ol className="list-decimal list-inside space-y-1.5 text-gray-700">
                    <li>Create a scenario in <strong>Make</strong>.</li>
                    <li>Add a <strong>Custom Webhook</strong> module and copy the generated webhook URL.</li>
                    <li>Add the <strong>WordPress → Create a Post</strong> module.</li>
                    <li>Map the webhook payload fields (title, content, excerpt, status, featured_image, categories, tags) to the WordPress post fields.</li>
                    <li>Paste the webhook URL below and click Connect.</li>
                  </ol>
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Webhook URL (from Make)</label>
                    <input
                      type="url"
                      value={wpForm.webhookUrl}
                      onChange={(e) => setWpForm((f) => ({ ...f, webhookUrl: e.target.value }))}
                      placeholder="https://hook.eu1.make.com/..."
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">The URL from your Make scenario’s Custom Webhook module.</p>
                  </div>
                  {wpConnectError && (
                    <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 p-3 rounded-lg">
                      <AlertCircle size={18} />
                      <span>{wpConnectError}</span>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <p className="text-sm text-gray-600 mb-2">Enter your WordPress site URL and login details.</p>
                <div className="text-sm text-blue-800 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2 mb-4">
                  <strong>If you see &quot;You are not currently logged in&quot;</strong> — use an <strong>Application Password</strong> (Users → your profile → Application Passwords).
                </div>
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">WordPress Site URL</label>
                    <input
                      type="url"
                      value={wpForm.siteUrl}
                      onChange={(e) => setWpForm((f) => ({ ...f, siteUrl: e.target.value }))}
                      placeholder="https://yoursite.com"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    />
                    <p className="text-xs text-gray-500 mt-1">Full address only, no trailing slash. Do not add /wp-admin or /wp-json.</p>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">WordPress Username</label>
                    <input
                      type="text"
                      value={wpForm.username}
                      onChange={(e) => setWpForm((f) => ({ ...f, username: e.target.value }))}
                      placeholder="admin"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      autoComplete="username"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">WordPress Password (login)</label>
                    <input
                      type="password"
                      value={wpForm.password}
                      onChange={(e) => setWpForm((f) => ({ ...f, password: e.target.value }))}
                      placeholder="Your WordPress account password"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      autoComplete="current-password"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Application Password (optional)</label>
                    <input
                      type="password"
                      value={wpForm.applicationPassword}
                      onChange={(e) => setWpForm((f) => ({ ...f, applicationPassword: e.target.value }))}
                      placeholder="xxxx xxxx xxxx xxxx xxxx xxxx"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                      autoComplete="off"
                    />
                    <p className="text-xs text-gray-500 mt-1">Users → your profile → Application Passwords.</p>
                  </div>
                  {wpConnectError && (
                    <div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 p-3 rounded-lg">
                      <AlertCircle size={18} />
                      <span>{wpConnectError}</span>
                    </div>
                  )}
                </div>
              </>
            )}

            <div className="flex gap-3 mt-6">
              <button
                onClick={() => {
                  setWpModalOpen(false);
                  setWpConnectError(null);
                }}
                className="flex-1 px-4 py-2 text-gray-700 border border-gray-300 rounded-lg hover:bg-gray-50 font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConnectWordPress}
                disabled={wpConnecting}
                className="flex-1 px-4 py-2 bg-gradient-to-r from-blue-600 to-indigo-600 text-white rounded-lg font-medium hover:opacity-90 disabled:opacity-60 transition-colors flex items-center justify-center gap-2"
              >
                {wpConnecting ? (
                  <>
                    <Loader size={18} className="animate-spin" />
                    Connecting...
                  </>
                ) : (
                  'Connect'
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Connects;
