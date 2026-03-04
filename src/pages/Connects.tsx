import { useState } from 'react';
import { Plus, Link2, AlertCircle, RefreshCw, Copy, CheckCircle } from 'lucide-react';

const Connects = () => {
  const [activeTab, setActiveTab] = useState<'accounts' | 'auto-posting' | 'variations' | 'reposting' | 'errors'>('accounts');
  const [connectingPlatform, setConnectingPlatform] = useState<string | null>(null);
  const [connectedAccounts] = useState([
    { id: 1, platform: 'Instagram', handle: '@contentcreator', connected: false, followers: '0' },
    { id: 2, platform: 'Twitter', handle: '@creator_hub', connected: false, followers: '0' },
    { id: 3, platform: 'LinkedIn', handle: '/in/creator', connected: false, followers: '0' },
    { id: 4, platform: 'Facebook', handle: 'Creator Hub', connected: false, followers: '0' },
    { id: 5, platform: 'TikTok', handle: '@creator_hub', connected: false, followers: '0' },
  ]);

  const connectionRequirements: Record<string, { title: string; description: string; fields: Array<{ name: string; description: string; example: string }> }> = {
    Instagram: {
      title: 'Connect Your Instagram Account',
      description: 'You will be redirected to Instagram to authorize access to your account. You need to be the account owner or have admin access.',
      fields: [
        { name: 'Instagram Account', description: 'Your Instagram business or personal account', example: '@yourhandle' },
        { name: 'Authorization', description: 'Grant permission to post content and manage your account', example: 'Click "Authorize" button' },
      ],
    },
    Twitter: {
      title: 'Connect Your Twitter/X Account',
      description: 'Authorize ContentFlow to post tweets and manage your Twitter presence.',
      fields: [
        { name: 'Twitter API Credentials', description: 'API Key and API Secret from your Twitter Developer account', example: 'From Twitter Developer Portal' },
        { name: 'Access Token', description: 'Your personal access token for authentication', example: 'Generated token' },
        { name: 'Access Secret', description: 'Your access token secret', example: 'Generated secret' },
      ],
    },
    LinkedIn: {
      title: 'Connect Your LinkedIn Account',
      description: 'Authenticate with LinkedIn to enable posting to your profile and company pages.',
      fields: [
        { name: 'LinkedIn Email', description: 'Your LinkedIn account email address', example: 'you@example.com' },
        { name: 'Authorization', description: 'Grant permission to post and manage content', example: 'Click "Authorize" button' },
        { name: '2FA Code', description: 'If enabled, two-factor authentication code', example: '6-digit code' },
      ],
    },
    Facebook: {
      title: 'Connect Your Facebook Account',
      description: 'Link your Facebook Business account to schedule and publish posts.',
      fields: [
        { name: 'Facebook Account', description: 'Your Facebook business or personal account', example: 'Your account name' },
        { name: 'Authorization', description: 'Grant permission to manage pages and posts', example: 'Click "Login with Facebook"' },
        { name: 'Select Page', description: 'Choose which Facebook page to manage', example: 'Your business page' },
      ],
    },
    TikTok: {
      title: 'Connect Your TikTok Account',
      description: 'Authorize ContentFlow to access your TikTok account for content management.',
      fields: [
        { name: 'TikTok Account', description: 'Your TikTok username', example: '@yourusername' },
        { name: 'Authorization', description: 'Grant permission for posting and analytics access', example: 'Click "Authorize" button' },
        { name: 'Creator Account', description: 'Your account must be a Creator Account', example: 'Upgrade to creator account' },
      ],
    },
  };

  const autoPostingConfigs = [
    {
      id: 1,
      platform: 'Instagram',
      enabled: true,
      carbonCopy: 'Use exact caption',
      format: 'Single image with carousel support',
      autoHashtags: true,
      maxLength: 2200,
    },
    {
      id: 2,
      platform: 'Twitter',
      enabled: true,
      carbonCopy: 'Shorten caption to 280 chars',
      format: 'Thread format with breaks',
      autoHashtags: true,
      maxLength: 280,
    },
    {
      id: 3,
      platform: 'LinkedIn',
      enabled: true,
      carbonCopy: 'Professional tone + CTA',
      format: 'Long-form with emojis',
      autoHashtags: true,
      maxLength: 3000,
    },
  ];

  const variations = [
    {
      platform: 'Instagram',
      type: 'Carousel',
      format: '3-5 slides, 1080x1350px each',
      adaptations: ['Add product images', 'Include call-to-action', 'Optimize for mobile'],
    },
    {
      platform: 'Twitter',
      type: 'Thread',
      format: '3-7 tweets connected',
      adaptations: ['Break content into hooks', 'Add engagement questions', 'Number tweets'],
    },
    {
      platform: 'Facebook',
      type: 'Album Post',
      format: '1-10 images in collection',
      adaptations: ['Add detailed captions', 'Include video option', 'Optimize for feed'],
    },
    {
      platform: 'Pinterest',
      type: 'Pin',
      format: '1000x1500px vertical',
      adaptations: ['Add SEO description', 'Brand colors only', 'Pinterest best practices'],
    },
  ];

  const repostingSchedules = [
    {
      id: 1,
      title: 'Top performing posts',
      frequency: 'Weekly',
      platforms: ['Instagram', 'Twitter'],
      lastRepost: '2024-01-14',
      nextRepost: '2024-01-21',
      performance: 'Excellent',
    },
    {
      id: 2,
      title: 'Monthly highlights',
      frequency: 'Monthly',
      platforms: ['LinkedIn'],
      lastRepost: '2024-01-01',
      nextRepost: '2024-02-01',
      performance: 'Good',
    },
  ];

  const errors = [
    {
      id: 1,
      timestamp: '2024-01-14 14:32',
      platform: 'Facebook',
      error: 'Token expired - please reconnect your account',
      type: 'auth',
      status: 'active',
    },
    {
      id: 2,
      timestamp: '2024-01-13 09:15',
      platform: 'Twitter',
      error: 'Image upload failed - file too large (12MB max)',
      type: 'file',
      status: 'resolved',
    },
    {
      id: 3,
      timestamp: '2024-01-12 16:42',
      platform: 'Instagram',
      error: 'Rate limit exceeded - try again in 2 hours',
      type: 'rate-limit',
      status: 'resolved',
    },
  ];

  const tabs = [
    { id: 'accounts', label: 'OAuth & Accounts', icon: Link2 },
    { id: 'auto-posting', label: 'Auto Posting', icon: Plus },
    { id: 'variations', label: 'Variations', icon: Copy },
    { id: 'reposting', label: 'Auto Reposting', icon: RefreshCw },
    { id: 'errors', label: 'Error Handling', icon: AlertCircle },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-black text-gray-900 mb-2">Connects</h1>
        <p className="text-gray-600">Distribution engine - automate posting across platforms</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-3 font-semibold border-b-2 transition-colors whitespace-nowrap ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* OAuth & Accounts */}
      {activeTab === 'accounts' && (
        <div className="space-y-4">
          <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-6 border-l-4 border-blue-500">
            <h2 className="text-lg font-bold text-gray-900 mb-2">Connected Accounts</h2>
            <p className="text-sm text-gray-600">Manage your social media OAuth connections</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {connectedAccounts.map(account => (
              <div key={account.id} className="bg-white rounded-lg shadow-md p-6 border-t-4 border-blue-500">
                <div className="flex items-start justify-between mb-4">
                  <div>
                    <h3 className="text-lg font-bold text-gray-900">{account.platform}</h3>
                    <p className="text-sm text-gray-600 mt-1">{account.handle}</p>
                  </div>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-bold ${
                      account.connected
                        ? 'bg-green-100 text-green-700'
                        : 'bg-gray-100 text-gray-700'
                    }`}
                  >
                    {account.connected ? '✓ Connected' : 'Not Connected'}
                  </span>
                </div>
                <div className="text-sm text-gray-600 mb-4">{account.followers} followers</div>
                <button 
                  onClick={() => setConnectingPlatform(account.platform)}
                  className={`w-full px-4 py-2 rounded-lg font-semibold transition-colors ${
                  account.connected
                    ? 'bg-red-100 text-red-700 hover:bg-red-200'
                    : 'bg-blue-600 text-white hover:bg-blue-700'
                }`}>
                  {account.connected ? 'Disconnect' : 'Connect'}
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Auto Posting */}
      {activeTab === 'auto-posting' && (
        <div className="space-y-4">
          {autoPostingConfigs.map(config => (
            <div key={config.id} className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-gray-900">{config.platform}</h3>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" defaultChecked={config.enabled} className="w-4 h-4" />
                  <span className="text-sm font-semibold text-gray-700">Enabled</span>
                </label>
              </div>
              <div className="space-y-2 text-sm text-gray-600">
                <p><strong>Format:</strong> {config.format}</p>
                <p><strong>Caption:</strong> {config.carbonCopy}</p>
                <p><strong>Max Length:</strong> {config.maxLength} characters</p>
                <label className="flex items-center gap-2 mt-3 cursor-pointer">
                  <input type="checkbox" defaultChecked={config.autoHashtags} className="w-4 h-4" />
                  <span>Auto-add hashtags</span>
                </label>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Variations */}
      {activeTab === 'variations' && (
        <div className="space-y-4">
          {variations.map((variation, idx) => (
            <div key={idx} className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">{variation.platform}</h3>
                  <p className="text-sm text-gray-600 mt-1">{variation.type} • {variation.format}</p>
                </div>
              </div>
              <div>
                <p className="text-sm font-semibold text-gray-700 mb-2">Adaptations:</p>
                <ul className="space-y-1">
                  {variation.adaptations.map((adaptation, i) => (
                    <li key={i} className="text-sm text-gray-600 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-blue-500 rounded-full"></span>
                      {adaptation}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Auto Reposting */}
      {activeTab === 'reposting' && (
        <div className="space-y-4">
          {repostingSchedules.map(schedule => (
            <div key={schedule.id} className="bg-white rounded-lg shadow-md p-6">
              <div className="flex items-start justify-between mb-4">
                <div>
                  <h3 className="text-lg font-bold text-gray-900">{schedule.title}</h3>
                  <p className="text-sm text-gray-600 mt-1">Every {schedule.frequency}</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-bold ${
                  schedule.performance === 'Excellent'
                    ? 'bg-green-100 text-green-700'
                    : 'bg-yellow-100 text-yellow-700'
                }`}>
                  {schedule.performance}
                </span>
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm mb-4">
                <div>
                  <p className="text-gray-600">Last repost</p>
                  <p className="font-semibold text-gray-900">{schedule.lastRepost}</p>
                </div>
                <div>
                  <p className="text-gray-600">Next repost</p>
                  <p className="font-semibold text-gray-900">{schedule.nextRepost}</p>
                </div>
              </div>
              <div className="flex gap-2 flex-wrap">
                {schedule.platforms.map(platform => (
                  <span key={platform} className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                    {platform}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error Handling */}
      {activeTab === 'errors' && (
        <div className="space-y-4">
          {errors.map(error => (
            <div key={error.id} className={`bg-white rounded-lg shadow-md p-6 border-l-4 ${
              error.status === 'active' ? 'border-red-500' : 'border-green-500'
            }`}>
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <AlertCircle size={18} className={error.status === 'active' ? 'text-red-600' : 'text-green-600'} />
                    <h3 className="font-bold text-gray-900">{error.platform}</h3>
                  </div>
                  <p className="text-sm text-gray-600">{error.error}</p>
                </div>
                <span className={`px-3 py-1 rounded-full text-xs font-bold whitespace-nowrap ${
                  error.status === 'active'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-green-100 text-green-700'
                }`}>
                  {error.status === 'active' ? '⚠️ Active' : '✓ Resolved'}
                </span>
              </div>
              <p className="text-xs text-gray-500 mb-3">{error.timestamp}</p>
              {error.status === 'active' && (
                <button className="w-full px-4 py-2 bg-red-100 text-red-700 rounded-lg font-semibold hover:bg-red-200 transition-colors flex items-center justify-center gap-2">
                  <RefreshCw size={16} /> Retry
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Connection Modal */}
      {connectingPlatform && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 text-white p-6 flex items-center justify-between">
              <div>
                <h2 className="text-2xl font-bold">{connectionRequirements[connectingPlatform]?.title}</h2>
                <p className="text-blue-100 mt-1">{connectionRequirements[connectingPlatform]?.description}</p>
              </div>
              <button
                onClick={() => setConnectingPlatform(null)}
                className="text-white hover:text-blue-100 text-3xl"
              >
                ×
              </button>
            </div>

            <div className="p-6">
              <div className="space-y-6">
                <div>
                  <h3 className="text-lg font-bold text-gray-900 mb-4">Required Credentials</h3>
                  <div className="space-y-4">
                    {connectionRequirements[connectingPlatform]?.fields.map((field, idx) => (
                      <div key={idx} className="border border-gray-200 rounded-lg p-4 hover:border-blue-300 hover:bg-blue-50 transition-all">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <p className="font-semibold text-gray-900">{field.name}</p>
                            <p className="text-sm text-gray-600 mt-1">{field.description}</p>
                            <p className="text-xs text-gray-500 mt-2 font-mono bg-gray-100 p-2 rounded inline-block">Example: {field.example}</p>
                          </div>
                          <CheckCircle size={20} className="text-green-500 mt-1 flex-shrink-0" />
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <p className="text-sm text-blue-900">
                    <strong>Note:</strong> Your credentials are encrypted and stored securely. We never store your passwords - only API tokens and authentication keys needed to post on your behalf.
                  </p>
                </div>
              </div>
            </div>

            <div className="flex gap-3 p-6 border-t border-gray-200">
              <button
                onClick={() => setConnectingPlatform(null)}
                className="flex-1 px-6 py-3 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-semibold hover:shadow-lg transition-all">
                Proceed to Connect
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Connects;
