import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./promptStore.js', () => ({ parkPrompt: vi.fn().mockResolvedValue({ behavior: 'allow' }) }));

import { parkPrompt } from './promptStore.js';
import { buildInteractionCallbacks } from './promptCallbacks.js';

const opts = (over = {}) => ({ toolUseID: 'tu-1', signal: { aborted: false }, ...over });

describe('promptCallbacks canUseTool kind classification', () => {
  beforeEach(() => vi.clearAllMocks());

  it('routes ExitPlanMode to the plan kind so the card renders the plan', async () => {
    const input = { plan: '# Ship it', planFilePath: '/p/plan.md' };
    await buildInteractionCallbacks({ sessionId: 's-1', conversationId: 'c-1' })
      .canUseTool('ExitPlanMode', input, opts({ displayName: 'ExitPlanMode' }));

    expect(parkPrompt).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 's-1', conversationId: 'c-1', kind: 'plan', toolUseId: 'tu-1',
      payload: expect.objectContaining({ toolName: 'ExitPlanMode', input, displayName: 'ExitPlanMode' }),
    }));
  });

  it('still routes AskUserQuestion to the question kind', async () => {
    const questions = [{ question: 'Which?' }];
    await buildInteractionCallbacks({ sessionId: 's-1', conversationId: 'c-1' })
      .canUseTool('AskUserQuestion', { questions }, opts());

    expect(parkPrompt).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'question', payload: expect.objectContaining({ questions }),
    }));
  });

  it('routes every other tool to the permission kind', async () => {
    await buildInteractionCallbacks({ sessionId: 's-1', conversationId: 'c-1' })
      .canUseTool('Bash', { command: 'ls' }, opts());

    expect(parkPrompt).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'permission', payload: expect.objectContaining({ toolName: 'Bash' }),
    }));
  });

  it('propagates subagent identity on plan prompts (card origin chip)', async () => {
    await buildInteractionCallbacks({ sessionId: 's-1', conversationId: 'c-1' })
      .canUseTool('ExitPlanMode', { plan: '# p' }, opts({ agentID: 'agent-9' }));

    expect(parkPrompt).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'plan', agentId: 'agent-9',
    }));
  });
});
