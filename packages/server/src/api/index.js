import { Router } from 'express';
import projectsRouter from './projects.js';
import sessionsRouter from './sessions.js';
import canvasRouter from './canvas.js';
import gitRouter from './git.js';
import filesystemRouter from './filesystem.js';
import commandsRouter from './commands.js';

const router = Router();

router.use('/projects', projectsRouter);
router.use('/sessions', sessionsRouter);
router.use('/git', gitRouter);
router.use('/filesystem', filesystemRouter);
router.use('/commands', commandsRouter);

// Canvas routes are nested under sessions
router.use('/sessions', canvasRouter);

export default router;
