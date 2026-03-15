import { useCallback, useEffect, useState } from 'react';
import {
  Plus,
  Settings,
  Clock,
  FileText,
  Activity,
  CheckCircle,
  XCircle,
  Trash2,
  Edit,
} from 'lucide-react';

type AutomationRule = {
  id: number;
  rule_name: string;
  trigger_type: 'post_published' | 'delayed' | 'evergreen';
  platforms: string[];
  delay_minutes: number;
  status: 'active' | 'inactive';
};

type PostingSchedule = {
  id: number;
  platform: string;
  times: string[];
  timezone: string;
};

type EvergreenPost = {
  id: number;
  post_id: number;
  interval_days: number;
  max_reposts: number;
  repost_count: number;
};

type CaptionTemplate = {
  id: number;
  platform: string;
  template_text: string;
};

type AutomationLog = {
  id: number;
  post_id: number;
  platform: string;
  action: string;
  status: 'success' | 'failed' | 'pending';
  created_at: string;
};

type AutomationTab = 'rules' | 'schedule' | 'evergreen' | 'templates' | 'logs';

const Automation = () => {
  const [activeTab, setActiveTab] = useState<AutomationTab>('rules');
  const [rules, setRules] = useState<AutomationRule[]>([]);
  const [schedules, setSchedules] = useState<PostingSchedule[]>([]);
  const [evergreenPosts, setEvergreenPosts] = useState<EvergreenPost[]>([]);
  const [templates, setTemplates] = useState<CaptionTemplate[]>([]);
  const [logs, setLogs] = useState<AutomationLog[]>([]);

  const fetchData = useCallback(async () => {
    try {
      const [rulesRes, schedulesRes, evergreenRes, templatesRes, logsRes] = await Promise.all([
        fetch('/api/automation/rules'),
        fetch('/api/automation/schedules'),
        fetch('/api/automation/evergreen'),
        fetch('/api/automation/templates'),
        fetch('/api/automation/logs'),
      ]);

      setRules(await rulesRes.json());
      setSchedules(await schedulesRes.json());
      setEvergreenPosts(await evergreenRes.json());
      setTemplates(await templatesRes.json());
      setLogs(await logsRes.json());
    } catch (error) {
      console.error('Failed to fetch automation data:', error);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const renderRules = () => (
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Automation Rules</h2>
        <button className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2">
          <Plus size={16} />
          Create Rule
        </button>
      </div>
      <div className="bg-white rounded-lg shadow">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left">Rule</th>
              <th className="px-4 py-2 text-left">Trigger</th>
              <th className="px-4 py-2 text-left">Platforms</th>
              <th className="px-4 py-2 text-left">Status</th>
              <th className="px-4 py-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rules.map(rule => (
              <tr key={rule.id} className="border-t">
                <td className="px-4 py-2">{rule.rule_name}</td>
                <td className="px-4 py-2">{rule.trigger_type}</td>
                <td className="px-4 py-2">{rule.platforms.join(', ')}</td>
                <td className="px-4 py-2">
                  <span className={`px-2 py-1 rounded ${rule.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-800'}`}>
                    {rule.status}
                  </span>
                </td>
                <td className="px-4 py-2 flex gap-2">
                  <button className="text-blue-600"><Edit size={16} /></button>
                  <button className="text-red-600"><Trash2 size={16} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderSchedule = () => (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Posting Schedule</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {['facebook', 'instagram', 'linkedin', 'twitter'].map(platform => (
          <div key={platform} className="bg-white p-4 rounded-lg shadow">
            <h3 className="font-medium capitalize mb-2">{platform}</h3>
            <div className="space-y-2">
              {schedules.find(s => s.platform === platform)?.times.map((time, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <Clock size={16} />
                  <span>{time}</span>
                </div>
              )) || <span className="text-gray-500">No schedule set</span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );

  const renderEvergreen = () => (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Evergreen Automation</h2>
      <div className="bg-white rounded-lg shadow">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left">Post</th>
              <th className="px-4 py-2 text-left">Interval</th>
              <th className="px-4 py-2 text-left">Reposts Remaining</th>
            </tr>
          </thead>
          <tbody>
            {evergreenPosts.map(post => (
              <tr key={post.id} className="border-t">
                <td className="px-4 py-2">Post #{post.post_id}</td>
                <td className="px-4 py-2">{post.interval_days} days</td>
                <td className="px-4 py-2">{post.max_reposts - post.repost_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderTemplates = () => (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Caption Templates</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {['facebook', 'instagram', 'linkedin', 'twitter'].map(platform => {
          const template = templates.find(t => t.platform === platform);
          return (
            <div key={platform} className="bg-white p-4 rounded-lg shadow">
              <h3 className="font-medium capitalize mb-2">{platform}</h3>
              <textarea
                className="w-full p-2 border rounded"
                rows={4}
                placeholder="Enter template..."
                defaultValue={template?.template_text || ''}
              />
            </div>
          );
        })}
      </div>
    </div>
  );

  const renderLogs = () => (
    <div className="space-y-4">
      <h2 className="text-xl font-semibold">Automation Logs</h2>
      <div className="bg-white rounded-lg shadow">
        <table className="w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left">Time</th>
              <th className="px-4 py-2 text-left">Post</th>
              <th className="px-4 py-2 text-left">Platform</th>
              <th className="px-4 py-2 text-left">Action</th>
              <th className="px-4 py-2 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {logs.map(log => (
              <tr key={log.id} className="border-t">
                <td className="px-4 py-2">{new Date(log.created_at).toLocaleString()}</td>
                <td className="px-4 py-2">Post #{log.post_id}</td>
                <td className="px-4 py-2">{log.platform}</td>
                <td className="px-4 py-2">{log.action}</td>
                <td className="px-4 py-2">
                  {log.status === 'success' && <CheckCircle className="text-green-600" size={16} />}
                  {log.status === 'failed' && <XCircle className="text-red-600" size={16} />}
                  {log.status === 'pending' && <Clock className="text-yellow-600" size={16} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Post Automation</h1>
        <p className="text-gray-600">Manage automated posting rules and schedules</p>
      </div>

      <div className="mb-6">
        <nav className="flex space-x-1 bg-gray-100 p-1 rounded-lg">
          {[
            { id: 'rules', label: 'Rules', icon: Settings },
            { id: 'schedule', label: 'Schedule', icon: Clock },
            { id: 'evergreen', label: 'Evergreen', icon: FileText },
            { id: 'templates', label: 'Templates', icon: FileText },
            { id: 'logs', label: 'Logs', icon: Activity },
          ].map(tab => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id as AutomationTab)}
              className={`flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium ${
                activeTab === tab.id
                  ? 'bg-white text-gray-900 shadow'
                  : 'text-gray-600 hover:text-gray-900'
              }`}
            >
              <tab.icon size={16} />
              {tab.label}
            </button>
          ))}
        </nav>
      </div>

      {activeTab === 'rules' && renderRules()}
      {activeTab === 'schedule' && renderSchedule()}
      {activeTab === 'evergreen' && renderEvergreen()}
      {activeTab === 'templates' && renderTemplates()}
      {activeTab === 'logs' && renderLogs()}
    </div>
  );
};

export default Automation;