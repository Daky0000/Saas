import { TrendingUp, ArrowUpRight, Plus, Zap, Link2, FileText, Palette, Eye, Heart, Clock, BarChart3 } from 'lucide-react';
import { LineChart, Line, AreaChart, Area, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

const Dashboard = () => {
  // Data for charts
  const viewsData = [
    { day: 'Mon', views: 4000 },
    { day: 'Tue', views: 3000 },
    { day: 'Wed', views: 4500 },
    { day: 'Thu', views: 5200 },
    { day: 'Fri', views: 6100 },
    { day: 'Sat', views: 4900 },
    { day: 'Sun', views: 3800 },
  ];

  const engagementData = [
    { month: 'Jan', engagement: 2400 },
    { month: 'Feb', engagement: 2210 },
    { month: 'Mar', engagement: 2290 },
    { month: 'Apr', engagement: 2000 },
    { month: 'May', engagement: 2181 },
    { month: 'Jun', engagement: 2500 },
  ];

  const platformData = [
    { name: 'Instagram', value: 35, color: '#E4405F' },
    { name: 'Twitter', value: 25, color: '#1DA1F2' },
    { name: 'LinkedIn', value: 20, color: '#0A66C2' },
    { name: 'Facebook', value: 15, color: '#1877F2' },
    { name: 'TikTok', value: 5, color: '#000000' },
  ];

  const postFrequency = [
    { day: 'Sun', posts: 3 },
    { day: 'Mon', posts: 5 },
    { day: 'Tue', posts: 4 },
    { day: 'Wed', posts: 6 },
    { day: 'Thu', posts: 7 },
    { day: 'Fri', posts: 2 },
    { day: 'Sat', posts: 1 },
  ];

  // Performance snapshot data
  const performanceMetrics = [
    { label: 'Total Posts', value: '847', icon: FileText, bg: 'bg-blue-50', iconColor: 'text-blue-600' },
    { label: 'Published', value: '723', icon: Eye, bg: 'bg-green-50', iconColor: 'text-green-600' },
    { label: 'Drafts', value: '98', icon: Palette, bg: 'bg-yellow-50', iconColor: 'text-yellow-600' },
    { label: 'Scheduled', value: '26', icon: Clock, bg: 'bg-purple-50', iconColor: 'text-purple-600' },
    { label: 'Total Views', value: '542K', icon: Eye, bg: 'bg-indigo-50', iconColor: 'text-indigo-600' },
    { label: 'Total Likes', value: '28.5K', icon: Heart, bg: 'bg-red-50', iconColor: 'text-red-600' },
    { label: 'Engagement Rate', value: '5.2%', icon: TrendingUp, bg: 'bg-cyan-50', iconColor: 'text-cyan-600' },
    { label: 'Growth (Weekly)', value: '+12%', icon: ArrowUpRight, bg: 'bg-teal-50', iconColor: 'text-teal-600' },
  ];

  // Quick actions
  const quickActions = [
    { label: 'Create New Post', icon: Plus, color: 'bg-blue-600 hover:bg-blue-700', textColor: 'text-white' },
    { label: 'Generate Card', icon: Palette, color: 'bg-purple-600 hover:bg-purple-700', textColor: 'text-white' },
    { label: 'View Analytics', icon: BarChart3, color: 'bg-green-600 hover:bg-green-700', textColor: 'text-white' },
    { label: 'Connect Platform', icon: Link2, color: 'bg-orange-600 hover:bg-orange-700', textColor: 'text-white' },
  ];

  // AI Insights
  const aiInsights = [
    { 
      icon: '📉', 
      title: 'Instagram Alert', 
      description: 'Your Instagram engagement dropped 12% this week', 
      severity: 'warning',
      action: 'View Details' 
    },
    { 
      icon: '🎯', 
      title: 'Content Performance', 
      description: 'Your long-form posts perform 34% better than average', 
      severity: 'success',
      action: 'Learn More' 
    },
    { 
      icon: '⏰', 
      title: 'Optimal Posting Time', 
      description: '7PM – 9PM is your best time to post for maximum engagement',
      severity: 'info',
      action: 'Schedule Now' 
    },
  ];

  // Activity feed with more types
  const activities = [
    { id: 1, type: 'post', icon: FileText, title: 'Post published', description: 'Your "Growth Marketing Tips" post went live', time: '2 hours ago' },
    { id: 2, type: 'card', icon: Palette, title: 'Card edited', description: 'Updated design for summer campaign card', time: '4 hours ago' },
    { id: 3, type: 'platform', icon: Link2, title: 'Platform connected', description: 'Successfully connected LinkedIn account', time: '1 day ago' },
    { id: 4, type: 'auto', icon: Zap, title: 'Auto-post triggered', description: 'Scheduled post published automatically', time: '2 days ago' },
    { id: 5, type: 'post', icon: FileText, title: 'Post published', description: 'Weekly newsletter sent to 5.2K subscribers', time: '3 days ago' },
  ];

  const bestPerformingPlatform = {
    name: 'Instagram',
    engagement: '8.4%',
    change: '+2.3%',
    color: '#E4405F'
  };

  return (
    <div className="space-y-8 pb-8">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-4xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-2">Welcome back! Here's your complete performance overview.</p>
      </div>

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {quickActions.map((action, idx) => {
          const IconComponent = action.icon;
          return (
            <button
              key={idx}
              className={`${action.color} ${action.textColor} rounded-xl py-4 px-6 font-semibold flex items-center gap-3 transition-all duration-200 shadow-sm hover:shadow-md`}
            >
              <IconComponent size={20} />
              <span>{action.label}</span>
            </button>
          );
        })}
      </div>

      {/* Performance Snapshot */}
      <div>
        <h2 className="text-2xl font-bold text-gray-900 mb-6">Performance Snapshot</h2>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {performanceMetrics.map((metric, idx) => {
            const IconComponent = metric.icon;
            return (
              <div key={idx} className={`${metric.bg} border border-gray-200 rounded-xl p-5 shadow-sm hover:shadow-card transition-all duration-300`}>
                <div className="flex items-start justify-between mb-3">
                  <div className={`w-10 h-10 ${metric.bg} rounded-lg flex items-center justify-center`}>
                    <IconComponent size={20} className={metric.iconColor} />
                  </div>
                </div>
                <p className="text-gray-600 text-xs font-medium mb-1">{metric.label}</p>
                <p className="text-2xl font-bold text-gray-900">{metric.value}</p>
              </div>
            );
          })}
        </div>
      </div>

      {/* Best Performing Post */}
      <div className="bg-white rounded-xl shadow-card p-6 border border-gray-100">
        <h2 className="text-lg font-bold text-gray-900 mb-4">Best Performing Post</h2>
        <div className="flex items-start gap-4 p-4 bg-gradient-to-r from-blue-50 to-purple-50 rounded-lg border border-blue-200">
          <div className="w-16 h-16 bg-gradient-to-br from-blue-400 to-purple-400 rounded-lg flex-shrink-0"></div>
          <div className="flex-1">
            <h3 className="font-semibold text-gray-900">How to Scale Your SaaS Business</h3>
            <p className="text-sm text-gray-600 mt-1">Posted 5 days ago on Instagram</p>
            <div className="flex gap-6 mt-3">
              <div><p className="text-xs text-gray-600">Views</p><p className="font-bold text-gray-900">12.4K</p></div>
              <div><p className="text-xs text-gray-600">Likes</p><p className="font-bold text-gray-900">1.2K</p></div>
              <div><p className="text-xs text-gray-600">Engagement</p><p className="font-bold text-gray-900">9.7%</p></div>
            </div>
          </div>
        </div>
      </div>

      {/* Charts Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Views Trend */}
        <div className="bg-white rounded-xl shadow-card p-6 border border-gray-100">
          <h2 className="text-lg font-bold text-gray-900 mb-6">Views Trend</h2>
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={viewsData}>
              <defs>
                <linearGradient id="colorViews" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#0284c7" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#0284c7" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="day" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }} />
              <Area type="monotone" dataKey="views" stroke="#0284c7" strokeWidth={2} fillOpacity={1} fill="url(#colorViews)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>

        {/* Engagement Trend */}
        <div className="bg-white rounded-xl shadow-card p-6 border border-gray-100">
          <div className="flex items-center justify-between mb-6">
            <h2 className="text-lg font-bold text-gray-900">Engagement Trend</h2>
            <select className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white cursor-pointer">
              <option>Last 6 months</option>
              <option>Last 3 months</option>
              <option>Last month</option>
            </select>
          </div>
          <ResponsiveContainer width="100%" height={280}>
            <LineChart data={engagementData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="month" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }} cursor={{ stroke: '#e5e7eb' }} />
              <Line type="monotone" dataKey="engagement" stroke="#7c3aed" strokeWidth={3} dot={{ fill: '#7c3aed', r: 5 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>

        {/* Platform Breakdown */}
        <div className="bg-white rounded-xl shadow-card p-6 border border-gray-100">
          <h2 className="text-lg font-bold text-gray-900 mb-6">Platform Breakdown</h2>
          <ResponsiveContainer width="100%" height={280}>
            <PieChart>
              <Pie data={platformData} cx="50%" cy="50%" labelLine={false} outerRadius={90} fill="#8884d8" dataKey="value">
                {platformData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="mt-6 grid grid-cols-2 gap-3">
            {platformData.map((item, idx) => (
              <div key={idx} className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full" style={{ backgroundColor: item.color }}></div>
                <span className="text-sm text-gray-600">{item.name}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Post Frequency */}
        <div className="bg-white rounded-xl shadow-card p-6 border border-gray-100">
          <h2 className="text-lg font-bold text-gray-900 mb-6">Post Frequency</h2>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={postFrequency}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="day" stroke="#9ca3af" />
              <YAxis stroke="#9ca3af" />
              <Tooltip contentStyle={{ backgroundColor: '#fff', border: '1px solid #e5e7eb', borderRadius: '8px' }} />
              <Bar dataKey="posts" fill="#0ea5e9" radius={[8, 8, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Best Performing Platform & AI Insights Row */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Best Performing Platform */}
        <div className="bg-white rounded-xl shadow-card p-6 border border-gray-100">
          <h2 className="text-lg font-bold text-gray-900 mb-6">Best Performing Platform</h2>
          <div className="text-center">
            <div 
              className="w-16 h-16 rounded-full mx-auto mb-4 flex items-center justify-center text-2xl"
              style={{ backgroundColor: bestPerformingPlatform.color + '20', color: bestPerformingPlatform.color }}
            >
              📱
            </div>
            <h3 className="text-2xl font-bold text-gray-900">{bestPerformingPlatform.name}</h3>
            <p className="text-3xl font-bold text-gray-900 mt-2">{bestPerformingPlatform.engagement}</p>
            <p className="text-green-600 text-sm font-semibold mt-2">
              <ArrowUpRight className="inline" size={14} /> {bestPerformingPlatform.change}
            </p>
          </div>
        </div>

        {/* AI Insights Panel */}
        <div className="lg:col-span-2">
          <h2 className="text-lg font-bold text-gray-900 mb-6">🤖 AI Insights</h2>
          <div className="space-y-3">
            {aiInsights.map((insight, idx) => {
              const severityColors: Record<string, string> = {
                warning: 'bg-yellow-50 border-yellow-200',
                success: 'bg-green-50 border-green-200',
                info: 'bg-blue-50 border-blue-200',
              };
              return (
                <div key={idx} className={`${severityColors[insight.severity]} border rounded-lg p-4`}>
                  <div className="flex items-start justify-between">
                    <div className="flex items-start gap-3 flex-1">
                      <span className="text-2xl mt-1">{insight.icon}</span>
                      <div>
                        <h3 className="font-semibold text-gray-900">{insight.title}</h3>
                        <p className="text-sm text-gray-600 mt-1">{insight.description}</p>
                      </div>
                    </div>
                    <button className="text-xs font-semibold px-3 py-1 bg-white rounded-lg whitespace-nowrap ml-2 hover:opacity-80">
                      {insight.action}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Activity Feed */}
      <div className="bg-white rounded-xl shadow-card p-6 border border-gray-100">
        <h2 className="text-lg font-bold text-gray-900 mb-6">Activity Feed</h2>
        <div className="space-y-3">
          {activities.map(activity => {
            const IconComponent = activity.icon;
            const typeColors: Record<string, string> = {
              post: 'bg-blue-100 text-blue-600',
              card: 'bg-purple-100 text-purple-600',
              platform: 'bg-green-100 text-green-600',
              auto: 'bg-yellow-100 text-yellow-600',
            };
            return (
              <div key={activity.id} className="flex items-start gap-4 p-4 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors">
                <div className={`w-10 h-10 ${typeColors[activity.type]} rounded-lg flex items-center justify-center flex-shrink-0`}>
                  <IconComponent size={18} />
                </div>
                <div className="flex-1">
                  <p className="text-gray-900 font-medium">{activity.title}</p>
                  <p className="text-sm text-gray-600 mt-1">{activity.description}</p>
                  <p className="text-xs text-gray-500 mt-2">{activity.time}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
