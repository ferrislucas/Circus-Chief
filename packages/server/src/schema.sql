-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  working_directory TEXT NOT NULL,
  system_prompt TEXT,
  on_session_created TEXT,
  on_session_deleted TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'starting' CHECK (status IN ('starting', 'running', 'waiting', 'stopped', 'completed', 'error')),
  mode TEXT NOT NULL DEFAULT 'standard' CHECK (mode IN ('plan', 'standard', 'yolo')),
  thinking_enabled INTEGER NOT NULL DEFAULT 0,
  git_branch TEXT,
  git_worktree TEXT,
  pr_url TEXT,
  error TEXT,
  cost_usd REAL DEFAULT 0,
  claude_session_id TEXT,
  model TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Conversation messages
CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  tool_use TEXT, -- JSON array of tool uses
  timestamp INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Canvas items
CREATE TABLE IF NOT EXISTS canvas_items (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('image', 'markdown', 'text', 'json')),
  content TEXT,           -- For markdown/text
  data TEXT,              -- For json (stored as JSON string) or image (base64)
  mime_type TEXT,         -- For images
  filename TEXT,
  label TEXT,
  width INTEGER,
  height INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Session notes
CREATE TABLE IF NOT EXISTS session_notes (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Global tool templates
CREATE TABLE IF NOT EXISTS global_tool_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payload TEXT NOT NULL,
  payload_type TEXT NOT NULL DEFAULT 'command' CHECK (payload_type = 'command'),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Project tool templates
CREATE TABLE IF NOT EXISTS project_tool_templates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  payload TEXT NOT NULL,
  payload_type TEXT NOT NULL CHECK (payload_type IN ('command', 'prompt')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Session todos (Claude's task list)
CREATE TABLE IF NOT EXISTS session_todos (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'in_progress', 'completed')),
  position INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Work logs (thinking, command outputs, tool executions)
CREATE TABLE IF NOT EXISTS work_logs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES conversation_messages(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('thinking', 'tool_input', 'tool_output')),
  tool_name TEXT,                -- Tool name for tool_input/tool_output types
  content TEXT NOT NULL,         -- The actual log content
  timestamp INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Session summaries (AI-generated)
CREATE TABLE IF NOT EXISTS session_summaries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  short_summary TEXT NOT NULL,      -- 1-2 sentence preview for list view (~100 chars)
  full_summary TEXT NOT NULL,       -- Detailed summary with key points (~500 chars)
  key_actions TEXT,                 -- JSON array of main actions taken
  files_modified TEXT,              -- JSON array of files touched
  outcome TEXT,                     -- 'completed' | 'partial' | 'failed' | 'ongoing'
  message_count INTEGER,            -- Track what was summarized (staleness detection)
  pr_merged INTEGER,                -- 0/1 boolean - whether PR is merged
  pr_state TEXT,                    -- 'open' | 'closed' | 'merged' | 'draft'
  has_merge_conflicts INTEGER,      -- 0/1 boolean - whether PR has merge conflicts
  ci_status TEXT,                   -- 'success' | 'failure' | 'pending' | null
  ci_failures TEXT,                 -- JSON array of failed check names
  generated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Message attachments (files attached to user messages)
CREATE TABLE IF NOT EXISTS message_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT REFERENCES conversation_messages(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_type TEXT NOT NULL DEFAULT 'base64' CHECK (storage_type IN ('base64', 'file_path', 'project_file')),
  content TEXT,  -- base64 data or file path depending on storage_type
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_messages_session ON conversation_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_canvas_session ON canvas_items(session_id);
CREATE INDEX IF NOT EXISTS idx_notes_session ON session_notes(session_id);
CREATE INDEX IF NOT EXISTS idx_project_tools ON project_tool_templates(project_id);
CREATE INDEX IF NOT EXISTS idx_todos_session ON session_todos(session_id);
CREATE INDEX IF NOT EXISTS idx_work_logs_session ON work_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_work_logs_message ON work_logs(message_id);
CREATE INDEX IF NOT EXISTS idx_summaries_session ON session_summaries(session_id);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON message_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_attachments_session ON message_attachments(session_id);
