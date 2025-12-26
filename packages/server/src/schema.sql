-- Projects table
CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  working_directory TEXT NOT NULL,
  system_prompt TEXT,
  on_session_created TEXT,
  on_session_deleted TEXT,
  pr_poll_interval INTEGER NOT NULL DEFAULT 60000,  -- PR status poll interval in ms (default 1 minute)
  disable_session_summaries INTEGER NOT NULL DEFAULT 0,  -- Disable automatic session summary generation
  disable_conversation_summaries INTEGER NOT NULL DEFAULT 0,  -- Disable automatic conversation summary generation
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Session templates (reusable prompts that can chain sessions)
-- Must be created before sessions due to foreign key reference
CREATE TABLE IF NOT EXISTS session_templates (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  next_template_id TEXT REFERENCES session_templates(id) ON DELETE SET NULL,
  thinking_enabled INTEGER,
  git_branch TEXT,
  git_mode TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Sessions table
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'starting' CHECK (status IN ('starting', 'running', 'waiting', 'stopped', 'error')),
  mode TEXT NOT NULL DEFAULT 'standard' CHECK (mode IN ('plan', 'standard', 'yolo')),
  thinking_enabled INTEGER NOT NULL DEFAULT 0,
  archived INTEGER NOT NULL DEFAULT 0,
  git_branch TEXT,
  git_worktree TEXT,
  pr_url TEXT,
  error TEXT,
  cost_usd REAL DEFAULT 0,
  claude_session_id TEXT,
  model TEXT,
  next_template_id TEXT REFERENCES session_templates(id) ON DELETE SET NULL,
  parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Conversations (multiple conversation threads per session)
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT,                           -- Auto from first message or user-defined
  summary TEXT,                        -- Per-conversation summary
  summary_generated_at INTEGER,        -- When summary was last generated
  is_active INTEGER NOT NULL DEFAULT 0, -- Currently selected conversation (1 = active)
  claude_session_id TEXT,              -- Claude SDK session ID for this conversation's context
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Conversation messages
CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  tool_use TEXT, -- JSON array of tool uses
  timestamp INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Canvas items
CREATE TABLE IF NOT EXISTS canvas_items (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('image', 'markdown', 'text', 'json', 'pdf', 'code')),
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
  content TEXT,  -- base64 data or file reference depending on storage_type
  file_path TEXT,  -- absolute path to file on disk (for Claude's Read tool)
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Command buttons (configurable buttons per project)
CREATE TABLE IF NOT EXISTS command_buttons (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  command TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
-- Note: idx_sessions_archived is created in migrations to handle existing databases
CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_session ON conversation_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_canvas_session ON canvas_items(session_id);
CREATE INDEX IF NOT EXISTS idx_notes_session ON session_notes(session_id);
CREATE INDEX IF NOT EXISTS idx_project_tools ON project_tool_templates(project_id);
CREATE INDEX IF NOT EXISTS idx_session_templates_project ON session_templates(project_id);
-- Note: idx_sessions_next_template and idx_sessions_parent are created in migrations
-- to handle existing databases that may not have these columns yet
CREATE INDEX IF NOT EXISTS idx_todos_session ON session_todos(session_id);
CREATE INDEX IF NOT EXISTS idx_work_logs_session ON work_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_work_logs_message ON work_logs(message_id);
CREATE INDEX IF NOT EXISTS idx_summaries_session ON session_summaries(session_id);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON message_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_attachments_session ON message_attachments(session_id);
CREATE INDEX IF NOT EXISTS idx_command_buttons_project ON command_buttons(project_id);
