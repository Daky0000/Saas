import { useState } from 'react';
import { Download, Share2 } from 'lucide-react';
import CardPreview from '../components/CardPreview';
import CardTemplateLibrary from '../components/CardTemplateLibrary';
import CardDesignAssistant from '../components/CardDesignAssistant';

interface CardDesign {
  aspectRatio: '1:1' | '4:5' | '16:9' | '9:16' | '3:4' | '2:3';
  width: number;
  layout: {
    padding: number;
    alignment: 'left' | 'center' | 'right';
  };
  typography: {
    font: string;
    size: number;
    weight: 400 | 500 | 600 | 700 | 800 | 900;
    spacing: number;
    lineHeight: 1.2 | 1.5 | 1.8;
    color: string;
  };
  background: {
    type: 'solid' | 'gradient' | 'image';
    color1: string;
    color2?: string;
    angle?: number;
    image?: string;
    blur: number;
    overlay: {
      enabled: boolean;
      color: string;
      opacity: number;
    };
  };
  branding: {
    logo: string;
    primaryColor: string;
    secondaryColor: string;
    showBranding: boolean;
  };
}

const normalizeCardDesign = (raw: any): CardDesign => {
  const base: CardDesign = {
    aspectRatio: '1:1',
    width: 800,
    layout: { padding: 40, alignment: 'center' },
    typography: {
      font: 'Poppins',
      size: 48,
      weight: 700,
      spacing: 2,
      lineHeight: 1.5,
      color: '#000000',
    },
    background: {
      type: 'gradient',
      color1: '#667eea',
      color2: '#764ba2',
      angle: 135,
      blur: 0,
      overlay: { enabled: false, color: '#000000', opacity: 0.5 },
    },
    branding: {
      logo: 'C',
      primaryColor: '#667eea',
      secondaryColor: '#764ba2',
      showBranding: true,
    },
  };

  const alignment = raw?.layout?.alignment || raw?.layouts?.textAlignment || base.layout.alignment;
  const type = raw?.background?.type || base.background.type;

  return {
    aspectRatio: raw?.aspectRatio || raw?.layouts?.aspectRatio || base.aspectRatio,
    width: Number(raw?.width) || base.width,
    layout: {
      padding: Number(raw?.layout?.padding ?? raw?.layouts?.padding) || base.layout.padding,
      alignment: ['left', 'center', 'right'].includes(alignment) ? alignment : base.layout.alignment,
    },
    typography: {
      font: raw?.typography?.font || raw?.typography?.fontFamily || base.typography.font,
      size: Number(raw?.typography?.size ?? raw?.typography?.fontSize) || base.typography.size,
      weight:
        (Number(raw?.typography?.weight ?? raw?.typography?.fontWeight) || base.typography.weight) as CardDesign['typography']['weight'],
      spacing: Number(raw?.typography?.spacing ?? raw?.typography?.letterSpacing) || base.typography.spacing,
      lineHeight:
        (Number(raw?.typography?.lineHeight) || base.typography.lineHeight) as CardDesign['typography']['lineHeight'],
      color: raw?.typography?.color || base.typography.color,
    },
    background: {
      type: ['solid', 'gradient', 'image'].includes(type) ? type : base.background.type,
      color1:
        raw?.background?.color1 || raw?.background?.solidColor || raw?.background?.gradientStart || base.background.color1,
      color2: raw?.background?.color2 || raw?.background?.gradientEnd || base.background.color2,
      angle: Number(raw?.background?.angle ?? raw?.background?.gradientAngle) || base.background.angle,
      image: raw?.background?.image || raw?.background?.imageUrl,
      blur: Number(raw?.background?.blur) || base.background.blur,
      overlay: {
        enabled: Boolean(raw?.background?.overlay?.enabled),
        color: raw?.background?.overlay?.color || raw?.background?.overlayColor || base.background.overlay.color,
        opacity: Number(raw?.background?.overlay?.opacity ?? raw?.background?.overlayOpacity) || base.background.overlay.opacity,
      },
    },
    branding: {
      logo: raw?.branding?.logo || base.branding.logo,
      primaryColor: raw?.branding?.primaryColor || raw?.branding?.colorPalette?.[0] || base.branding.primaryColor,
      secondaryColor: raw?.branding?.secondaryColor || raw?.branding?.colorPalette?.[1] || base.branding.secondaryColor,
      showBranding:
        typeof raw?.branding?.showBranding === 'boolean' ? raw.branding.showBranding : base.branding.showBranding,
    },
  };
};

const Cards = () => {
  const [activeTab, setActiveTab] = useState<'design' | 'customize' | 'templates' | 'collection'>('design');
  const [customizeTab, setCustomizeTab] = useState<'layout' | 'typography' | 'background' | 'branding' | 'ai'>('layout');
  
  const [cardDesign, setCardDesign] = useState<CardDesign>({
    aspectRatio: '1:1',
    width: 800,
    layout: { padding: 40, alignment: 'center' },
    typography: {
      font: 'Poppins',
      size: 48,
      weight: 700,
      spacing: 2,
      lineHeight: 1.5,
      color: '#000000',
    },
    background: {
      type: 'gradient',
      color1: '#667eea',
      color2: '#764ba2',
      angle: 135,
      blur: 0,
      overlay: { enabled: false, color: '#000000', opacity: 0.5 },
    },
    branding: {
      logo: '🎨',
      primaryColor: '#667eea',
      secondaryColor: '#764ba2',
      showBranding: true,
    },
  });

  const setNormalizedCardDesign = (next: any) => {
    setCardDesign((prev) => {
      const candidate = typeof next === 'function' ? next(prev) : next;
      return normalizeCardDesign(candidate);
    });
  };

  const tabs = [
    { id: 'design', label: 'Design' },
    { id: 'customize', label: 'Customize' },
    { id: 'templates', label: 'Templates' },
    { id: 'collection', label: 'Collection' },
  ];

  const aspectRatios = ['1:1', '4:5', '16:9', '9:16', '3:4', '2:3'];
  const fonts = ['Poppins', 'Inter', 'Playfair Display', 'Georgia', 'Montserrat', 'Roboto', 'Bebas Neue'];
  const weights = [400, 500, 600, 700, 800, 900];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-4xl font-black text-gray-900 mb-2">Cards</h1>
        <p className="text-gray-600">Visual content generator - Canva meets AI automation</p>
      </div>

      {/* Main Layout */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left: Preview */}
        <div className="lg:col-span-2">
          <div className="bg-white rounded-lg shadow-md p-6 sticky top-6">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-xl font-bold">Preview</h2>
              <div className="flex gap-2">
                <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                  <Download size={20} />
                </button>
                <button className="p-2 hover:bg-gray-100 rounded-lg transition-colors">
                  <Share2 size={20} />
                </button>
              </div>
            </div>
            <div className="bg-gray-900 rounded-lg p-8 flex items-center justify-center min-h-96">
              <CardPreview design={cardDesign as any} />
            </div>
          </div>
        </div>

        {/* Right: Controls */}
        <div className="bg-white rounded-lg shadow-md p-6">
          {/* Tab Navigation */}
          <div className="flex flex-col gap-2 mb-6">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-2 rounded-lg font-semibold transition-colors ${
                  activeTab === tab.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Tab Content */}
          {activeTab === 'design' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Aspect Ratio</label>
                <div className="grid grid-cols-2 gap-2">
                  {aspectRatios.map(ratio => (
                    <button
                      key={ratio}
                      onClick={() => setCardDesign({ ...cardDesign, aspectRatio: ratio as any })}
                      className={`px-3 py-2 rounded font-semibold text-sm transition-colors ${
                        cardDesign.aspectRatio === ratio
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                      }`}
                    >
                      {ratio}
                    </button>
                  ))}
                </div>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Width: {cardDesign.width}px
                </label>
                <input
                  type="range"
                  min="400"
                  max="1920"
                  step="50"
                  value={cardDesign.width}
                  onChange={e => setCardDesign({ ...cardDesign, width: parseInt(e.target.value) })}
                  className="w-full"
                />
              </div>
            </div>
          )}

          {activeTab === 'customize' && (
            <div>
              {/* Sub-tabs */}
              <div className="flex flex-col gap-2 mb-4">
                {(['layout', 'typography', 'background', 'branding', 'ai'] as const).map(tab => (
                  <button
                    key={tab}
                    onClick={() => setCustomizeTab(tab)}
                    className={`px-3 py-2 rounded text-sm font-semibold transition-colors ${
                      customizeTab === tab
                        ? 'bg-blue-100 text-blue-700'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              {/* Sub-tab Content */}
              {customizeTab === 'layout' && (
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-semibold text-gray-700">Padding: {cardDesign.layout.padding}px</label>
                    <input
                      type="range"
                      min="0"
                      max="100"
                      value={cardDesign.layout.padding}
                      onChange={e =>
                        setCardDesign({
                          ...cardDesign,
                          layout: { ...cardDesign.layout, padding: parseInt(e.target.value) },
                        })
                      }
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-gray-700">Alignment</label>
                    <div className="flex gap-2 mt-1">
                      {['left', 'center', 'right'].map(align => (
                        <button
                          key={align}
                          onClick={() =>
                            setCardDesign({
                              ...cardDesign,
                              layout: { ...cardDesign.layout, alignment: align as any },
                            })
                          }
                          className={`flex-1 px-2 py-1 rounded text-sm font-semibold ${
                            cardDesign.layout.alignment === align
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {align}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {customizeTab === 'typography' && (
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-semibold text-gray-700">Font</label>
                    <select
                      value={cardDesign.typography.font}
                      onChange={e =>
                        setCardDesign({
                          ...cardDesign,
                          typography: { ...cardDesign.typography, font: e.target.value },
                        })
                      }
                      className="w-full mt-1 px-2 py-1 border rounded"
                    >
                      {fonts.map(font => (
                        <option key={font} value={font}>
                          {font}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-gray-700">
                      Size: {cardDesign.typography.size}px
                    </label>
                    <input
                      type="range"
                      min="12"
                      max="120"
                      value={cardDesign.typography.size}
                      onChange={e =>
                        setCardDesign({
                          ...cardDesign,
                          typography: { ...cardDesign.typography, size: parseInt(e.target.value) },
                        })
                      }
                      className="w-full"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-gray-700">Weight</label>
                    <div className="grid grid-cols-2 gap-1 mt-1">
                      {weights.map(weight => (
                        <button
                          key={weight}
                          onClick={() =>
                            setCardDesign({
                              ...cardDesign,
                              typography: { ...cardDesign.typography, weight: weight as any },
                            })
                          }
                          className={`px-2 py-1 rounded text-xs font-semibold ${
                            cardDesign.typography.weight === weight
                              ? 'bg-blue-600 text-white'
                              : 'bg-gray-100 text-gray-700'
                          }`}
                        >
                          {weight}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              {customizeTab === 'background' && (
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-semibold text-gray-700">Type</label>
                    <select
                      value={cardDesign.background.type}
                      onChange={e =>
                        setCardDesign({
                          ...cardDesign,
                          background: { ...cardDesign.background, type: e.target.value as any },
                        })
                      }
                      className="w-full mt-1 px-2 py-1 border rounded"
                    >
                      <option value="solid">Solid</option>
                      <option value="gradient">Gradient</option>
                      <option value="image">Image</option>
                    </select>
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-gray-700">Primary Color</label>
                    <input
                      type="color"
                      value={cardDesign.background.color1}
                      onChange={e =>
                        setCardDesign({
                          ...cardDesign,
                          background: { ...cardDesign.background, color1: e.target.value },
                        })
                      }
                      className="w-full mt-1 h-8 cursor-pointer"
                    />
                  </div>
                  {cardDesign.background.type === 'gradient' && (
                    <div>
                      <label className="text-sm font-semibold text-gray-700">Secondary Color</label>
                      <input
                        type="color"
                        value={cardDesign.background.color2 || '#764ba2'}
                        onChange={e =>
                          setCardDesign({
                            ...cardDesign,
                            background: { ...cardDesign.background, color2: e.target.value },
                          })
                        }
                        className="w-full mt-1 h-8 cursor-pointer"
                      />
                    </div>
                  )}
                </div>
              )}

              {customizeTab === 'branding' && (
                <div className="space-y-3">
                  <div>
                    <label className="text-sm font-semibold text-gray-700">Primary Brand Color</label>
                    <input
                      type="color"
                      value={cardDesign.branding.primaryColor}
                      onChange={e =>
                        setCardDesign({
                          ...cardDesign,
                          branding: { ...cardDesign.branding, primaryColor: e.target.value },
                        })
                      }
                      className="w-full mt-1 h-8 cursor-pointer"
                    />
                  </div>
                  <div>
                    <label className="text-sm font-semibold text-gray-700">Secondary Brand Color</label>
                    <input
                      type="color"
                      value={cardDesign.branding.secondaryColor}
                      onChange={e =>
                        setCardDesign({
                          ...cardDesign,
                          branding: { ...cardDesign.branding, secondaryColor: e.target.value },
                        })
                      }
                      className="w-full mt-1 h-8 cursor-pointer"
                    />
                  </div>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={cardDesign.branding.showBranding}
                      onChange={e =>
                        setCardDesign({
                          ...cardDesign,
                          branding: { ...cardDesign.branding, showBranding: e.target.checked },
                        })
                      }
                    />
                    <span className="text-sm font-semibold">Show branding</span>
                  </label>
                </div>
              )}

              {customizeTab === 'ai' && (
                <div className="py-4">
                  <CardDesignAssistant cardDesign={cardDesign} setCardDesign={setNormalizedCardDesign} />
                </div>
              )}
            </div>
          )}

          {activeTab === 'templates' && <CardTemplateLibrary setCardDesign={setNormalizedCardDesign} />}

          {activeTab === 'collection' && (
            <div className="text-center py-8">
              <p className="text-gray-600 mb-4">Your saved designs</p>
              <button className="w-full px-4 py-2 bg-blue-600 text-white rounded-lg font-semibold hover:bg-blue-700 transition-colors">
                Create New Collection
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Cards;
