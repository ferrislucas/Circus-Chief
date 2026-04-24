import { Router } from 'express';
import { agentGateway } from '../agents/AgentGateway.js';

const router = Router();

/**
 * GET /api/agents
 *
 * Returns the capabilities of every registered agent adapter, sourced from the
 * adapter's static `capabilities` field (no adapter instantiation).
 *
 * Response shape:
 *   [
 *     { agentType: 'claude-code', capabilities: { streaming, thinking, toolUse, resume } },
 *     { agentType: 'codex',       capabilities: { streaming, thinking, toolUse, resume } },
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
