import { useEffect, useState } from 'react';
import { ConnectedAccount, SocialPlatform } from '../types/oauth';
import oauthService from '../services/oauthService';

export const useOAuthCallback = () => {
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    const handleCallback = async () => {
      const params = new URLSearchParams(window.location.search);
      const code = params.get('code');
      const state = params.get('state');
      const error = params.get('error');

      if (error) {
        console.error('OAuth error:', error);
        // Redirect to connects page with error
        window.location.href = '/?page=connects&error=' + encodeURIComponent(error);
        return;
      }

      if (code && state) {
        setIsProcessing(true);
        try {
          // Extract platform from state or URL
          const platform = sessionStorage.getItem('oauth_platform') as SocialPlatform;
          const result = await oauthService.exchangeCodeForToken(platform, code, state);

          if (result.success) {
            // Redirect to connects page with success
            window.location.href = '/?page=connects&success=true';
          } else {
            window.location.href =
              '/?page=connects&error=' + encodeURIComponent(result.error || 'Unknown error');
          }
        } catch (error) {
          console.error('OAuth callback error:', error);
          window.location.href =
            '/?page=connects&error=' + encodeURIComponent('Callback processing failed');
        } finally {
          setIsProcessing(false);
        }
      }
    };

    handleCallback();
  }, []);

  return isProcessing;
};

export const useConnectedAccounts = () => {
  const [accounts, setAccounts] = useState<ConnectedAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchAccounts = async () => {
    setLoading(true);
    const result = await oauthService.getConnectedAccounts();
    if (result.success && result.data) {
      setAccounts(result.data);
      setError(null);
    } else {
      setError(result.error || 'Failed to fetch accounts');
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAccounts();
  }, []);

  const disconnect = async (platform: SocialPlatform) => {
    const result = await oauthService.disconnectAccount(platform);
    if (result.success) {
      await fetchAccounts();
    } else {
      setError(result.error || 'Failed to disconnect');
    }
    return result;
  };

  return { accounts, loading, error, refetch: fetchAccounts, disconnect };
};

export const useOAuthConnect = (platform: SocialPlatform) => {
  const connect = async () => {
    const state = Math.random().toString(36).substring(7);
    sessionStorage.setItem('oauth_state', state);
    sessionStorage.setItem('oauth_platform', platform);

    const authUrl = oauthService.getAuthorizationUrl(platform, state);
    window.location.href = authUrl;
  };

  return { connect };
};
