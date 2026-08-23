let status = {
  scheduler: 'unknown',
  kanban: 'unknown',
  reasonCode: 'AUTOMATION_STATUS_UNAVAILABLE',
  message: 'Automation status has not been initialized.',
};

export function setAutomationPreflightStatus(preflight) {
  status = preflight.workersEnabled
    ? { scheduler: 'operational', kanban: 'operational', reasonCode: null, message: null }
    : {
      scheduler: 'operational',
      kanban: 'degraded',
      reasonCode: 'KANBAN_PREFLIGHT_FAILED',
      message: 'Kanban automation is disabled. Unrelated scheduled sessions remain available. Run the Kanban recovery command, then restart the server.',
    };
}

export function getAutomationStatus() {
  try {
    const delivery = getKanbanDeliveryHealth();
    return { http: 'available', ...status,
      kanban: status.kanban === 'degraded' ? 'degraded' : delivery.status,
      deliveryHealth: delivery };
  } catch {
    return { http: 'available', ...status };
  }
}
import { getKanbanDeliveryHealth } from './kanbanRecoveryService.js';
