import { sessions, projects } from '../database.js';

const SESSION_NOT_FOUND = 'Session not found';
const PROJECT_NOT_FOUND = 'Project not found';
const SESSION_NOT_IN_PROJECT = 'Session does not belong to this project';

/**
 * Middleware: Look up a session by req.params.id and attach to req.session_.
 * Returns 404 if session not found.
 * Uses session_ to avoid conflict with express-session's req.session.
 */
export function requireSession(req, res, next) {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: SESSION_NOT_FOUND });
  }
  req.session_ = session;
  next();
}

/**
 * Middleware factory: Validates that req.session_.status is one of the allowed statuses.
 * Must be used AFTER requireSession or requireSessionAndProject middleware.
 * @param {string[]} allowedStatuses - Array of allowed status strings
 * @param {string} [errorMessage] - Optional custom error message
 * @returns {Function} Express middleware
 */
export function requireSessionStatus(allowedStatuses, errorMessage) {
  return (req, res, next) => {
    if (!req.session_) {
      return res.status(500).json({ error: 'requireSessionStatus must be used after requireSession' });
    }
    if (!allowedStatuses.includes(req.session_.status)) {
      const message = errorMessage || `Session status must be one of: ${allowedStatuses.join(', ')}`;
      return res.status(400).json({ error: message });
    }
    next();
  };
}

/**
 * Middleware: Look up session AND its project. Attaches req.session_ and req.project.
 * Returns 404 if either is not found.
 * Also resolves req.workingDirectory (gitWorktree || project.workingDirectory).
 */
export function requireSessionAndProject(req, res, next) {
  const session = sessions.getById(req.params.id);
  if (!session) {
    return res.status(404).json({ error: SESSION_NOT_FOUND });
  }

  const project = projects.getById(session.projectId);
  if (!project) {
    return res.status(404).json({ error: PROJECT_NOT_FOUND });
  }

  req.session_ = session;
  req.project = project;
  req.workingDirectory = session.gitWorktree || project.workingDirectory;
  next();
}

/**
 * Middleware: Look up the provided session ID, then attach the workflow root
 * session/project for resources shared across a session tree.
 */
export function requireRootSessionAndProject(req, res, next) {
  const providedSession = sessions.getById(req.params.id);
  if (!providedSession) {
    return res.status(404).json({ error: SESSION_NOT_FOUND });
  }

  const rootSessionId = sessions.getRootSessionId(providedSession.id) || providedSession.id;
  const rootSession = sessions.getById(rootSessionId);
  if (!rootSession) {
    return res.status(404).json({ error: SESSION_NOT_FOUND });
  }

  if (providedSession.projectId !== rootSession.projectId) {
    return res.status(400).json({ error: 'Session parent chain crosses projects' });
  }

  const rootProject = projects.getById(rootSession.projectId);
  if (!rootProject) {
    return res.status(404).json({ error: PROJECT_NOT_FOUND });
  }

  req.providedSession_ = providedSession;
  req.rootSession_ = rootSession;
  req.rootSessionId = rootSessionId;
  req.rootProject = rootProject;
  req.rootWorkingDirectory = rootSession.gitWorktree || rootProject.workingDirectory;
  next();
}

/**
 * Middleware factory for project-scoped endpoints that receive a workspaceId
 * (= root session ID) in the JSON body and should operate on that session
 * tree's root.  Forgiving normalization: if a child session id is provided,
 * it is silently resolved to its workspace root (the service layer is
 * authoritative; this is defense-in-depth only).
 */
export function resolveBodyRootSessionForProject(projectParam = 'projectId') {
  return (req, res, next) => {
    const providedSessionId = req.body?.workspaceId;
    if (!providedSessionId) {
      return res.status(400).json({ error: 'workspaceId is required' });
    }

    const providedSession = sessions.getById(providedSessionId);
    if (!providedSession) {
      return res.status(404).json({ error: SESSION_NOT_FOUND });
    }

    if (providedSession.projectId !== req.params[projectParam]) {
      return res.status(400).json({ error: SESSION_NOT_IN_PROJECT });
    }

    const rootSessionId = sessions.getRootSessionId(providedSession.id) || providedSession.id;
    const rootSession = sessions.getById(rootSessionId);
    if (!rootSession) {
      return res.status(404).json({ error: SESSION_NOT_FOUND });
    }

    if (rootSession.projectId !== req.params[projectParam]) {
      return res.status(400).json({ error: SESSION_NOT_IN_PROJECT });
    }

    req.bodyRootSession_ = rootSession;
    req.bodyRootSessionId = rootSessionId;
    next();
  };
}
