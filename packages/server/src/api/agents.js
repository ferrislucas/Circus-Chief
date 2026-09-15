import { Router } from 'express';
import { agentGateway } from '../agents/AgentGateway.js';

const router = Router();

/**
 * GET /api/agents
 *
 * Returns the capabilities of every registered agent adapter. Capabilities
 * are resolved from the configured transport so they remain truthful when a
 * runtime fallback is active.
 *
 * Response shape:
 *   [
 *     { agentType: 'claude-code', capabilities: { streaming, thinking, reasoningEffort, toolUse, resume } },
 *     { agentType: 'codex',       capabilities: { streaming, thinking, reasoningEffort, toolUse, resume } },
 *   ]
 */
router.get('/', (_req, res) => {
  try {
    const agents = agentGateway.getAllAgentCapabilities();
    res.json(agents);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
