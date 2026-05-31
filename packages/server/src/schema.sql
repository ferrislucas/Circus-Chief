CREATE TABLE IF NOT EXISTS projects (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  working_directory TEXT NOT NULL,
  system_prompt TEXT,
  on_session_created TEXT,
  on_session_deleted TEXT,
  pr_poll_interval INTEGER NOT NULL DEFAULT 60000,
  repo_url TEXT,
  worktree_path TEXT,
  kanban_enabled INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS session_templates (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  prompt TEXT NOT NULL,
  next_template_id TEXT REFERENCES session_templates(id) ON DELETE SET NULL,
  thinking_enabled INTEGER,
  git_branch TEXT,
  git_mode TEXT,
  model TEXT,
  mode TEXT DEFAULT 'yolo' CHECK(mode IN ('plan', 'standard', 'yolo')),
  effort_level TEXT CHECK(effort_level IN ('low', 'medium', 'high', 'max', 'auto')),
  target_lane_id TEXT REFERENCES kanban_lanes(id) ON DELETE SET NULL,
  show_in_quick_responses INTEGER NOT NULL DEFAULT 0,
  quick_response_auto_submit INTEGER NOT NULL DEFAULT 0,
  quick_response_sort_order INTEGER NOT NULL DEFAULT 0,
  legacy_quick_response_id TEXT UNIQUE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  base_url TEXT,
  auth_token TEXT,
  api_timeout_ms INTEGER,
  additional_env_vars TEXT,
  commit_attribution_override TEXT,
  is_built_in INTEGER NOT NULL DEFAULT 0,
  kind TEXT NOT NULL DEFAULT 'anthropic' CHECK(kind IN ('anthropic','openai','google')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS provider_models (
  id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
  model_id TEXT NOT NULL,
  display_name TEXT NOT NULL,
  description TEXT,
  tier TEXT CHECK(tier IN ('opus', 'sonnet', 'haiku', 'custom')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'starting' CHECK (status IN ('starting', 'running', 'waiting', 'stopped', 'completed', 'error', 'scheduled')),
  mode TEXT NOT NULL DEFAULT 'yolo' CHECK (mode IN ('plan', 'standard', 'yolo')),
  thinking_enabled INTEGER NOT NULL DEFAULT 1,
  archived INTEGER NOT NULL DEFAULT 0,
  git_branch TEXT,
  git_worktree TEXT,
  pr_url TEXT,
  pr_url_auto_link_disabled INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  effort_level TEXT CHECK(effort_level IN ('low', 'medium', 'high', 'max', 'auto')),
  cost_usd REAL DEFAULT 0,
  claude_session_id TEXT,
  model TEXT,
  provider_id TEXT REFERENCES providers(id),
  next_template_id TEXT REFERENCES session_templates(id) ON DELETE SET NULL,
  parent_session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  thinking_tokens INTEGER DEFAULT 0,
  cache_read_input_tokens INTEGER DEFAULT 0,
  cache_creation_input_tokens INTEGER DEFAULT 0,
  web_search_requests INTEGER DEFAULT 0,
  context_window INTEGER DEFAULT 200000,
  starred INTEGER NOT NULL DEFAULT 0,
  manually_named INTEGER NOT NULL DEFAULT 0,
  scheduled_at INTEGER DEFAULT NULL,
  reschedule_delay_minutes INTEGER DEFAULT 60,
  auto_reschedule_enabled INTEGER DEFAULT 0,
  reschedule_on_token_limit INTEGER DEFAULT 1,
  reschedule_on_service_error INTEGER DEFAULT 1,
  max_reschedule_count INTEGER DEFAULT NULL,
  max_total_tokens INTEGER DEFAULT NULL,
  reschedule_count INTEGER DEFAULT 0,
  reschedule_at_token_count INTEGER DEFAULT NULL,
  pending_prompt TEXT,
  slash_commands TEXT,
  pending_model TEXT,
  auto_send_pending_prompt INTEGER DEFAULT 0,
  agent_type TEXT DEFAULT 'claude-code',
  target_lane_id TEXT REFERENCES kanban_lanes(id) ON DELETE SET NULL,
  lane_trigger_depth INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  name TEXT,
  summary TEXT,
  summary_generated_at INTEGER,
  is_active INTEGER NOT NULL DEFAULT 0,
  claude_session_id TEXT,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  thinking_tokens INTEGER DEFAULT 0,
  cache_read_input_tokens INTEGER DEFAULT 0,
  cache_creation_input_tokens INTEGER DEFAULT 0,
  web_search_requests INTEGER DEFAULT 0,
  context_window INTEGER DEFAULT 200000,
  model TEXT,
  parent_conversation_id TEXT REFERENCES conversations(id) ON DELETE SET NULL,
  branch_from_message_id TEXT REFERENCES conversation_messages(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content TEXT NOT NULL,
  tool_use TEXT,
  model TEXT,
  timestamp INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS canvas_items (
  id TEXT PRIMARY KEY,
  session_id TEXT REFERENCES sessions(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('image', 'markdown', 'text', 'json', 'pdf', 'code')),
  content TEXT,
  data TEXT,
  mime_type TEXT,
  filename TEXT,
  width INTEGER,
  height INTEGER,
  deleted_at INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER
);

CREATE TABLE IF NOT EXISTS global_tool_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  payload TEXT NOT NULL,
  payload_type TEXT NOT NULL DEFAULT 'command' CHECK (payload_type = 'command'),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS project_tool_templates (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  payload TEXT NOT NULL,
  payload_type TEXT NOT NULL CHECK (payload_type IN ('command', 'prompt')),
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS session_todos (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  conversation_id TEXT REFERENCES conversations(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed')),
  position INTEGER NOT NULL,
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS work_logs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  message_id TEXT REFERENCES conversation_messages(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('thinking', 'tool_input', 'tool_output')),
  tool_name TEXT,
  content TEXT NOT NULL,
  timestamp INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS session_summaries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  short_summary TEXT NOT NULL,
  full_summary TEXT NOT NULL,
  key_actions TEXT,
  files_modified TEXT,
  outcome TEXT,
  message_count INTEGER,
  pr_merged INTEGER,
  pr_state TEXT,
  has_merge_conflicts INTEGER,
  ci_status TEXT,
  ci_failures TEXT,
  last_summarized_message_id TEXT,
  workflow_fingerprint TEXT,
  generated_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS message_attachments (
  id TEXT PRIMARY KEY,
  message_id TEXT REFERENCES conversation_messages(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  storage_type TEXT NOT NULL DEFAULT 'base64' CHECK (storage_type IN ('base64', 'file_path', 'project_file')),
  content TEXT,
  file_path TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS command_buttons (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  command TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  show_on_list INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS command_runs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  button_id TEXT NOT NULL REFERENCES command_buttons(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'success', 'error', 'killed')),
  output TEXT NOT NULL DEFAULT '',
  exit_code INTEGER,
  started_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS quick_responses (
  id TEXT PRIMARY KEY,
  project_id TEXT REFERENCES projects(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  content TEXT NOT NULL,
  auto_submit INTEGER NOT NULL DEFAULT 0,
  category TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS project_session_defaults (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE,
  mode TEXT CHECK(mode IN ('plan', 'standard', 'yolo')),
  thinking_enabled INTEGER,
  start_immediately INTEGER,
  git_mode TEXT CHECK(git_mode IN ('branch', 'worktree', 'current')),
  git_branch TEXT,
  model TEXT,
  provider_id TEXT REFERENCES providers(id),
  effort_level TEXT CHECK(effort_level IN ('low', 'medium', 'high', 'max', 'auto')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS agent_call_logs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  conversation_id TEXT,
  agent_type TEXT NOT NULL,
  model TEXT,
  call_type TEXT NOT NULL,
  prompt_length INTEGER,
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  thinking_tokens INTEGER DEFAULT 0,
  cache_read_tokens INTEGER DEFAULT 0,
  cache_write_tokens INTEGER DEFAULT 0,
  total_tokens INTEGER DEFAULT 0,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  duration_ms INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'streaming', 'completed', 'error')),
  error_message TEXT,
  metadata TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS kanban_boards (
  id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS kanban_lanes (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL REFERENCES kanban_boards(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  on_enter_template_id TEXT REFERENCES session_templates(id) ON DELETE SET NULL,
  on_enter_prompt TEXT,
  on_enter_mode TEXT,
  on_enter_model TEXT,
  on_enter_effort_level TEXT,
  on_enter_thinking_enabled INTEGER,
  on_enter_auto_reschedule_enabled INTEGER DEFAULT 0,
  on_enter_reschedule_delay_minutes INTEGER DEFAULT 60,
  on_enter_reschedule_on_token_limit INTEGER DEFAULT 1,
  on_enter_reschedule_on_service_error INTEGER DEFAULT 1,
  on_enter_max_reschedule_count INTEGER,
  on_enter_max_total_tokens INTEGER,
  on_enter_reschedule_at_token_count INTEGER,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS kanban_cards (
  id TEXT PRIMARY KEY,
  lane_id TEXT NOT NULL REFERENCES kanban_lanes(id) ON DELETE CASCADE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE TABLE IF NOT EXISTS kanban_card_sessions (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL REFERENCES kanban_cards(id) ON DELETE CASCADE,
  session_id TEXT NOT NULL UNIQUE REFERENCES sessions(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
);

CREATE INDEX IF NOT EXISTS idx_sessions_project ON sessions(project_id);
CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status);
CREATE INDEX IF NOT EXISTS idx_sessions_archived ON sessions(archived);
CREATE INDEX IF NOT EXISTS idx_sessions_starred ON sessions(archived, starred);
CREATE INDEX IF NOT EXISTS idx_sessions_next_template ON sessions(next_template_id);
CREATE INDEX IF NOT EXISTS idx_sessions_parent ON sessions(parent_session_id);
CREATE INDEX IF NOT EXISTS idx_sessions_scheduled ON sessions(scheduled_at) WHERE scheduled_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_conversations_session ON conversations(session_id);
CREATE INDEX IF NOT EXISTS idx_conversations_parent ON conversations(parent_conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_session ON conversation_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON conversation_messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_canvas_session ON canvas_items(session_id);
CREATE INDEX IF NOT EXISTS idx_canvas_deleted ON canvas_items(deleted_at);
CREATE INDEX IF NOT EXISTS idx_project_tools ON project_tool_templates(project_id);
CREATE INDEX IF NOT EXISTS idx_session_templates_project ON session_templates(project_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_session_templates_global_name ON session_templates(name) WHERE project_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_todos_session ON session_todos(session_id);
CREATE INDEX IF NOT EXISTS idx_todos_conversation ON session_todos(conversation_id);
CREATE INDEX IF NOT EXISTS idx_work_logs_session ON work_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_work_logs_message ON work_logs(message_id);
CREATE INDEX IF NOT EXISTS idx_summaries_session ON session_summaries(session_id);
CREATE INDEX IF NOT EXISTS idx_attachments_message ON message_attachments(message_id);
CREATE INDEX IF NOT EXISTS idx_attachments_session ON message_attachments(session_id);
CREATE INDEX IF NOT EXISTS idx_command_buttons_project ON command_buttons(project_id);
CREATE INDEX IF NOT EXISTS idx_command_runs_session ON command_runs(session_id);
CREATE INDEX IF NOT EXISTS idx_command_runs_button ON command_runs(button_id);
CREATE INDEX IF NOT EXISTS idx_command_runs_status ON command_runs(status);
CREATE INDEX IF NOT EXISTS idx_quick_responses_project ON quick_responses(project_id);
CREATE INDEX IF NOT EXISTS idx_quick_responses_sort ON quick_responses(project_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_provider_models_provider ON provider_models(provider_id);
CREATE INDEX IF NOT EXISTS idx_project_defaults_projectId ON project_session_defaults(project_id);
CREATE INDEX IF NOT EXISTS idx_agent_call_logs_session ON agent_call_logs(session_id);
CREATE INDEX IF NOT EXISTS idx_agent_call_logs_started ON agent_call_logs(started_at);
CREATE INDEX IF NOT EXISTS idx_agent_call_logs_agent_type ON agent_call_logs(agent_type);
CREATE INDEX IF NOT EXISTS idx_agent_call_logs_call_type ON agent_call_logs(call_type);
CREATE INDEX IF NOT EXISTS idx_agent_call_logs_status ON agent_call_logs(status);
CREATE INDEX IF NOT EXISTS idx_agent_call_logs_model ON agent_call_logs(model);
CREATE INDEX IF NOT EXISTS idx_kanban_boards_project ON kanban_boards(project_id);
CREATE INDEX IF NOT EXISTS idx_kanban_lanes_board ON kanban_lanes(board_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_kanban_cards_lane ON kanban_cards(lane_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_kanban_card_sessions_session ON kanban_card_sessions(session_id);
CREATE INDEX IF NOT EXISTS idx_kanban_card_sessions_card ON kanban_card_sessions(card_id);
