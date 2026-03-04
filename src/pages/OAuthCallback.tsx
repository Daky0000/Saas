import { useEffect } from 'react';

const OAuthCallback = () => {
  useEffect(() => {
    // The callback handling is done in the hook
    // This page just shows loading state
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-blue-50 to-purple-50">
      <div className="text-center">
        <div className="inline-block">
          <div className="animate-spin inline-block w-12 h-12 border-4 border-gray-300 border-t-blue-600 rounded-full mb-4"></div>
        </div>
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Connecting to Platform</h1>
        <p className="text-gray-600">Please wait while we authorize your account...</p>
      </div>
    </div>
  );
};

export default OAuthCallback;
