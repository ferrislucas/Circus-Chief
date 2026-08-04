import { Router } from 'express';
import { requireSession } from '../middleware/sessionLookup.js';
import { PromptResponse } from '@circuschief/shared';
import { getPrompt, respondToPrompt } from '../services/promptStore.js';

const router = Router();

router.get('/:id/prompt', requireSession, (req, res) => {
  res.json(getPrompt(req.params.id));
});

router.post('/:id/prompt/:promptId/respond', requireSession, (req, res) => {
  const parsed = PromptResponse.safeParse(req.body);
  if (!parsed.success) return res.status(422).json({ error: parsed.error.issues[0].message });
  const resolved = respondToPrompt(req.params.id, req.params.promptId, parsed.data);
  if (resolved === null) return res.status(422).json({ error: 'Response action is not valid for this prompt kind' });
  if (!resolved) {
    return res.status(409).json({ error: 'Prompt is no longer pending' });
  }
  return res.json({ ok: true });
});

export default router;
