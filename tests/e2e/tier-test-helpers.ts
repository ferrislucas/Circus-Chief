import { API_URL } from './helpers';

/**
 * Tier API helpers shared by the failover e2e specs (the gated
 * model-tiers-failover.spec.ts and the default-pipeline
 * model-tiers-failover-default.spec.ts).
 *
 * Kept in a non-spec module (never `*.spec.ts`) so Playwright does not treat
 * it as a test file, and so specs never import from each other (importing a
 * spec file would re-register its tests).
 */

export async function createTierViaApi(data: {
  name: string;
  description?: string | null;
  autoFailoverEnabled?: boolean;
  members?: Array<{ providerId: string; modelId: string; position: number }>;
}) {
  const response = await fetch(`${API_URL}/api/tiers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    throw new Error(`Failed to create tier (${response.status}): ${await response.text()}`);
  }
  return response.json();
}

export async function deleteTierViaApi(id: string) {
  await fetch(`${API_URL}/api/tiers/${id}`, { method: 'DELETE' }).catch(() => {});
}
