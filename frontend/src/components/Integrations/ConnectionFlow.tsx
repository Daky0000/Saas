import React from "react";
import { useIntegrations } from "../../hooks/useIntegrations";

export const ConnectionFlow: React.FC<{ slug: string }> = ({ slug }) => {
  const { getOAuthUrl } = useIntegrations();

  const handleConnect = async () => {
    const { authUrl } = await getOAuthUrl(slug);
    if (authUrl) {
      window.location.href = authUrl;
    }
  };

  return (
    <button
      onClick={handleConnect}
      className="rounded-lg bg-indigo-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-400"
    >
      Connect
    </button>
  );
};
