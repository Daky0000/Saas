import React from "react";
import { UserIntegration } from "../../hooks/useIntegrations";

export const ConnectedAccounts: React.FC<{ accounts: UserIntegration[] }> = ({
  accounts,
}) => {
  if (!accounts.length) {
    return (
      <p className="text-xs text-slate-400">No connected accounts yet.</p>
    );
  }

  return (
    <div className="space-y-2">
      {accounts.map((account) => (
        <div
          key={account.id}
          className="rounded-lg border border-slate-800 bg-slate-950/40 px-3 py-2 text-xs text-slate-300"
        >
          {account.integration.name}: {account.accountName}
        </div>
      ))}
    </div>
  );
};
