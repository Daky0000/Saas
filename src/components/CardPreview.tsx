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

  const aspectRatio = design?.aspectRatio || design?.layouts?.aspectRatio || '1:1';
  const [width, height] = getAspectRatioDimensions(aspectRatio);
  const padding = Number(design?.layout?.padding ?? design?.layouts?.padding ?? 40);
  const textAlignment = design?.layout?.alignment || design?.layouts?.textAlignment || 'center';
  const backgroundType = design?.background?.type || 'gradient';

  const backgroundStyle: React.CSSProperties = {
    width: `${width}px`,
    height: `${height}px`,
    padding: `${padding}px`,
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    overflow: 'hidden',
    borderRadius: '12px',
    textAlign: textAlignment as any,
  };

  if (backgroundType === 'solid') {
    backgroundStyle.backgroundColor = design?.background?.color1 || design?.background?.solidColor || '#ffffff';
  } else if (backgroundType === 'gradient') {
    const angle = Number(design?.background?.angle ?? design?.background?.gradientAngle ?? 135);
    const start = design?.background?.color1 || design?.background?.gradientStart || '#667eea';
    const end = design?.background?.color2 || design?.background?.gradientEnd || '#764ba2';
    backgroundStyle.background = `linear-gradient(${angle}deg, ${start}, ${end})`;
  } else if (backgroundType === 'image') {
    const imageUrl = design?.background?.image || design?.background?.imageUrl || '';
    backgroundStyle.backgroundImage = `url('${imageUrl}')`;
    backgroundStyle.backgroundSize = 'cover';
    backgroundStyle.backgroundPosition = 'center';
  }

  const overlayStyle: React.CSSProperties = {
    position: 'absolute',
    inset: 0,
    backgroundColor: design?.background?.overlay?.color || design?.background?.overlayColor || '#000000',
    opacity: Number(design?.background?.overlay?.opacity ?? design?.background?.overlayOpacity ?? 0),
    zIndex: 1,
  };

  const contentStyle: React.CSSProperties = {
    position: 'relative',
    zIndex: 2,
    maxWidth: '90%',
    color: design?.typography?.color || '#ffffff',
    fontFamily: design?.typography?.font || design?.typography?.fontFamily || 'Poppins',
    fontSize: `${Number(design?.typography?.size ?? design?.typography?.fontSize ?? 48)}px`,
    fontWeight: Number(design?.typography?.weight ?? design?.typography?.fontWeight ?? 700),
    letterSpacing: `${Number(design?.typography?.spacing ?? design?.typography?.letterSpacing ?? 0)}px`,
    lineHeight: Number(design?.typography?.lineHeight ?? 1.4),
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6 space-y-4">
      <h3 className="text-lg font-bold text-gray-900">Preview</h3>
      <div className="flex justify-center bg-gray-100 rounded-lg p-4 overflow-auto">
        <div style={backgroundStyle}>
          <div style={overlayStyle}></div>
          <div style={contentStyle}>
            <div className="font-bold mb-3">{design?.title || 'Your Title Here'}</div>
            <div className="text-sm opacity-90">{design?.content || 'Your content preview appears here.'}</div>
          </div>
        </div>
      </div>
      <p className="text-xs text-gray-600 text-center">
        {width}px x {height}px ({aspectRatio})
      </p>
    </div>
  );
};

export default CardPreview;
