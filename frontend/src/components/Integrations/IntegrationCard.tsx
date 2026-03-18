import React from "react";
import { Integration, UserIntegration } from "../../hooks/useIntegrations";
import { StatusBadge } from "../Common/StatusBadge";

interface IntegrationCardProps {
  integration: Integration;
  connected?: UserIntegration;
  onConnect: (slug: string) => void;
  onDisconnect: (id: string) => void;
}

export const IntegrationCard: React.FC<IntegrationCardProps> = ({
  integration,
  connected,
  onConnect,
  onDisconnect,
}) => {
  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-900/60 p-5">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">{integration.name}</p>
          <p className="text-xs text-slate-400">{integration.type}</p>
        </div>
        {connected ? (
          <StatusBadge status={connected.status} />
        ) : (
          <StatusBadge status="DISCONNECTED" />
        )}
      </div>

      {connected && (
        <div className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-300">
          {connected.accountName}
        </div>
      )}

      <div className="flex gap-3">
        {!connected && (
          <button
            onClick={() => onConnect(integration.slug)}
            className="rounded-lg bg-indigo-500 px-3 py-2 text-xs font-semibold text-white transition hover:bg-indigo-400"
          >
            Connect
          </button>
        )}
        {connected && (
          <button
            onClick={() => onDisconnect(connected.id)}
            className="rounded-lg border border-slate-700 px-3 py-2 text-xs text-slate-200 transition hover:border-slate-500"
          >
            Disconnect
          </button>
        )}
      </div>
    </div>
  );
};
