// Shared SVGs for command button status indicators
export const STATUS_ICONS = {
  running: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor"
    stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M3 2 L13 2 L8 7.5 Z" fill="currentColor" fill-opacity="0.3"/>
    <path d="M3 14 L13 14 L8 8.5 Z" fill="currentColor" fill-opacity="0.15"/>
    <line x1="8" y1="7.5" x2="8" y2="8.5" stroke-width="1" opacity="0.6"/>
    <line x1="3.5" y1="2" x2="12.5" y2="2" stroke-width="1.8"/>
    <line x1="3.5" y1="14" x2="12.5" y2="14" stroke-width="1.8"/>
  </svg>`,
  success: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="3.5,8.5 6.5,11.5 12.5,4.5"/>
  </svg>`,
  error: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor"
    stroke-width="2" stroke-linecap="round">
    <line x1="4" y1="4" x2="12" y2="12"/>
    <line x1="12" y1="4" x2="4" y2="12"/>
  </svg>`,
};

export function getStatusIconSvg(status) {
  if (status === 'killed') return STATUS_ICONS.error;
  return STATUS_ICONS[status] || '';
}
