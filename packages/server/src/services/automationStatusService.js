let status = {
  automation: 'unknown',
  reasonCode: 'AUTOMATION_STATUS_UNAVAILABLE',
  message: 'Automation status has not been initialized.',
};

export function setAutomationPreflightStatus(preflight) {
  status = preflight.workersEnabled
    ? { automation: 'operational', reasonCode: null, message: null }
    : {
      automation: 'degraded',
      reasonCode: 'KANBAN_PREFLIGHT_FAILED',
      message: 'Kanban automation and scheduling are disabled. Run the Kanban recovery command, then restart the server.',
    };
}

export function getAutomationStatus() {
  return { http: 'available', ...status };
}
