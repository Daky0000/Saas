import React from "react";

interface ScheduleSelectorProps {
  mode: "now" | "schedule";
  scheduledAt: string | null;
  onModeChange: (mode: "now" | "schedule") => void;
  onScheduledAtChange: (value: string) => void;
}

export const ScheduleSelector: React.FC<ScheduleSelectorProps> = ({
  mode,
  scheduledAt,
  onModeChange,
  onScheduledAtChange,
}) => {
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold">Schedule</p>
      <div className="flex gap-4 text-sm">
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={mode === "now"}
            onChange={() => onModeChange("now")}
            className="accent-indigo-500"
          />
          Post now
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            checked={mode === "schedule"}
            onChange={() => onModeChange("schedule")}
            className="accent-indigo-500"
          />
          Schedule for later
        </label>
      </div>
      {mode === "schedule" && (
        <input
          type="datetime-local"
          value={scheduledAt ?? ""}
          onChange={(e) => onScheduledAtChange(e.target.value)}
          className="w-full rounded-lg border border-slate-700 bg-slate-950/40 px-4 py-2 text-slate-100 focus:border-slate-500 focus:outline-none"
        />
      )}
    </div>
  );
};
