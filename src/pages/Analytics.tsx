import { useState } from 'react';
import { Download, Share2 } from 'lucide-react';
import { LineChart, Line, BarChart, Bar, PieChart, Pie, Cell, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const Analytics = () => {
  const [activeTab, setActiveTab] = useState<'overview' | 'content' | 'audience' | 'platforms' | 'ai' | 'export'>('overview');
  const [dateRange, setDateRange] = useState('30days');

  const engagementData = [
    { date: 'Jan 1', likes: 420, comments: 240, shares: 120 },
    { date: 'Jan 5', likes: 520, comments: 340, shares: 220 },
    { date: 'Jan 10', likes: 480, comments: 290, shares: 180 },
    { date: 'Jan 15', likes: 620, comments: 450, shares: 320 },
    { date: 'Jan 20', likes: 580, comments: 380, shares: 280 },
    { date: 'Jan 25', likes: 720, comments: 520, shares: 420 },
    { date: 'Jan 30', likes: 840, comments: 640, shares: 520 },
  ];

  const timezoneData = [
    { timezone: 'EST', engagement: 3400 },
    { timezone: 'CST', engagement: 2800 },
    { timezone: 'MST', engagement: 2200 },
    { timezone: 'PST', engagement: 2900 },
    { timezone: 'UTC', engagement: 1800 },
  ];

  const demographicsData = [
    { name: 'Ages 18-24', value: 35 },
    { name: 'Ages 25-34', value: 40 },
    { name: 'Ages 35-44', value: 15 },
    { name: 'Ages 45+', value: 10 },
  ];

  const platformComparison = [
    { name: 'Instagram', engagement: 4.8, reach: 8500, followers: 54200 },
    { name: 'Twitter', engagement: 3.2, reach: 5200, followers: 28500 },
    { name: 'LinkedIn', engagement: 2.1, reach: 3400, followers: 12800 },
    { name: 'Facebook', engagement: 2.5, reach: 4100, followers: 19200 },
  ];

  const contentPerformance = [
    { type: 'Video', posts: 12, avgLikes: 850, avgComments: 45 },
    { type: 'Image', posts: 28, avgLikes: 420, avgComments: 22 },
    { type: 'Carousel', posts: 8, avgLikes: 680, avgComments: 38 },
    { type: 'Text', posts: 16, avgLikes: 180, avgComments: 12 },
  ];

  const deviceData = [
    { name: 'Mobile', value: 68 },
    { name: 'Desktop', value: 22 },
    { name: 'Tablet', value: 10 },
  ];

  const colors = ['#667eea', '#764ba2', '#f093fb', '#4facfe'];

  const tabs = [
    { id: 'overview', label: 'Overview' },
    { id: 'content', label: 'Content Analytics' },
    { id: 'audience', label: 'Audience Insights' },
    { id: 'platforms', label: 'Platform Comparison' },
    { id: 'ai', label: 'AI Insights' },
    { id: 'export', label: 'Export' },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-black text-gray-900 mb-2">Analytics</h1>
          <p className="text-gray-600">Intelligence hub - deeper insights than basic numbers</p>
        </div>
        <div className="flex gap-2">
          <select
            value={dateRange}
            onChange={e => setDateRange(e.target.value)}
            className="px-4 py-2 border rounded-lg font-semibold text-gray-700"
          >
            <option value="7days">Last 7 days</option>
            <option value="30days">Last 30 days</option>
            <option value="90days">Last 90 days</option>
            <option value="1year">Last year</option>
          </select>
        </div>
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

      {/* Overview */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div className="bg-white rounded-lg shadow-md p-6 border-t-4 border-blue-500">
              <p className="text-sm text-gray-600 mb-1">Total Impressions</p>
              <p className="text-3xl font-black text-gray-900">156.2K</p>
              <p className="text-xs text-green-600 font-bold mt-2">+18.5% from last month</p>
            </div>
            <div className="bg-white rounded-lg shadow-md p-6 border-t-4 border-purple-500">
              <p className="text-sm text-gray-600 mb-1">Total Engagement</p>
              <p className="text-3xl font-black text-gray-900">8,420</p>
              <p className="text-xs text-green-600 font-bold mt-2">+12.3% from last month</p>
            </div>
            <div className="bg-white rounded-lg shadow-md p-6 border-t-4 border-pink-500">
              <p className="text-sm text-gray-600 mb-1">Avg Engagement Rate</p>
              <p className="text-3xl font-black text-gray-900">5.4%</p>
              <p className="text-xs text-green-600 font-bold mt-2">+1.2% from last month</p>
            </div>
            <div className="bg-white rounded-lg shadow-md p-6 border-t-4 border-green-500">
              <p className="text-sm text-gray-600 mb-1">Follower Growth</p>
              <p className="text-3xl font-black text-gray-900">+2.5K</p>
              <p className="text-xs text-green-600 font-bold mt-2">+8.2% from last month</p>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Engagement Over Time</h2>
            <ResponsiveContainer width="100%" height={300}>
              <LineChart data={engagementData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="likes" stroke="#667eea" name="Likes" />
                <Line type="monotone" dataKey="comments" stroke="#764ba2" name="Comments" />
                <Line type="monotone" dataKey="shares" stroke="#f093fb" name="Shares" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      {/* Content Analytics */}
      {activeTab === 'content' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Content Performance</h2>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={contentPerformance}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="type" />
                  <YAxis />
                  <Tooltip />
                  <Legend />
                  <Bar dataKey="avgLikes" fill="#667eea" name="Avg Likes" />
                  <Bar dataKey="avgComments" fill="#764ba2" name="Avg Comments" />
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Posts by Type</h2>
              <div className="space-y-3">
                {contentPerformance.map((item, idx) => (
                  <div key={idx} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                    <span className="font-semibold text-gray-900">{item.type}</span>
                    <div className="flex items-center gap-4">
                      <span className="text-sm text-gray-600">{item.posts} posts</span>
                      <div className="w-24 bg-gray-200 rounded-full h-2">
                        <div 
                          className="bg-gradient-to-r from-blue-500 to-purple-500 h-2 rounded-full"
                          style={{ width: `${(item.avgLikes / 850) * 100}%` }}
                        ></div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Audience Insights */}
      {activeTab === 'audience' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Age Demographics</h2>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={demographicsData} cx="50%" cy="50%" labelLine={false} outerRadius={80} fill="#8884d8" dataKey="value">
                    {demographicsData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Device Usage</h2>
              <ResponsiveContainer width="100%" height={300}>
                <PieChart>
                  <Pie data={deviceData} cx="50%" cy="50%" labelLine={false} outerRadius={80} fill="#8884d8" dataKey="value">
                    {deviceData.map((_, index) => (
                      <Cell key={`cell-${index}`} fill={colors[index % colors.length]} />
                    ))}
                  </Pie>
                  <Tooltip />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="lg:col-span-2 bg-white rounded-lg shadow-md p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Engagement by Timezone</h2>
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={timezoneData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="timezone" />
                  <YAxis />
                  <Tooltip />
                  <Bar dataKey="engagement" fill="#667eea" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          <div className="bg-gradient-to-r from-green-50 to-blue-50 rounded-lg p-6 border-l-4 border-green-500">
            <h3 className="text-lg font-bold text-gray-900 mb-3">✅ Sentiment Analysis</h3>
            <div className="grid grid-cols-3 gap-4">
              <div>
                <p className="text-sm text-gray-600">Positive</p>
                <p className="text-3xl font-black text-green-600">78%</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Neutral</p>
                <p className="text-3xl font-black text-yellow-600">18%</p>
              </div>
              <div>
                <p className="text-sm text-gray-600">Negative</p>
                <p className="text-3xl font-black text-red-600">4%</p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Platform Comparison */}
      {activeTab === 'platforms' && (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow-md p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Platform Performance Radar</h2>
            <ResponsiveContainer width="100%" height={400}>
              <RadarChart data={platformComparison}>
                <PolarGrid />
                <PolarAngleAxis dataKey="name" />
                <PolarRadiusAxis angle={90} domain={[0, 5]} />
                <Radar name="Engagement Rate" dataKey="engagement" stroke="#667eea" fill="#667eea" fillOpacity={0.6} />
                <Legend />
                <Tooltip />
              </RadarChart>
            </ResponsiveContainer>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {platformComparison.map((platform, idx) => (
              <div key={idx} className="bg-white rounded-lg shadow-md p-6">
                <h3 className="text-lg font-bold text-gray-900 mb-4">{platform.name}</h3>
                <div className="space-y-3">
                  <div>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm font-semibold">Engagement Rate</span>
                      <span className="text-sm font-bold text-blue-600">{platform.engagement}%</span>
                    </div>
                    <div className="w-full bg-gray-200 rounded-full h-2">
                      <div className="bg-blue-600 h-2 rounded-full" style={{ width: `${platform.engagement * 20}%` }}></div>
                    </div>
                  </div>
                  <div className="text-sm text-gray-600">
                    <p>Reach: <strong>{platform.reach.toLocaleString()}</strong></p>
                    <p>Followers: <strong>{platform.followers.toLocaleString()}</strong></p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* AI Insights */}
      {activeTab === 'ai' && (
        <div className="space-y-4">
          <div className="bg-gradient-to-br from-purple-50 to-blue-50 rounded-lg p-6 border-l-4 border-purple-500">
            <h3 className="text-lg font-bold text-gray-900 mb-3">🚀 Performance Predictions</h3>
            <ul className="space-y-2 text-sm text-gray-700">
              <li>📈 Your next post will likely get 650-750 likes based on recent patterns</li>
              <li>📊 Best posting time is Wednesday 2-3 PM (EST) for maximum engagement</li>
              <li>💡 Video content performs 3.2x better than static images</li>
            </ul>
          </div>

          <div className="bg-gradient-to-br from-green-50 to-emerald-50 rounded-lg p-6 border-l-4 border-green-500">
            <h3 className="text-lg font-bold text-gray-900 mb-3">⭐ Repost Recommendations</h3>
            <ul className="space-y-2 text-sm text-gray-700">
              <li>🔄 Repost "How to build SaaS" on Twitter - it got 2.8K impressions on Instagram</li>
              <li>📌 Pin "Top tools 2024" on Pinterest - high save rate expected</li>
              <li>💬 Repurpose Q&A content as LinkedIn carousel posts</li>
            </ul>
          </div>

          <div className="bg-gradient-to-br from-orange-50 to-yellow-50 rounded-lg p-6 border-l-4 border-orange-500">
            <h3 className="text-lg font-bold text-gray-900 mb-3">💡 Content Suggestions</h3>
            <ul className="space-y-2 text-sm text-gray-700">
              <li>🎬 Create more short-form video content (Reels/TikTok) - trending up 24%</li>
              <li>🤝 Engagement increases with collaboration posts - try 1 per week</li>
              <li>❓ Audience engagement peaks with educational + entertainment mix</li>
            </ul>
          </div>
        </div>
      )}

      {/* Export */}
      {activeTab === 'export' && (
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">📥 Download Report</h3>
              <div className="space-y-2">
                <button className="w-full px-4 py-3 bg-red-100 text-red-700 rounded-lg font-semibold hover:bg-red-200 transition-colors flex items-center justify-center gap-2">
                  <Download size={18} /> PDF Report
                </button>
                <button className="w-full px-4 py-3 bg-green-100 text-green-700 rounded-lg font-semibold hover:bg-green-200 transition-colors flex items-center justify-center gap-2">
                  <Download size={18} /> CSV Export
                </button>
                <button className="w-full px-4 py-3 bg-blue-100 text-blue-700 rounded-lg font-semibold hover:bg-blue-200 transition-colors flex items-center justify-center gap-2">
                  <Download size={18} /> JSON Data
                </button>
              </div>
            </div>

            <div className="bg-white rounded-lg shadow-md p-6">
              <h3 className="text-lg font-bold text-gray-900 mb-4">🔗 Share Reports</h3>
              <div className="space-y-2">
                <button className="w-full px-4 py-3 bg-purple-100 text-purple-700 rounded-lg font-semibold hover:bg-purple-200 transition-colors flex items-center justify-center gap-2">
                  <Share2 size={18} /> Generate Share Link
                </button>
                <p className="text-xs text-gray-600 text-center mt-2">Link expires in 24 hours</p>
                <div className="bg-gray-50 p-3 rounded text-xs text-gray-700 break-all">
                  contentflow.io/share/report-abc123xyz
                </div>
              </div>
            </div>
          </div>

          <div className="bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg p-6 border-l-4 border-blue-500">
            <h3 className="text-lg font-bold text-gray-900 mb-3">📧 Scheduled Email Reports</h3>
            <div className="space-y-3">
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" defaultChecked className="w-4 h-4" />
                <span className="text-sm font-semibold text-gray-700">Daily summary (9 AM)</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" defaultChecked className="w-4 h-4" />
                <span className="text-sm font-semibold text-gray-700">Weekly detailed report (Monday 8 AM)</span>
              </label>
              <label className="flex items-center gap-3 cursor-pointer">
                <input type="checkbox" className="w-4 h-4" />
                <span className="text-sm font-semibold text-gray-700">Monthly comprehensive analysis</span>
              </label>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Analytics;
