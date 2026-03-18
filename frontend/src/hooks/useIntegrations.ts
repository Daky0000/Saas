import { useCallback, useEffect, useState } from "react";
import api from "../utils/api";

export interface Integration {
  id: string;
  name: string;
  slug: string;
  type: string;
  enabled: boolean;
}

export interface UserIntegration {
  id: string;
  accountId: string;
  accountName: string;
  accountEmail?: string | null;
  status: string;
  integration: Integration;
}

export const useIntegrations = () => {
  const [integrations, setIntegrations] = useState<Integration[]>([]);
  const [myIntegrations, setMyIntegrations] = useState<UserIntegration[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getIntegrations = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await api.get("/integrations");
      setIntegrations(response.data || []);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to load integrations");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getMyIntegrations = useCallback(async () => {
    setIsLoading(true);
    try {
      const response = await api.get("/integrations/my/all");
      setMyIntegrations(response.data || []);
      setError(null);
    } catch (err: any) {
      setError(err.response?.data?.error || "Failed to load integrations");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getOAuthUrl = useCallback(async (slug: string) => {
    const response = await api.get(`/integrations/${slug}/auth-url`);
    return response.data as { authUrl: string; state: string };
  }, []);

  const connectIntegration = useCallback(
    async (
      slug: string,
      payload: {
        accountId: string;
        accountName: string;
        accountEmail?: string;
        accessToken?: string;
        refreshToken?: string;
        tokenExpiry?: string;
      }
    ) => {
      const response = await api.post(`/integrations/${slug}/callback`, payload);
      await getMyIntegrations();
      return response.data;
    },
    [getMyIntegrations]
  );

  const disconnectIntegration = useCallback(
    async (integrationId: string) => {
      await api.delete(`/integrations/${integrationId}/disconnect`);
      await getMyIntegrations();
    },
    [getMyIntegrations]
  );

  const getConnectedAccounts = useCallback(async (_integrationId: string) => {
    return [] as UserIntegration[];
  }, []);

  const testConnection = useCallback(async (_integrationId: string) => {
    return { status: "unknown" } as { status: string };
  }, []);

  useEffect(() => {
    getIntegrations();
    getMyIntegrations();
  }, [getIntegrations, getMyIntegrations]);

  return {
    integrations,
    myIntegrations,
    isLoading,
    error,
    getIntegrations,
    getMyIntegrations,
    getOAuthUrl,
    connectIntegration,
    disconnectIntegration,
    getConnectedAccounts,
    testConnection,
  };
};
