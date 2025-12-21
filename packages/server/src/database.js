// Re-export everything from db module for backward compatibility
export {
  // Classes
  DatabaseManager,
  BaseRepository,
  ProjectRepository,
  SessionRepository,
  MessageRepository,
  CanvasItemRepository,
  SessionNoteRepository,
  TodoRepository,
  WorkLogRepository,
  SessionSummaryRepository,
  AttachmentRepository,
  // Singleton instances
  databaseManager,
  projects,
  sessions,
  messages,
  canvasItems,
  sessionNotes,
  todos,
  workLogs,
  sessionSummaries,
  attachments,
  // Legacy functions
  initDatabase,
  getDatabase,
  closeDatabase,
  generateId,
  transaction,
} from './db/index.js';
