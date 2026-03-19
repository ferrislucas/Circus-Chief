import { Router } from 'express';
import projectsRouter from './projects.js';
import sessionsRouter from './sessions.js';
import templatesRouter from './templates.js';
import canvasRouter from './canvas.js';
import gitRouter from './git.js';
import filesystemRouter from './filesystem.js';
import quickResponsesRouter from './quickResponses.js';
import settingsRouter from './settings.js';
import providersRouter from './providers.js';
import commandsRouter from './commands.js';
import metricsRouter from './metrics.js';
import kanbanRouter from './kanban.js';

const router = Router();

// Lightweight identity endpoint — lets tools (e.g. pw.sh) verify which
// worktree / working directory this server instance belongs to.
router.get('/server-info', (_req, res) => {
  res.json({ cwd: process.cwd() });
});

router.use('/projects', projectsRouter);
router.use('/sessions', sessionsRouter);
router.use('/templates', templatesRouter);
router.use('/git', gitRouter);
router.use('/filesystem', filesystemRouter);
router.use('/settings', settingsRouter);
router.use('/providers', providersRouter);
router.use('/commands', commandsRouter)

// Canvas routes are nested under sessions
router.use('/sessions', canvasRouter);

// Kanban routes are nested under projects
router.use('/projects/:projectId/kanban', kanbanRouter);

// Metrics routes (agent call stats)
router.use('/', metricsRouter);

// Quick responses routes (nested under both projects and standalone)
router.use('/', quickResponsesRouter);

export default router;
