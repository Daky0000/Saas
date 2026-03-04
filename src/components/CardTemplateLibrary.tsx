import { Layout } from 'lucide-react';
import { Dispatch, SetStateAction } from 'react';

interface CardTemplateLibraryProps {
  setCardDesign: Dispatch<SetStateAction<any>>;
}

const CardTemplateLibrary = ({ setCardDesign }: CardTemplateLibraryProps) => {
  const templates = [
    {
      id: 'quote',
      name: 'Quote Card',
      description: 'Inspiring quote design',
      preview: {
        title: 'Leadership is about minimizing resistance',
        content: 'Try to realize the truth, there is no spoon',
        layouts: { aspectRatio: '1:1', padding: 30, textAlignment: 'center' },
        background: {
          type: 'gradient',
          solidColor: '#ffffff',
          gradientStart: '#667eea',
          gradientEnd: '#764ba2',
          gradientAngle: 135,
          imageUrl: '',
          overlayColor: '#000000',
          overlayOpacity: 0.3,
        },
        typography: { fontFamily: 'Playfair', fontSize: 32, fontWeight: 700, letterSpacing: 0, lineHeight: 1.4 },
        branding: { logoUrl: '', colorPalette: ['#667eea', '#764ba2', '#f093fb', '#4facfe'], fontSet: ['Playfair', 'Inter'] },
      },
    },
    {
      id: 'carousel',
      name: 'Carousel Slide',
      description: 'Multi-slide carousel',
      preview: {
        title: 'Slide 1 of 5',
        content: 'Swipe to explore more content and insights',
        layouts: { aspectRatio: '4:5', padding: 40, textAlignment: 'left' },
        background: { type: 'solid', solidColor: '#ffffff', gradientStart: '#667eea', gradientEnd: '#764ba2', gradientAngle: 0, imageUrl: '', overlayColor: '#000000', overlayOpacity: 0 },
        typography: { fontFamily: 'Poppins', fontSize: 24, fontWeight: 600, letterSpacing: 0.5, lineHeight: 1.3 },
        branding: { logoUrl: '', colorPalette: ['#0084f4', '#31a24c', '#e1306c', '#405de6'], fontSet: ['Poppins', 'Inter'] },
      },
    },
    {
      id: 'announcement',
      name: 'Announcement',
      description: 'Important announcement card',
      preview: {
        title: 'NEW FEATURE ALERT',
        content: 'Introducing the most powerful card generator ever built',
        layouts: { aspectRatio: '16:9', padding: 50, textAlignment: 'center' },
        background: { type: 'gradient', solidColor: '#ffffff', gradientStart: '#ff6b6b', gradientEnd: '#ee5a6f', gradientAngle: 45, imageUrl: '', overlayColor: '#000000', overlayOpacity: 0.2 },
        typography: { fontFamily: 'Poppins', fontSize: 48, fontWeight: 800, letterSpacing: 1, lineHeight: 1.2 },
        branding: { logoUrl: '', colorPalette: ['#ff6b6b', '#ee5a6f', '#ffd93d', '#6bcf7f'], fontSet: ['Poppins', 'Roboto'] },
      },
    },
  ];

  return (
    <div className="bg-white rounded-lg shadow-md p-6">
      <div className="flex items-center gap-2 mb-4">
        <Layout size={20} className="text-blue-600" />
        <h3 className="text-lg font-bold text-gray-900">Template Library</h3>
      </div>

      <div className="grid grid-cols-1 gap-3 max-h-96 overflow-y-auto">
        {templates.map((template) => (
          <button
            key={template.id}
            onClick={() => setCardDesign(template.preview)}
            className="text-left p-4 border-2 border-gray-200 rounded-lg hover:border-blue-500 hover:bg-blue-50 transition-all"
          >
            <div className="font-semibold text-gray-900">{template.name}</div>
            <div className="text-sm text-gray-600">{template.description}</div>
            <div className="text-xs text-gray-500 mt-2">
              Aspect ratio: {template.preview.layouts.aspectRatio}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
};

export default CardTemplateLibrary;
