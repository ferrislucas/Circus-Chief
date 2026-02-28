import { test, expect } from '@playwright/test';
import { connectWebSocket, seedProject, cleanupCreatedResources } from './helpers';

test.describe('WS minimal', () => {
  test.afterEach(async () => { await cleanupCreatedResources(); });
  test('connects to WS server', async () => {
    const ws = await connectWebSocket();
    expect(ws.readyState).toBe(1);
    ws.close();
  });
});
