import { useState } from 'react';
import { Eye, EyeOff, Copy, Download, Trash2, LogOut, Key, Lock, CreditCard, Palette, Bell } from 'lucide-react';

const Profile = () => {
  const [activeTab, setActiveTab] = useState<'account' | 'subscription' | 'brand' | 'notifications' | 'privacy'>('account');
  const [showPassword, setShowPassword] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);

  const tabs = [
    { id: 'account', label: 'Account Settings', icon: Lock },
    { id: 'subscription', label: 'Subscription', icon: CreditCard },
    { id: 'brand', label: 'Brand Settings', icon: Palette },
    { id: 'notifications', label: 'Notifications', icon: Bell },
    { id: 'privacy', label: 'Data & Privacy', icon: Key },
  ];

  const billingHistory = [
    { id: 1, date: '2024-01-15', plan: 'Professional', amount: '$29.00', status: 'Paid' },
    { id: 2, date: '2023-12-15', plan: 'Professional', amount: '$29.00', status: 'Paid' },
    { id: 3, date: '2023-11-15', plan: 'Professional', amount: '$29.00', status: 'Paid' },
    { id: 4, date: '2023-10-15', plan: 'Professional', amount: '$29.00', status: 'Paid' },
  ];

  const cardTemplateStyles = [
    { id: 1, name: 'Modern Minimal', preview: '⚪' },
    { id: 2, name: 'Bold & Vibrant', preview: '🎨' },
    { id: 3, name: 'Professional', preview: '💼' },
    { id: 4, name: 'Creative', preview: '✨' },
    { id: 5, name: 'Minimalist', preview: '◼️' },
    { id: 6, name: 'Dark Theme', preview: '⬛' },
  ];

  const notificationSettings = [
    { id: 1, label: 'Daily digest email', description: 'Summary of all your content performance', enabled: true },
    { id: 2, label: 'Weekly report', description: 'Detailed weekly analytics breakdown', enabled: true },
    { id: 3, label: 'Performance alerts', description: 'Notified when engagement drops', enabled: true },
    { id: 4, label: 'Publish confirmation', description: 'Confirmation when posts go live', enabled: false },
    { id: 5, label: 'New comments', description: 'Alert on new comments and mentions', enabled: true },
    { id: 6, label: 'System errors', description: 'Critical error notifications', enabled: true },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-black text-gray-900 mb-2">Profile</h1>
        <p className="text-gray-600">Account, brand, and privacy settings</p>
      </div>

      {/* Tabs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2">
        {tabs.map(tab => {
          const IconComponent = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as any)}
              className={`px-4 py-3 rounded-lg font-semibold transition-colors flex items-center gap-2 ${
                activeTab === tab.id
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
              }`}
            >
              <IconComponent size={18} />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Account Settings */}
      {activeTab === 'account' && (
        <div className="bg-white rounded-lg shadow-md p-6 space-y-6">
          <h2 className="text-2xl font-bold text-gray-900">Account Settings</h2>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Full Name</label>
              <input
                type="text"
                defaultValue="Sarah Johnson"
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Email Address</label>
              <input
                type="email"
                defaultValue="sarah@example.com"
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Phone Number</label>
              <input
                type="tel"
                defaultValue="+1 (555) 123-4567"
                className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Country</label>
              <select className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option>United States</option>
                <option>Canada</option>
                <option>UK</option>
              </select>
            </div>
          </div>

          <div className="border-t pt-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Password & Security</h3>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Current Password</label>
              <div className="relative mb-4">
                <input
                  type={showPassword ? 'text' : 'password'}
                  defaultValue="••••••••"
                  className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <button
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-2.5 text-gray-500"
                >
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              <button className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors">
                Change Password
              </button>
            </div>
          </div>

          <div className="border-t pt-6">
            <h3 className="text-lg font-bold text-gray-900 mb-4">Two-Factor Authentication</h3>
            <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
              <div>
                <p className="font-semibold text-gray-900">2FA is <span className="text-green-600">enabled</span></p>
                <p className="text-sm text-gray-600 mt-1">Your account is protected with two-factor authentication</p>
              </div>
              <button className="px-4 py-2 bg-red-100 text-red-700 rounded-lg font-semibold hover:bg-red-200 transition-colors">
                Disable
              </button>
            </div>
          </div>

          <button className="w-full px-6 py-3 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700 transition-colors">
            Save Changes
          </button>
        </div>
      )}

      {/* Subscription Management */}
      {activeTab === 'subscription' && (
        <div className="space-y-6">
          <div className="bg-gradient-to-br from-blue-50 to-purple-50 rounded-lg p-8 border-2 border-blue-200">
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-3xl font-black text-gray-900">Professional Plan</h2>
                <p className="text-gray-600 mt-2">$29.00 / month</p>
              </div>
              <span className="px-4 py-2 bg-green-100 text-green-700 rounded-full font-bold">Active</span>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
              <div>
                <h3 className="font-semibold text-gray-900 mb-3">Plan Features</h3>
                <ul className="space-y-2">
                  <li className="flex items-center gap-2 text-gray-700">✓ Unlimited posts</li>
                  <li className="flex items-center gap-2 text-gray-700">✓ 5 connected accounts</li>
                  <li className="flex items-center gap-2 text-gray-700">✓ Advanced analytics</li>
                  <li className="flex items-center gap-2 text-gray-700">✓ AI writing assistant</li>
                </ul>
              </div>
              <div>
                <h3 className="font-semibold text-gray-900 mb-3">Next Billing</h3>
                <p className="text-2xl font-black text-gray-900">February 15, 2024</p>
                <p className="text-sm text-gray-600 mt-2">Amount: $29.00</p>
              </div>
            </div>

            <div className="flex gap-2">
              <button className="px-6 py-2 bg-purple-600 text-white rounded-lg font-semibold hover:bg-purple-700 transition-colors">
                Upgrade to Pro
              </button>
              <button className="px-6 py-2 bg-white text-gray-700 border border-gray-300 rounded-lg font-semibold hover:bg-gray-50 transition-colors">
                Downgrade
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Billing History</h3>
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 font-semibold text-gray-700">Date</th>
                    <th className="text-left py-3 font-semibold text-gray-700">Plan</th>
                    <th className="text-left py-3 font-semibold text-gray-700">Amount</th>
                    <th className="text-left py-3 font-semibold text-gray-700">Status</th>
                    <th className="text-left py-3 font-semibold text-gray-700">Action</th>
                  </tr>
                </thead>
                <tbody>
                  {billingHistory.map(bill => (
                    <tr key={bill.id} className="border-b hover:bg-gray-50">
                      <td className="py-3 text-gray-700">{bill.date}</td>
                      <td className="py-3 text-gray-700">{bill.plan}</td>
                      <td className="py-3 font-semibold text-gray-900">{bill.amount}</td>
                      <td className="py-3">
                        <span className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-sm font-semibold">
                          {bill.status}
                        </span>
                      </td>
                      <td className="py-3">
                        <button className="text-blue-600 hover:underline font-semibold">Invoice</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <h3 className="text-xl font-bold text-gray-900 mb-4">Payment Method</h3>
            <div className="p-4 bg-gray-50 rounded-lg flex items-center justify-between">
              <div>
                <p className="font-semibold text-gray-900">Visa •••• 4242</p>
                <p className="text-sm text-gray-600">Expires 12/2026</p>
              </div>
              <button className="px-4 py-2 text-blue-600 font-semibold hover:bg-gray-200 rounded transition-colors">
                Update
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Brand Settings */}
      {activeTab === 'brand' && (
        <div className="bg-white rounded-lg shadow-md p-6 space-y-6">
          <h2 className="text-2xl font-bold text-gray-900">Brand Settings</h2>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Brand Name</label>
            <input
              type="text"
              defaultValue="Creator Hub"
              className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Primary Brand Color</label>
              <div className="flex gap-3">
                <input
                  type="color"
                  defaultValue="#667eea"
                  className="w-16 h-10 rounded-lg cursor-pointer"
                />
                <input
                  type="text"
                  defaultValue="#667eea"
                  className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-semibold text-gray-700 mb-2">Secondary Brand Color</label>
              <div className="flex gap-3">
                <input
                  type="color"
                  defaultValue="#764ba2"
                  className="w-16 h-10 rounded-lg cursor-pointer"
                />
                <input
                  type="text"
                  defaultValue="#764ba2"
                  className="flex-1 px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Default Font</label>
            <select className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option>Poppins</option>
              <option>Inter</option>
              <option>Playfair Display</option>
              <option>Georgia</option>
            </select>
          </div>

          <div>
            <h3 className="text-lg font-bold text-gray-900 mb-4">Default Card Styles</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {cardTemplateStyles.map(style => (
                <button
                  key={style.id}
                  className="p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 transition-colors text-center"
                >
                  <p className="text-3xl mb-2">{style.preview}</p>
                  <p className="text-sm font-semibold text-gray-700">{style.name}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <h3 className="text-lg font-bold text-gray-900 mb-4">Default Posting Times</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map(day => (
                <div key={day}>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">{day}</label>
                  <input type="time" defaultValue="09:00" className="w-full px-4 py-2 border rounded-lg" />
                </div>
              ))}
            </div>
          </div>

          <button className="w-full px-6 py-3 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700 transition-colors">
            Save Brand Settings
          </button>
        </div>
      )}

      {/* Notifications Settings */}
      {activeTab === 'notifications' && (
        <div className="bg-white rounded-lg shadow-md p-6 space-y-6">
          <h2 className="text-2xl font-bold text-gray-900">Notification Settings</h2>

          <div className="space-y-4">
            {notificationSettings.map(setting => (
              <div key={setting.id} className="flex items-start gap-4 p-4 border rounded-lg hover:bg-gray-50 transition-colors">
                <input
                  type="checkbox"
                  defaultChecked={setting.enabled}
                  className="w-5 h-5 mt-1 rounded"
                />
                <div className="flex-1">
                  <p className="font-semibold text-gray-900">{setting.label}</p>
                  <p className="text-sm text-gray-600 mt-1">{setting.description}</p>
                </div>
              </div>
            ))}
          </div>

          <button className="w-full px-6 py-3 bg-green-600 text-white rounded-lg font-bold hover:bg-green-700 transition-colors">
            Save Preferences
          </button>
        </div>
      )}

      {/* Data & Privacy */}
      {activeTab === 'privacy' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">API Tokens</h2>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">API Token</label>
                <div className="flex gap-2">
                  <div className="flex-1 relative">
                    <input
                      type={showApiKey ? 'text' : 'password'}
                      defaultValue="sk_live_4eC39HqLyjWDarhtT657j8Pb"
                      className="w-full px-4 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      readOnly
                    />
                    <button
                      onClick={() => setShowApiKey(!showApiKey)}
                      className="absolute right-3 top-2.5 text-gray-500"
                    >
                      {showApiKey ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                  <button className="px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors flex items-center gap-2">
                    <Copy size={18} /> Copy
                  </button>
                </div>
              </div>

              <div className="flex gap-2">
                <button className="flex-1 px-4 py-2 bg-yellow-100 text-yellow-700 rounded-lg font-semibold hover:bg-yellow-200 transition-colors">
                  Regenerate
                </button>
                <button className="flex-1 px-4 py-2 bg-red-100 text-red-700 rounded-lg font-semibold hover:bg-red-200 transition-colors">
                  Revoke
                </button>
              </div>

              <p className="text-xs text-gray-600">
                🔒 Never share your API token. Treat it like a password. If you suspect it's been compromised, regenerate it immediately.
              </p>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-2xl font-bold text-gray-900 mb-6">Data Management</h2>

            <div className="space-y-4">
              <button className="w-full px-6 py-3 bg-blue-600 text-white rounded-lg font-bold hover:bg-blue-700 transition-colors flex items-center justify-center gap-2">
                <Download size={20} /> Download My Data
              </button>
              <p className="text-sm text-gray-600">
                Download all your data (posts, analytics, settings) in a portable format. This includes all content you've created and metrics.
              </p>
            </div>
          </div>

          <div className="bg-red-50 rounded-lg shadow-md p-6 border-l-4 border-red-500">
            <h2 className="text-2xl font-bold text-red-900 mb-6">Danger Zone</h2>

            <div className="space-y-4">
              <div className="bg-white p-4 rounded-lg">
                <h3 className="font-bold text-gray-900 mb-2">Delete Account</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Permanently delete your account and all associated data. This action cannot be undone.
                </p>
                <button className="px-6 py-2 bg-red-600 text-white rounded-lg font-bold hover:bg-red-700 transition-colors flex items-center gap-2">
                  <Trash2 size={18} /> Delete Account
                </button>
              </div>

              <div className="bg-white p-4 rounded-lg">
                <h3 className="font-bold text-gray-900 mb-2">Logout</h3>
                <p className="text-sm text-gray-600 mb-4">
                  Sign out from this current session.
                </p>
                <button className="px-6 py-2 bg-gray-700 text-white rounded-lg font-bold hover:bg-gray-800 transition-colors flex items-center gap-2">
                  <LogOut size={18} /> Logout
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Profile;
