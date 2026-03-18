import React, { useMemo } from "react";
import { IntegrationCard } from "../components/Integrations/IntegrationCard";
import { ConnectedAccounts } from "../components/Integrations/ConnectedAccounts";
import { useIntegrations } from "../hooks/useIntegrations";

export const IntegrationsPage: React.FC = () => {
  const {
    integrations,
    myIntegrations,
    isLoading,
    error,
    getOAuthUrl,
    disconnectIntegration,
  } = useIntegrations();

  const grouped = useMemo(() => {
    return {
      social: integrations.filter((integration) => integration.type === "social"),
      cms: integrations.filter((integration) => integration.type === "cms"),
      marketing: integrations.filter(
        (integration) => integration.type === "marketing"
      ),
    };
  }, [integrations]);

  const handleConnect = async (slug: string) => {
    const { authUrl } = await getOAuthUrl(slug);
    if (authUrl) {
      window.location.href = authUrl;
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto max-w-6xl px-6 py-16">
        <div className="flex flex-col gap-6">
          <div>
            <p className="text-xs uppercase tracking-[0.4em] text-slate-500">
              Integrations
            </p>
            <h1 className="mt-3 text-3xl font-semibold sm:text-4xl">
              Connect every channel in one place.
            </h1>
            <p className="mt-2 text-base text-slate-300">
              Manage social networks, CMS platforms, and future automations.
            </p>
          </div>

          {error && (
            <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </div>
          )}

          {isLoading && (
            <p className="text-sm text-slate-400">Loading integrations...</p>
          )}

          <section className="space-y-4">
            <h2 className="text-lg font-semibold">Social Media</h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {grouped.social.map((integration) => {
                const connected = myIntegrations.find(
                  (item) => item.integration.slug === integration.slug
                );
                return (
                  <IntegrationCard
                    key={integration.id}
                    integration={integration}
                    connected={connected}
                    onConnect={handleConnect}
                    onDisconnect={disconnectIntegration}
                  />
                );
              })}
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold">CMS Platforms</h2>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {grouped.cms.map((integration) => {
                const connected = myIntegrations.find(
                  (item) => item.integration.slug === integration.slug
                );
                return (
                  <IntegrationCard
                    key={integration.id}
                    integration={integration}
                    connected={connected}
                    onConnect={handleConnect}
                    onDisconnect={disconnectIntegration}
                  />
                );
              })}
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-lg font-semibold">Connected Accounts</h2>
            <ConnectedAccounts accounts={myIntegrations} />
          </section>
        </div>
      </div>
    </div>
  );
};
