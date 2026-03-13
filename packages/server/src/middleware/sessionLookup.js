import { sessions, projects } from '../database.js';

/**
 * Middleware: Look up a session by req.params.id and attach to req.session_.
 * Returns 404 if session not found.
 * Uses session_ to avoid conflict with express-session's req.session.
 */
export function requireSession(req, res, next) {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }
  req.session_ = session;
  next();
}

/**
 * Middleware: Look up session AND its project. Attaches req.session_ and req.project.
 * Returns 404 if either is not found.
 * Also resolves req.workingDirectory (gitWorktree || project.workingDirectory).
 */
export function requireSessionAndProject(req, res, next) {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: 'Session not found' });
  }

  const project = projects.getById(session.projectId);
  if (!project) {
    return res.status(404).json({ error: 'Project not found' });
  }

  req.session_ = session;
  req.project = project;
  req.workingDirectory = session.gitWorktree || project.workingDirectory;
  next();
}
