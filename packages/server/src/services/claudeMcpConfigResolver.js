import os from 'os';
import path from 'path';
import fsModule from 'fs';

const defaultFs = {
  existsSync: fsModule.existsSync,
  readFileSync: fsModule.readFileSync,
  statSync: fsModule.statSync,
};

export function resolveClaudeMcpServers({
  workingDirectory,
  homeDirectory = os.homedir(),
  fs = defaultFs,
} = {}) {
  const diagnostics = { included: [], skipped: [] };
  const mcpServers = {};

  if (!workingDirectory || typeof workingDirectory !== 'string') {
    diagnostics.skipped.push({ name: null, source: 'input', reason: 'missing-working-directory' });
    return { mcpServers, diagnostics };
  }

  const resolvedWorkingDirectory = path.resolve(workingDirectory);
  const claudeConfigPath = path.join(homeDirectory, '.claude.json');
  const claudeConfig = readJsonFile(claudeConfigPath, fs);
  const projectMatch = findClaudeProjectMatch({
    workingDirectory: resolvedWorkingDirectory,
    projects: claudeConfig?.projects,
    fs,
  });
  const projectEntry = projectMatch ? claudeConfig.projects[projectMatch.key] : null;

  mergeServers({
    target: mcpServers,
    servers: claudeConfig?.mcpServers,
    source: 'user',
    diagnostics,
  });

  mergeServers({
    target: mcpServers,
    servers: projectEntry?.mcpServers,
    source: 'local',
    diagnostics,
  });

  const projectMcpPath = path.join(resolvedWorkingDirectory, '.mcp.json');
  const projectMcpConfig = readJsonFile(projectMcpPath, fs);
  const projectApproval = getProjectMcpApproval({
    projectEntry,
    workingDirectory: resolvedWorkingDirectory,
    fs,
  });

  mergeProjectMcpServers({
    target: mcpServers,
    servers: projectMcpConfig?.mcpServers,
    approval: projectApproval,
    diagnostics,
  });

  return { mcpServers, diagnostics };
}

function mergeServers({ target, servers, source, diagnostics }) {
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return;

  for (const [name, config] of Object.entries(servers)) {
    const normalized = normalizeServerConfig(config);
    if (!normalized) {
      diagnostics.skipped.push({ name, source, reason: 'unsupported-or-malformed-server' });
      continue;
    }
    target[name] = normalized.server;
    diagnostics.included.push({ name, source, transport: normalized.transport });
  }
}

function mergeProjectMcpServers({ target, servers, approval, diagnostics }) {
  if (!servers || typeof servers !== 'object' || Array.isArray(servers)) return;

  for (const [name, config] of Object.entries(servers)) {
    if (approval.disabled.has(name)) {
      diagnostics.skipped.push({ name, source: 'project', reason: 'disabled' });
      continue;
    }
    if (!approval.enableAll && !approval.enabled.has(name)) {
      diagnostics.skipped.push({ name, source: 'project', reason: 'not-approved' });
      continue;
    }

    const normalized = normalizeServerConfig(config);
    if (!normalized) {
      diagnostics.skipped.push({ name, source: 'project', reason: 'unsupported-or-malformed-server' });
      continue;
    }
    target[name] = normalized.server;
    diagnostics.included.push({ name, source: 'project', transport: normalized.transport });
  }
}

function normalizeServerConfig(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return null;

  if (config.type === 'sse' || config.type === 'http') {
    if (typeof config.url !== 'string' || config.url.length === 0) return null;
    if (config.headers !== undefined && !isPlainObject(config.headers)) return null;
    return {
      transport: config.type,
      server: {
        type: config.type,
        url: config.url,
        ...(config.headers !== undefined ? { headers: config.headers } : {}),
      },
    };
  }

  if (config.type === undefined || config.type === 'stdio') {
    if (typeof config.command !== 'string' || config.command.length === 0) return null;
    if (config.args !== undefined && !Array.isArray(config.args)) return null;
    if (config.env !== undefined && !isPlainObject(config.env)) return null;
    return {
      transport: 'stdio',
      server: {
        ...(config.type === 'stdio' ? { type: 'stdio' } : {}),
        command: config.command,
        ...(config.args !== undefined ? { args: config.args } : {}),
        ...(config.env !== undefined ? { env: config.env } : {}),
      },
    };
  }

  return null;
}

function getProjectMcpApproval({ projectEntry, workingDirectory, fs }) {
  const localSettings = readJsonFile(path.join(workingDirectory, '.claude', 'settings.local.json'), fs);
  const sources = [projectEntry, localSettings].filter(Boolean);

  return {
    enableAll: sources.some((source) => source.enableAllProjectMcpServers === true),
    enabled: new Set(sources.flatMap((source) => asStringArray(source.enabledMcpjsonServers))),
    disabled: new Set(sources.flatMap((source) => asStringArray(source.disabledMcpjsonServers))),
  };
}

function findClaudeProjectMatch({ workingDirectory, projects, fs }) {
  if (!projects || typeof projects !== 'object' || Array.isArray(projects)) return null;

  const normalizedWorkingDirectory = normalizePath(workingDirectory);
  const normalizedGitRoot = findGitRoot(workingDirectory, fs);

  const candidates = Object.keys(projects).map((key) => {
    const normalizedKey = normalizePath(key);
    if (normalizedKey === normalizedWorkingDirectory) {
      return { key, score: 4, length: normalizedKey.length };
    }
    if (normalizedGitRoot && normalizedKey === normalizePath(normalizedGitRoot)) {
      return { key, score: 3, length: normalizedKey.length };
    }
    if (
      isSameOrAncestor(normalizedKey, normalizedWorkingDirectory)
      || isSameOrAncestor(normalizedWorkingDirectory, normalizedKey)
    ) {
      return { key, score: 2, length: normalizedKey.length };
    }
    return { key, score: 0, length: normalizedKey.length };
  }).filter((candidate) => candidate.score > 0);

  candidates.sort((a, b) => b.score - a.score || b.length - a.length || a.key.localeCompare(b.key));
  return candidates[0] ?? null;
}

function findGitRoot(startDirectory, fs) {
  let current = path.resolve(startDirectory);
  while (true) {
    const gitPath = path.join(current, '.git');
    if (pathExists(gitPath, fs)) return current;
    const parent = path.dirname(current);
    if (parent === current) return null;
    current = parent;
  }
}

function readJsonFile(filePath, fs) {
  try {
    if (!pathExists(filePath, fs)) return null;
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function pathExists(filePath, fs) {
  try {
    return fs.existsSync(filePath);
  } catch {
    return false;
  }
}

function normalizePath(value) {
  return path.resolve(value).split(path.sep).join('/');
}

function isSameOrAncestor(maybeAncestor, child) {
  if (maybeAncestor === child) return true;
  return child.startsWith(`${maybeAncestor.replace(/\/$/, '')}/`);
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function asStringArray(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : [];
}
