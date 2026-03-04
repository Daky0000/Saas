interface CardPreviewProps {
  design: any;
}

const CardPreview = ({ design }: CardPreviewProps) => {
  const getAspectRatioDimensions = (aspectRatio: string) => {
    const ratios: { [key: string]: [number, number] } = {
      '1:1': [400, 400],
      '4:5': [400, 500],
      '16:9': [800, 450],
      '9:16': [450, 800],
      '3:4': [600, 800],
      '2:3': [400, 600],
    };
    return ratios[aspectRatio] || [800, 450];
  };

  const [width, height] = getAspectRatioDimensions(design.layouts.aspectRatio);

  const backgroundStyle: React.CSSProperties = {
    width: `${width}px`,
    height: `${height}px`,
    padding: `${design.layouts.padding}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: '12px',
    textAlign: design.layouts.textAlignment as any,
  };

  if (design.background.type === 'solid') {
    backgroundStyle.backgroundColor = design.background.solidColor;
  } else if (design.background.type === 'gradient') {
    backgroundStyle.background = `linear-gradient(${design.background.gradientAngle}deg, ${design.background.gradientStart}, ${design.background.gradientEnd})`;
  } else if (design.background.type === 'image') {
    backgroundStyle.backgroundImage = `url('${design.background.imageUrl}')`;
    backgroundStyle.backgroundSize = 'cover';
    backgroundStyle.backgroundPosition = 'center';
  }

  const overlayStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    backgroundColor: design.background.overlayColor,
    opacity: design.background.overlayOpacity,
    zIndex: 1,
  };

  const contentStyle: React.CSSProperties = {
    position: 'relative',
    zIndex: 2,
    maxWidth: '90%',
    color: '#ffffff',
    fontFamily: design.typography.fontFamily,
    fontSize: `${design.typography.fontSize}px`,
    fontWeight: design.typography.fontWeight,
    letterSpacing: `${design.typography.letterSpacing}px`,
    lineHeight: design.typography.lineHeight,
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6 space-y-4">
      <h3 className="text-lg font-bold text-gray-900">Preview</h3>
      <div className="flex justify-center bg-gray-100 rounded-lg p-4 overflow-auto">
        <div style={backgroundStyle}>
          <div style={overlayStyle}></div>
          <div style={contentStyle}>
            <div className="font-bold mb-3">{design.title}</div>
            <div className="text-sm opacity-90">{design.content}</div>
          </div>
        </div>
      </div>
      <p className="text-xs text-gray-600 text-center">
        {width}px × {height}px ({design.layouts.aspectRatio})
      </p>
    </div>
  );
};

export default CardPreview;
