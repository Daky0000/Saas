import React from "react";
import { UserIntegration } from "../../hooks/useIntegrations";

interface PlatformSelectorProps {
  integrations: UserIntegration[];
  selected: string[];
  onToggle: (id: string) => void;
  onSelectAll: () => void;
}

export const PlatformSelector: React.FC<PlatformSelectorProps> = ({
  integrations,
  selected,
  onToggle,
  onSelectAll,
}) => {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold">Publish destinations</p>
          <p className="text-xs text-slate-400">
            {selected.length} selected
          </p>
        </div>
        <button
          type="button"
          onClick={onSelectAll}
          className="text-xs text-indigo-300 hover:underline"
        >
          Select all
        </button>
      </div>

      {integrations.length === 0 && (
        <p className="text-sm text-slate-400">
          No integrations connected yet. Connect a platform to start publishing.
        </p>
      )}

      <div className="space-y-3">
        {integrations.map((integration) => {
          const label = `${integration.integration.name} ? ${integration.accountName}`;
          const isChecked = selected.includes(integration.id);
          return (
            <label
              key={integration.id}
              className={`flex items-center justify-between rounded-lg border px-4 py-3 text-sm transition ${
                isChecked
                  ? "border-indigo-400 bg-indigo-500/10"
                  : "border-slate-800 bg-slate-950/40"
              }`}
            >
              <span>{label}</span>
              <input
                type="checkbox"
                checked={isChecked}
                onChange={() => onToggle(integration.id)}
                className="h-4 w-4 accent-indigo-500"
              />
            </label>
          );
        })}
      </div>
    </div>
  );
};
