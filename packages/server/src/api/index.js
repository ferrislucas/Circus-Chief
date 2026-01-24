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

const router = Router();

router.use('/projects', projectsRouter);
router.use('/sessions', sessionsRouter);
router.use('/templates', templatesRouter);
router.use('/git', gitRouter);
router.use('/filesystem', filesystemRouter);
router.use('/settings', settingsRouter);
router.use('/providers', providersRouter);

// Canvas routes are nested under sessions
router.use('/sessions', canvasRouter);

// Quick responses routes (nested under both projects and standalone)
router.use('/', quickResponsesRouter);

export default router;
