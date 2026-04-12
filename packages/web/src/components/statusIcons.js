// Shared SVGs for command button status indicators
export const STATUS_ICONS = {
  running: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor"
    stroke-width="1.5" stroke-linejoin="round">
    <path d="M3,2 L13,2 L8.5,7.5 L13,13 L3,13 L7.5,7.5 Z"/>
    <path d="M4,2.5 L12,2.5 L8.5,6.5 Z" fill="currentColor" opacity="0.5"/>
    <path d="M7.5,9 L12,12.5 L4,12.5 Z" fill="currentColor" opacity="0.3"/>
  </svg>`,
  success: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor"
    stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
    <polyline points="3,8.5 6.5,12 13,4"/>
  </svg>`,
  error: `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor"
    stroke-width="2.5" stroke-linecap="round">
    <line x1="4" y1="4" x2="12" y2="12"/>
    <line x1="12" y1="4" x2="4" y2="12"/>
  </svg>`,
};

export function getStatusIconSvg(status) {
  if (status === 'killed') return STATUS_ICONS.error;
  return STATUS_ICONS[status] || '';
}
