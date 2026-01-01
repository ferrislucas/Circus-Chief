# Data Model Specification

This document describes the database tables required to back the claudetools.io application based on the architecture and wireframes.

---

## Table of Contents

1. [Overview](#overview)
2. [Entity Relationship Diagram](#entity-relationship-diagram)
3. [Tables](#tables)
   - [projects](#projects)
   - [sessions](#sessions)
   - [conversation_messages](#conversation_messages)
   - [canvas_items](#canvas_items)
   - [session_notes](#session_notes)
   - [global_tool_templates](#global_tool_templates)
   - [project_tool_templates](#project_tool_templates)
4. [Relationships Summary](#relationships-summary)
5. [Indexes](#indexes)
6. [Notes](#notes)

---

## Overview

The application manages Claude Code sessions organized under projects. Each project has a working directory and can contain multiple sessions. Sessions have conversation history, canvas items, notes, and can be linked to pull requests. Tool templates exist at both global and project levels to automate common tasks.

---

## Entity Relationship Diagram

```
┌─────────────────────────┐
│   global_tool_templates │
│─────────────────────────│
│ PK id                   │
│    name                 │
│    payload              │
│    payload_type         │
│    created_at           │
│    updated_at           │
└─────────────────────────┘


┌─────────────────────────┐       ┌─────────────────────────┐
│        projects         │       │ project_tool_templates  │
│─────────────────────────│       │─────────────────────────│
│ PK id                   │──┐    │ PK id                   │
│    name                 │  │    │ FK project_id           │──┐
│    working_directory    │  │    │    name                 │  │
│    created_at           │  │    │    payload              │  │
│    updated_at           │  │    │    payload_type         │  │
└─────────────────────────┘  │    │    created_at           │  │
           │                 │    │    updated_at           │  │
           │ 1               │    └─────────────────────────┘  │
           │                 │                                  │
           │                 └──────────────────────────────────┘
           │
           ▼ *
┌─────────────────────────┐
│        sessions         │
│─────────────────────────│
│ PK id                   │
│ FK project_id           │
│    name                 │
│    status               │
│    mode                 │
│    git_branch           │
│    git_worktree         │
│    pr_url               │
│    error                 │
│    created_at           │
│    updated_at           │
└─────────────────────────┘
           │
           │ 1
           │
           ├────────────────────┬────────────────────┐
           │                    │                    │
           ▼ *                  ▼ *                  ▼ *
┌───────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│conversation_messages│  │  canvas_items   │  │  session_notes  │
│───────────────────│  │─────────────────│  │─────────────────│
│ PK id             │  │ PK id           │  │ PK id           │
│ FK session_id     │  │ FK session_id   │  │ FK session_id   │
│    role           │  │    type         │  │    content      │
│    content        │  │    content      │  │    created_at   │
│    tool_use       │  │    data         │  │    updated_at   │
│    timestamp      │  │    mime_type    │  └─────────────────┘
└───────────────────┘  │    filename     │
                       │    label        │
                       │    width        │
                       │    height       │
                       │    created_at   │
                       └─────────────────┘
```

---

## Tables

### projects

Stores project information. A project groups related Claude Code sessions under a common working directory.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | Unique identifier |
| `name` | VARCHAR(255) | NOT NULL | User-provided project name |
| `working_directory` | VARCHAR(1024) | NOT NULL | Absolute path for all sessions in this project |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT NOW() | When the project was created |
| `updated_at` | TIMESTAMP | NOT NULL, DEFAULT NOW() | Last activity timestamp |

**Relationships:**
- One-to-Many with `sessions`: A project can have many sessions
- One-to-Many with `project_tool_templates`: A project can have many tool templates

---

### sessions

Stores Claude Code session information. Sessions represent individual Claude Code conversations within a project.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | Unique identifier |
| `project_id` | UUID | NOT NULL, FOREIGN KEY | References `projects.id` |
| `name` | VARCHAR(255) | NOT NULL | User-provided or auto-generated session name |
| `status` | ENUM | NOT NULL, DEFAULT 'starting' | Session status: `starting`, `running`, `waiting`, `completed`, `error` |
| `mode` | ENUM | NOT NULL, DEFAULT 'standard' | Execution mode: `plan`, `standard`, `yolo` |
| `git_branch` | VARCHAR(255) | NULL | Current branch if in git repo |
| `git_worktree` | VARCHAR(1024) | NULL | Worktree path if applicable |
| `pr_url` | VARCHAR(2048) | NULL | Linked pull request URL |
| `error` | TEXT | NULL | Error message if status is 'error' |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT NOW() | When the session was created |
| `updated_at` | TIMESTAMP | NOT NULL, DEFAULT NOW() | Last activity timestamp |

**Relationships:**
- Many-to-One with `projects`: Each session belongs to one project
- One-to-Many with `conversation_messages`: A session has many messages
- One-to-Many with `canvas_items`: A session can have many canvas items
- One-to-Many with `session_notes`: A session can have many notes

**Status Values:**
- `starting` - Session is initializing
- `running` - Claude is actively processing
- `waiting` - Session is waiting for user input
- `completed` - Session has finished
- `error` - Session encountered an error

**Mode Values:**
- `plan` - Claude creates a plan and asks for approval before making changes
- `standard` - Default mode with normal tool confirmations
- `yolo` - Claude executes without asking for confirmation

---

### conversation_messages

Stores the conversation history for each session.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | Unique identifier |
| `session_id` | UUID | NOT NULL, FOREIGN KEY | References `sessions.id` |
| `role` | ENUM | NOT NULL | Message role: `user`, `assistant`, `system` |
| `content` | TEXT | NOT NULL | Message content (may include markdown) |
| `tool_use` | JSONB | NULL | Array of tool use objects for assistant messages |
| `timestamp` | TIMESTAMP | NOT NULL, DEFAULT NOW() | When the message was created |

**Relationships:**
- Many-to-One with `sessions`: Each message belongs to one session

**Tool Use JSON Structure:**
```json
[
  {
    "name": "Read",
    "input": {
      "path": "src/services/auth.js"
    }
  },
  {
    "name": "Edit",
    "input": {
      "file": "src/services/auth.js",
      "changes": "..."
    }
  }
]
```

---

### canvas_items

Stores canvas items (images, documents, data) that Claude shares during sessions.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | Unique identifier |
| `session_id` | UUID | NULL, FOREIGN KEY | References `sessions.id` (NULL if global) |
| `type` | ENUM | NOT NULL | Item type: `image`, `markdown`, `text`, `json` |
| `content` | TEXT | NULL | Text content for markdown/text types |
| `data` | JSONB | NULL | JSON data for json type, base64 for images |
| `mime_type` | VARCHAR(100) | NULL | MIME type for images (e.g., `image/png`) |
| `filename` | VARCHAR(255) | NULL | Original filename if applicable |
| `label` | VARCHAR(255) | NULL | User-friendly label/description |
| `width` | INTEGER | NULL | Image width in pixels |
| `height` | INTEGER | NULL | Image height in pixels |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT NOW() | When the item was created |

**Relationships:**
- Many-to-One with `sessions`: Each canvas item optionally belongs to one session

**Type Values:**
- `image` - Screenshot, diagram, or other image (data stored as base64)
- `markdown` - Markdown document (content stored as text)
- `text` - Plain text (content stored as text)
- `json` - Structured JSON data (data stored as JSONB)

---

### session_notes

Stores user-created notes for sessions. Notes are useful for capturing context, decisions, or reminders.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | Unique identifier |
| `session_id` | UUID | NOT NULL, FOREIGN KEY | References `sessions.id` |
| `content` | TEXT | NOT NULL | Note content (supports markdown) |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT NOW() | When the note was created |
| `updated_at` | TIMESTAMP | NOT NULL, DEFAULT NOW() | When the note was last modified |

**Relationships:**
- Many-to-One with `sessions`: Each note belongs to one session

---

### global_tool_templates

Stores tool templates that are available across all sessions. Global tools always execute as shell commands.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | Unique identifier |
| `name` | VARCHAR(50) | NOT NULL | Display name for the tool |
| `payload` | VARCHAR(500) | NOT NULL | The shell command to execute |
| `payload_type` | ENUM | NOT NULL, DEFAULT 'command' | Always `command` for global tools |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT NOW() | When the template was created |
| `updated_at` | TIMESTAMP | NOT NULL, DEFAULT NOW() | When the template was last modified |

**Relationships:**
- None (global scope)

---

### project_tool_templates

Stores tool templates that are available within a specific project's sessions.

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| `id` | UUID | PRIMARY KEY | Unique identifier |
| `project_id` | UUID | NOT NULL, FOREIGN KEY | References `projects.id` |
| `name` | VARCHAR(50) | NOT NULL | Display name for the tool |
| `payload` | VARCHAR(1000) | NOT NULL | The command or prompt text |
| `payload_type` | ENUM | NOT NULL | Type: `command` or `prompt` |
| `created_at` | TIMESTAMP | NOT NULL, DEFAULT NOW() | When the template was created |
| `updated_at` | TIMESTAMP | NOT NULL, DEFAULT NOW() | When the template was last modified |

**Relationships:**
- Many-to-One with `projects`: Each template belongs to one project

**Payload Type Values:**
- `command` - Executes as a shell command in a background process
- `prompt` - Populates the session message input with the payload

---

## Relationships Summary

| Parent Table | Child Table | Relationship | Foreign Key |
|--------------|-------------|--------------|-------------|
| `projects` | `sessions` | One-to-Many | `sessions.project_id` |
| `projects` | `project_tool_templates` | One-to-Many | `project_tool_templates.project_id` |
| `sessions` | `conversation_messages` | One-to-Many | `conversation_messages.session_id` |
| `sessions` | `canvas_items` | One-to-Many | `canvas_items.session_id` |
| `sessions` | `session_notes` | One-to-Many | `session_notes.session_id` |

### Cascade Behavior

- When a **project** is deleted:
  - All related `sessions` should be deleted (CASCADE)
  - All related `project_tool_templates` should be deleted (CASCADE)

- When a **session** is deleted:
  - All related `conversation_messages` should be deleted (CASCADE)
  - All related `canvas_items` should be deleted (CASCADE)
  - All related `session_notes` should be deleted (CASCADE)

---

## Indexes

### Primary Indexes (created automatically)
- `projects.id`
- `sessions.id`
- `conversation_messages.id`
- `canvas_items.id`
- `session_notes.id`
- `global_tool_templates.id`
- `project_tool_templates.id`

### Foreign Key Indexes
- `sessions.project_id`
- `conversation_messages.session_id`
- `canvas_items.session_id`
- `session_notes.session_id`
- `project_tool_templates.project_id`

### Query Optimization Indexes
- `sessions.status` - For filtering active sessions
- `sessions.created_at` - For sorting sessions by date
- `sessions.updated_at` - For sorting by recent activity
- `conversation_messages.timestamp` - For ordering messages chronologically
- `canvas_items.created_at` - For sorting canvas items
- `canvas_items.type` - For filtering by item type
- `projects.updated_at` - For sorting projects by activity

### Composite Indexes
- `sessions(project_id, status)` - For listing active sessions per project
- `sessions(project_id, updated_at)` - For listing recent sessions per project
- `conversation_messages(session_id, timestamp)` - For paginated message retrieval

---

## Notes

### Storage Considerations

1. **Image Storage**: Canvas images are stored as base64 in the `data` column. For production use with large images, consider:
   - Storing images in a file system or object storage (S3, etc.)
   - Storing only file paths/URLs in the database

2. **Message History**: Conversation messages can grow large. Consider:
   - Archiving old sessions
   - Implementing pagination for message retrieval
   - Compressing older message content

3. **In-Memory Option**: The architecture document mentions "in-memory + optional disk" for canvas storage. The data model supports both:
   - In-memory: Keep data in application memory, persist to SQLite on shutdown
   - Disk: Use SQLite or PostgreSQL for immediate persistence

### Local-First Architecture

Since this is a local-first application:
- SQLite is the recommended database for single-user deployment
- No need for complex replication or distributed systems
- Data stays on the user's machine for privacy
- Simple backup via file copy

### Future Considerations

1. **Session Archiving**: Add an `archived_at` column to sessions for soft-delete functionality
2. **Message Streaming**: The `conversation_messages` table structure supports storing complete messages; streaming deltas are handled in-memory
3. **Multi-user Support**: If needed in the future, add a `user_id` column to projects
4. **Tags/Labels**: Consider adding a `session_tags` junction table for organizing sessions
