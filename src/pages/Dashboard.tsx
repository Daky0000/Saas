import { BarChart3, FileText, Link2, Palette, TrendingUp } from 'lucide-react';
import { AppUser } from '../utils/userSession';

type DashboardProps = {
  currentUser: AppUser | null;
};

const summaryCards = [
  { label: 'Total Posts', value: '847', icon: FileText, color: 'text-blue-600', bg: 'bg-blue-50' },
  { label: 'Connected Accounts', value: '5', icon: Link2, color: 'text-green-600', bg: 'bg-green-50' },
  { label: 'Card Designs', value: '112', icon: Palette, color: 'text-purple-600', bg: 'bg-purple-50' },
  { label: 'Weekly Growth', value: '+12%', icon: TrendingUp, color: 'text-orange-600', bg: 'bg-orange-50' },
];

const quickActions = [
  'Create a new post',
  'Design a card',
  'Connect a social platform',
  'Check analytics trends',
];

function Dashboard({ currentUser }: DashboardProps) {
  const preferredName =
    currentUser?.name?.trim() || currentUser?.username?.trim() || currentUser?.email.split('@')[0] || '';

  return (
    <div className="space-y-8 pb-8">
      <div>
        <h1 className="text-4xl font-bold text-gray-900">Dashboard</h1>
        <p className="text-gray-600 mt-2">
          {preferredName ? (
            <>
              Welcome back, <span className="font-bold text-gray-900">{preferredName}</span>.
            </>
          ) : (
            'Welcome back.'
          )}
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        {summaryCards.map((card) => {
          const IconComponent = card.icon;
          return (
            <div key={card.label} className="bg-white border border-gray-200 rounded-xl p-5 shadow-sm">
              <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${card.bg}`}>
                <IconComponent size={20} className={card.color} />
              </div>
              <p className="text-sm text-gray-600 mt-3">{card.label}</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">{card.value}</p>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <section className="xl:col-span-2 bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <div className="flex items-center gap-2 mb-4">
            <BarChart3 className="text-blue-600" size={20} />
            <h2 className="text-xl font-bold text-gray-900">Performance Highlights</h2>
          </div>
          <ul className="space-y-3 text-gray-700">
            <li className="p-3 rounded-lg bg-gray-50 border border-gray-100">
              Your Instagram engagement grew by 8.4% this week.
            </li>
            <li className="p-3 rounded-lg bg-gray-50 border border-gray-100">
              Posts published between 7PM and 9PM performed best.
            </li>
            <li className="p-3 rounded-lg bg-gray-50 border border-gray-100">
              Carousel content got 34% more interactions than single-image posts.
            </li>
          </ul>
        </section>

        <section className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
          <h2 className="text-xl font-bold text-gray-900 mb-4">Quick Actions</h2>
          <ul className="space-y-2">
            {quickActions.map((action) => (
              <li key={action} className="px-3 py-2 rounded-lg bg-gray-50 text-gray-700 border border-gray-100">
                {action}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

export default Dashboard;
