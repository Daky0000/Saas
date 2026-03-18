import React from "react";
import { UserIntegration } from "../../hooks/useIntegrations";

const limits: Record<string, number> = {
  facebook: 63206,
  instagram: 2200,
  twitter: 280,
  linkedin: 3000,
  pinterest: 500,
  wordpress: 100000,
};

interface PostPreviewProps {
  content: string;
  selected: string[];
  integrations: UserIntegration[];
}

export const PostPreview: React.FC<PostPreviewProps> = ({
  content,
  selected,
  integrations,
}) => {
  const selectedIntegrations = integrations.filter((item) =>
    selected.includes(item.id)
  );

  if (!selectedIntegrations.length) {
    return (
      <div className="rounded-lg border border-slate-800 bg-slate-950/40 p-4 text-sm text-slate-400">
        Select platforms to preview.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {selectedIntegrations.map((integration) => {
        const slug = integration.integration.slug;
        const limit = limits[slug] ?? 2000;
        return (
          <div
            key={integration.id}
            className="rounded-lg border border-slate-800 bg-slate-950/40 p-4"
          >
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">{integration.integration.name}</p>
              <p className="text-xs text-slate-400">
                {content.length}/{limit}
              </p>
            </div>
            <p className="mt-2 text-sm text-slate-300">
              {content || "Start typing to see preview."}
            </p>
          </div>
        );
      })}
    </div>
  );
};
