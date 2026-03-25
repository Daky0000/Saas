export function formatCompactNumber(value: number | null | undefined) {
  if (value === null || value === undefined) return 'N/A';
  return new Intl.NumberFormat('en-US', {
    notation: value >= 1000 ? 'compact' : 'standard',
    maximumFractionDigits: value >= 1000 ? 1 : 0,
  }).format(value);
}

export function formatPercent(value: number | null | undefined) {
  if (value === null || value === undefined) return 'N/A';
  return `${value.toFixed(1)}%`;
}

export function formatTrend(value: number | null | undefined) {
  if (value === null || value === undefined) return null;
  const prefix = value > 0 ? '+' : '';
  return `${prefix}${value.toFixed(1)}%`;
}

export function formatShortDate(value: string | null | undefined) {
  if (!value) return 'N/A';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'N/A';
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
