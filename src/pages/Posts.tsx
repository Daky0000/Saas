import { useState } from 'react';
import { Plus, Eye, Share2, Trash2, Users, Clock, Zap, Wand2, Hash, TrendingUp, Upload, Image, Video, CheckCircle, Copy, Calendar, AlertCircle, Instagram, Linkedin, Facebook, Music } from 'lucide-react';
import RichTextEditor from '../components/RichTextEditor';

const Posts = () => {
  const [activeTab, setActiveTab] = useState<'published' | 'drafts' | 'schedule' | 'media' | 'editor'>('published');
  const [showEditor, setShowEditor] = useState(false);
  const [editorMode, setEditorMode] = useState<'create' | 'edit'>('create');

  // Editor state
  const [postContent, setPostContent] = useState('');
  const [postTitle, setPostTitle] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<string[]>(['Instagram']);
  const [scheduledTime, setScheduledTime] = useState('');
  const [selectedMedia, setSelectedMedia] = useState<any[]>([]);
  const [previewPlatform, setPreviewPlatform] = useState<string>('Instagram');

  const publishedPosts = [
    {
      id: 1,
      title: 'How to build a successful SaaS product',
      platforms: ['Instagram', 'LinkedIn', 'Twitter'],
      engagement: 2847,
      views: 12400,
      date: '2024-01-15',
      thumbnail: '📱',
      seoScore: 92,
      wordCount: 450,
    },
    {
      id: 2,
      title: 'Top 5 content creation tools for 2024',
      platforms: ['Twitter', 'Facebook'],
      engagement: 1923,
      views: 8932,
      date: '2024-01-12',
      thumbnail: '🎨',
      seoScore: 87,
      wordCount: 380,
    },
    {
      id: 3,
      title: 'The future of AI in marketing',
      platforms: ['LinkedIn', 'Twitter'],
      engagement: 3421,
      views: 15200,
      date: '2024-01-10',
      thumbnail: '🤖',
      seoScore: 95,
      wordCount: 520,
    },
  ];

  const draftPosts = [
    {
      id: 1,
      title: 'Growth hacking strategies for startups',
      lastModified: '2 hours ago',
      platforms: ['LinkedIn'],
      wordCount: 280,
      version: 3,
      thumbnail: '🚀',
    },
    {
      id: 2,
      title: 'Social media trends Q1 2024',
      lastModified: '5 hours ago',
      platforms: ['Twitter', 'Instagram'],
      wordCount: 420,
      version: 5,
      thumbnail: '📊',
    },
  ];

  const scheduledPosts = [
    {
      id: 1,
      title: 'Best practices for email marketing',
      scheduledFor: '2024-01-20 10:00 AM',
      platforms: ['LinkedIn', 'Facebook'],
      thumbnail: '📧',
      timezone: 'EST',
      recurring: false,
    },
    {
      id: 2,
      title: 'Weekly roundup: Tech news edition',
      scheduledFor: '2024-01-21 2:00 PM',
      platforms: ['Twitter'],
      thumbnail: '📰',
      timezone: 'EST',
      recurring: true,
    },
  ];

  const mediaLibraryItems = [
    { id: 1, name: 'SaaS dashboard.jpg', type: 'image', size: '2.4 MB', date: '2024-01-15' },
    { id: 2, name: 'Product demo.mp4', type: 'video', size: '45.2 MB', date: '2024-01-14' },
    { id: 3, name: 'Loading animation.gif', type: 'gif', size: '1.8 MB', date: '2024-01-13' },
    { id: 4, name: 'Team photo.jpg', type: 'image', size: '3.1 MB', date: '2024-01-12' },
  ];

  const platforms = [
    { name: 'Instagram', color: 'bg-pink-100 text-pink-700', icon: Instagram },
    { name: 'Twitter', color: 'bg-blue-100 text-blue-700', icon: Copy },
    { name: 'LinkedIn', color: 'bg-blue-900 text-white', icon: Linkedin },
    { name: 'Facebook', color: 'bg-blue-100 text-blue-700', icon: Facebook },
    { name: 'TikTok', color: 'bg-black text-white', icon: Music },
  ];

  const aiTools = [
    { icon: Wand2, label: 'AI Rewrite', description: 'Rewrite with different tone' },
    { icon: Zap, label: 'Content Ideas', description: 'Generate 5 new ideas' },
    { icon: TrendingUp, label: 'SEO Assistant', description: 'Optimize for search' },
    { icon: Hash, label: 'Hashtags', description: 'Suggest trending hashtags' },
  ];

  const tabs = [
    { id: 'published', label: 'Published', count: 24 },
    { id: 'drafts', label: 'Drafts', count: 8 },
    { id: 'schedule', label: 'Scheduled', count: 5 },
    { id: 'media', label: 'Media Library', count: 12 },
  ];

  return (
    <div className="space-y-6 pb-8">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-4xl font-bold text-gray-900 mb-2">Content Studio</h1>
          <p className="text-gray-600">Your complete production floor for creating, managing and publishing posts</p>
        </div>
        <button
          onClick={() => {
            setShowEditor(true);
            setEditorMode('create');
            setPostContent('');
            setPostTitle('');
            setSelectedMedia([]);
          }}
          className="flex items-center gap-2 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-xl font-semibold hover:shadow-lg transition-all"
        >
          <Plus size={20} /> Create New Post
        </button>
      </div>

      {/* Post Creation Modal */}
      {showEditor && (
        <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-5xl max-h-[90vh] overflow-y-auto">
            {/* Modal Header */}
            <div className="bg-white border-b border-gray-200 p-6 flex items-center justify-between">
              <h2 className="text-2xl font-bold text-gray-900">{editorMode === 'create' ? 'Create Post' : 'Edit Post'}</h2>
              <button
                onClick={() => setShowEditor(false)}
                className="text-gray-500 hover:text-gray-700 text-2xl"
              >
                ×
              </button>
            </div>

            <div className="p-6 space-y-6">
              {/* Post Title & Character Count */}
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">Post Title</label>
                  <input
                    type="text"
                    value={postTitle}
                    onChange={(e) => setPostTitle(e.target.value)}
                    placeholder="Enter post title..."
                    className="w-full px-4 py-3 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                  <div className="flex items-center gap-2 mt-2">
                    <p className={`text-xs font-medium ${postTitle.length > 60 ? 'text-red-600' : 'text-gray-600'}`}>
                      {postTitle.length} characters
                    </p>
                    {postTitle.length > 60 && (
                      <div className="relative group">
                        <AlertCircle size={16} className="text-red-600 cursor-help" />
                        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 md:left-full md:-translate-x-0 md:top-1/2 md:-translate-y-1/2 md:ml-2 md:mt-0 px-3 py-2 bg-gray-900 text-white text-xs rounded-lg whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
                          Title exceeds 60 characters. It is not a good SEO practice
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* WYSIWYG Editor */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">Description</label>
                  <RichTextEditor 
                    value={postContent} 
                    onChange={setPostContent}
                  />

                  {/* Description Stats */}
                  <div className="mt-3 p-3 bg-gray-50 rounded-lg border border-gray-200">
                    <div>
                      <p className="text-sm font-semibold text-gray-900">Description Stats</p>
                      <p className="text-xs text-gray-600 mt-1">
                        Words: <span className="font-bold text-blue-600">{postContent.split(/\s+/).filter(Boolean).length}</span>
                        {' '} | Characters: <span className="font-bold text-blue-600">{postContent.length}</span>
                        {' '} | Paragraphs: <span className="font-bold text-blue-600">{postContent.split('\n\n').filter(Boolean).length}</span>
                      </p>
                    </div>
                  </div>
                </div>

                {/* Featured Image */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">Featured Image</label>
                  <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center hover:border-blue-500 hover:bg-blue-50 transition-all cursor-pointer">
                    <div className="flex justify-center gap-4 mb-3">
                      <Upload size={24} className="text-gray-400" />
                      <Image size={24} className="text-gray-400" />
                      <Video size={24} className="text-gray-400" />
                    </div>
                    <p className="text-sm text-gray-600">Drag & drop images, videos, or GIFs here</p>
                    <p className="text-xs text-gray-500 mt-1">Supports JPG, PNG, MP4, GIF (Max 100MB)</p>
                  </div>
                  {selectedMedia.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {selectedMedia.map((media, idx) => (
                        <div key={idx} className="flex items-center gap-3 p-2 bg-gray-50 rounded-lg">
                          <Image size={16} />
                          <span className="text-sm text-gray-700 flex-1">{media.name}</span>
                          <button className="text-gray-400 hover:text-red-600">×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* AI Tools */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-3">AI Tools</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {aiTools.map((tool, idx) => {
                      const IconComponent = tool.icon;
                      return (
                        <button
                          key={idx}
                          className="flex flex-col items-center gap-2 p-3 border border-gray-200 rounded-lg hover:bg-blue-50 hover:border-blue-300 transition-all"
                        >
                          <IconComponent size={20} className="text-blue-600" />
                          <span className="text-xs font-semibold text-gray-900">{tool.label}</span>
                          <span className="text-xs text-gray-600">{tool.description}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Tone Selector */}

                {/* SEO & Hashtags */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-2">
                      <TrendingUp className="inline mr-1" size={16} /> SEO Score
                    </label>
                    <div className="flex items-center gap-3">
                      <div className="flex-1 bg-gray-200 rounded-full h-3">
                        <div className="bg-green-500 h-3 rounded-full w-2/3"></div>
                      </div>
                      <span className="font-bold text-green-600">92</span>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-900 mb-2">
                      <Hash className="inline mr-1" size={16} /> Hashtag Suggestions
                    </label>
                    <div className="flex flex-wrap gap-2">
                      {['#ContentMarketing', '#SaaS', '#Growth'].map(tag => (
                        <button
                          key={tag}
                          className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold hover:bg-blue-200"
                        >
                          {tag}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Media Upload */}

                {/* Platform Selection */}
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <label className="block text-sm font-semibold text-gray-900">Publish To</label>
                    <button
                      onClick={() => {
                        if (selectedPlatforms.length === platforms.length) {
                          setSelectedPlatforms([]);
                        } else {
                          setSelectedPlatforms(platforms.map(p => p.name));
                        }
                      }}
                      className="text-xs px-3 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 font-medium"
                    >
                      {selectedPlatforms.length === platforms.length ? 'Deselect All' : 'Select All'}
                    </button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
                    {platforms.map(platform => {
                      const PlatformIcon = platform.icon;
                      return (
                        <button
                          key={platform.name}
                          onClick={() => {
                            if (selectedPlatforms.includes(platform.name)) {
                              setSelectedPlatforms(selectedPlatforms.filter(p => p !== platform.name));
                            } else {
                              setSelectedPlatforms([...selectedPlatforms, platform.name]);
                            }
                          }}
                          className={`p-3 rounded-lg border-2 transition-all font-semibold flex flex-col items-center gap-2 ${
                            selectedPlatforms.includes(platform.name)
                              ? `${platform.color} border-blue-500`
                              : 'border-gray-200 text-gray-700 hover:border-gray-300'
                          }`}
                        >
                          <PlatformIcon size={24} />
                          {platform.name}
                        </button>
                      );
                    })}
                  </div>
                </div>

                {/* Scheduling */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    <Calendar size={16} className="inline mr-1" /> Schedule For
                  </label>
                  <input
                    type="datetime-local"
                    value={scheduledTime}
                    onChange={(e) => setScheduledTime(e.target.value)}
                    className="w-full px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>

                {/* Collaboration */}
                <div>
                  <label className="block text-sm font-semibold text-gray-900 mb-2">
                    <Users size={16} className="inline mr-1" /> Team Collaboration
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      placeholder="Invite team member..."
                      className="flex-1 px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                    <button className="px-4 py-2 bg-blue-100 text-blue-700 rounded-lg font-semibold hover:bg-blue-200">
                      Invite
                    </button>
                  </div>
                </div>

                {/* Preview */}
                {selectedPlatforms.length > 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                    <h3 className="font-semibold text-gray-900 mb-4">📱 Platform Preview</h3>
                    <div className="flex gap-2 mb-4 border-b border-gray-200 overflow-x-auto">
                      {selectedPlatforms.map(platform => (
                        <button
                          key={platform}
                          onClick={() => setPreviewPlatform(platform)}
                          className={`px-4 py-2 font-medium transition-all whitespace-nowrap ${
                            previewPlatform === platform
                              ? 'text-blue-600 border-b-2 border-blue-600'
                              : 'text-gray-600 hover:text-gray-900'
                          }`}
                        >
                          {platform}
                        </button>
                      ))}
                    </div>
                    
                    {/* Platform-specific previews */}
                    <div className="bg-white border border-gray-200 rounded-lg">
                      {previewPlatform === 'Instagram' && (
                        <div className="p-6">
                          <div className="bg-gray-900 text-white rounded-lg p-4 max-w-sm mx-auto">
                            <div className="flex items-center gap-2 mb-3 pb-3 border-b border-gray-700">
                              <div className="w-8 h-8 bg-gradient-to-br from-yellow-400 to-pink-600 rounded-full"></div>
                              <span className="font-semibold text-sm">@yourprofile</span>
                            </div>
                            <div className="mb-3 text-sm leading-relaxed">{postTitle || 'Post Title'}</div>
                            <div className="bg-gray-800 rounded-lg h-48 mb-3"></div>
                            <div className="flex gap-4 text-lg">❤️ 💬 📤</div>
                          </div>
                        </div>
                      )}
                      {previewPlatform === 'Twitter' && (
                        <div className="p-6">
                          <div className="bg-white border border-gray-300 rounded-lg p-4 max-w-sm mx-auto">
                            <div className="flex items-center gap-3 mb-3">
                              <div className="w-10 h-10 bg-blue-400 rounded-full"></div>
                              <div>
                                <div className="font-bold text-sm">Your Profile</div>
                                <div className="text-gray-500 text-xs">@yourprofile</div>
                              </div>
                            </div>
                            <div className="text-sm text-gray-900 mb-3">{postTitle || 'Post Title'}</div>
                            <div className="text-xs text-gray-500 mb-3">1 hour ago</div>
                            <div className="flex justify-between text-gray-500 text-xs gap-4">
                              <span>💬</span>
                              <span>🔄</span>
                              <span>❤️</span>
                              <span>📤</span>
                            </div>
                          </div>
                        </div>
                      )}
                      {previewPlatform === 'LinkedIn' && (
                        <div className="p-6">
                          <div className="bg-white border border-gray-300 rounded-lg p-4 max-w-sm mx-auto">
                            <div className="flex items-center gap-3 mb-3">
                              <div className="w-10 h-10 bg-blue-600 rounded-full"></div>
                              <div>
                                <div className="font-bold text-sm">Your Name</div>
                                <div className="text-gray-600 text-xs">Your Position • 1st</div>
                              </div>
                            </div>
                            <div className="text-gray-900 text-sm mb-3 leading-relaxed">{postTitle || 'Post Title'}</div>
                            <div className="bg-gray-200 rounded-lg h-40 mb-3"></div>
                            <div className="flex justify-between text-gray-600 text-sm">
                              <span>👍</span>
                              <span>💬</span>
                              <span>🔄</span>
                              <span>📤</span>
                            </div>
                          </div>
                        </div>
                      )}
                      {previewPlatform === 'Facebook' && (
                        <div className="p-6">
                          <div className="bg-white border border-gray-300 rounded-lg p-4 max-w-sm mx-auto">
                            <div className="flex items-center gap-2 mb-3 pb-3 border-b border-gray-200">
                              <div className="w-10 h-10 bg-blue-500 rounded-full"></div>
                              <div>
                                <div className="font-bold text-sm">Your Profile</div>
                                <div className="text-gray-500 text-xs">1 hour ago</div>
                              </div>
                            </div>
                            <div className="text-gray-900 text-sm mb-3">{postTitle || 'Post Title'}</div>
                            <div className="bg-gray-200 rounded-lg h-48 mb-3"></div>
                            <div className="flex gap-4 text-gray-600 text-sm border-t border-gray-200 pt-3">
                              <span>👍</span>
                              <span>💬</span>
                              <span>📤</span>
                            </div>
                          </div>
                        </div>
                      )}
                      {previewPlatform === 'TikTok' && (
                        <div className="p-6">
                          <div className="bg-black text-white rounded-lg p-4 max-w-sm mx-auto">
                            <div className="mb-4 text-sm leading-relaxed">{postTitle || 'Post Title'}</div>
                            <div className="bg-gray-800 rounded-lg h-60 mb-4 flex items-center justify-center">
                              <span className="text-4xl">🎥</span>
                            </div>
                            <div className="flex flex-col gap-4 text-right text-lg">
                              <span>❤️</span>
                              <span>💬</span>
                              <span>📤</span>
                              <span>🔖</span>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>

              {/* Modal Actions */}
              <div className="flex gap-3 pt-4 border-t border-gray-200">
                <button
                  onClick={() => setShowEditor(false)}
                  className="flex-1 px-6 py-3 border border-gray-300 rounded-lg font-semibold text-gray-700 hover:bg-gray-50"
                >
                  Save as Draft
                </button>
                <button
                  onClick={() => {
                    setShowEditor(false);
                    // Publish logic here
                  }}
                  className="flex-1 px-6 py-3 bg-gradient-to-r from-blue-600 to-purple-600 text-white rounded-lg font-semibold hover:shadow-lg"
                >
                  Publish Now
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-2 border-b border-gray-200 overflow-x-auto">
        {tabs.map(tab => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id as any)}
            className={`px-4 py-3 font-semibold border-b-2 whitespace-nowrap transition-colors ${
              activeTab === tab.id
                ? 'border-blue-600 text-blue-600'
                : 'border-transparent text-gray-600 hover:text-gray-900'
            }`}
          >
            {tab.label}
            {tab.count !== null && <span className="ml-2 bg-gray-200 text-gray-800 px-2 py-0.5 rounded-full text-xs">{tab.count}</span>}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      {activeTab === 'published' && (
        <div className="space-y-4">
          {publishedPosts.map(post => (
            <div key={post.id} className="bg-white rounded-xl shadow-card p-6 border border-gray-100 hover:shadow-md transition-all">
              <div className="flex gap-4">
                <div className="text-4xl">{post.thumbnail}</div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-gray-900 mb-2">{post.title}</h3>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {post.platforms.map(platform => (
                      <span key={platform} className="px-3 py-1 bg-blue-100 text-blue-700 rounded-full text-xs font-semibold">
                        {platform}
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-6 text-sm text-gray-600">
                    <div className="flex items-center gap-1">
                      <Eye size={16} />
                      <span>{post.views.toLocaleString()} views</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <Share2 size={16} />
                      <span>{post.engagement.toLocaleString()} engagement</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <TrendingUp size={16} className="text-green-600" />
                      <span className="text-green-600 font-semibold">SEO: {post.seoScore}</span>
                    </div>
                    <span className="text-gray-500">{post.date}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <button className="px-3 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm font-semibold hover:bg-blue-200">
                    <Copy size={16} className="inline mr-1" /> Duplicate
                  </button>
                  <button className="text-gray-400 hover:text-red-600 transition-colors">
                    <Trash2 size={20} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'drafts' && (
        <div className="space-y-4">
          {draftPosts.map(post => (
            <div key={post.id} className="bg-white rounded-xl shadow-card p-6 border border-gray-100 hover:shadow-md transition-all">
              <div className="flex gap-4">
                <div className="text-4xl">{post.thumbnail}</div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-gray-900 mb-2">{post.title}</h3>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {post.platforms.map(platform => (
                      <span key={platform} className="px-3 py-1 bg-purple-100 text-purple-700 rounded-full text-xs font-semibold">
                        {platform}
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-6 text-sm text-gray-600">
                    <span>Last modified: {post.lastModified}</span>
                    <span>{post.wordCount} words</span>
                    <span className="text-gray-500">v{post.version}</span>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <button className="px-3 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm font-semibold hover:bg-blue-200">
                    <CheckCircle size={16} className="inline mr-1" /> Continue
                  </button>
                  <button className="text-gray-400 hover:text-red-600 transition-colors">
                    <Trash2 size={20} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'schedule' && (
        <div className="space-y-4">
          {scheduledPosts.map(post => (
            <div key={post.id} className="bg-white rounded-xl shadow-card p-6 border border-gray-100 hover:shadow-md transition-all">
              <div className="flex gap-4">
                <div className="text-4xl">{post.thumbnail}</div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-gray-900 mb-2">{post.title}</h3>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {post.platforms.map(platform => (
                      <span key={platform} className="px-3 py-1 bg-green-100 text-green-700 rounded-full text-xs font-semibold">
                        {platform}
                      </span>
                    ))}
                  </div>
                  <div className="flex flex-wrap gap-6 text-sm text-gray-600">
                    <div className="flex items-center gap-1">
                      <Clock size={16} />
                      <span>{post.scheduledFor}</span>
                    </div>
                    <span className="bg-blue-100 text-blue-700 px-2 py-1 rounded text-xs font-semibold">{post.timezone}</span>
                    {post.recurring && <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded text-xs font-semibold">Recurring</span>}
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <button className="px-3 py-2 bg-blue-100 text-blue-700 rounded-lg text-sm font-semibold hover:bg-blue-200">
                    Edit
                  </button>
                  <button className="text-gray-400 hover:text-red-600 transition-colors">
                    <Trash2 size={20} />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'media' && (
        <div>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {mediaLibraryItems.map(item => (
              <div key={item.id} className="bg-white rounded-xl shadow-card p-4 border border-gray-100 hover:shadow-md transition-all group">
                <div className="w-full h-32 bg-gray-100 rounded-lg mb-3 flex items-center justify-center text-4xl">
                  {item.type === 'image' ? '🖼️' : item.type === 'video' ? '🎬' : '🎞️'}
                </div>
                <h3 className="font-semibold text-gray-900 text-sm mb-2 truncate">{item.name}</h3>
                <div className="text-xs text-gray-600 space-y-1 mb-3">
                  <p>{item.size}</p>
                  <p>{item.date}</p>
                </div>
                <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button className="flex-1 px-2 py-1 bg-blue-100 text-blue-700 rounded text-xs font-semibold hover:bg-blue-200">
                    Use
                  </button>
                  <button className="px-2 py-1 text-gray-400 hover:text-red-600">×</button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default Posts;
