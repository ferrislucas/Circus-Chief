// Database manager
export { DatabaseManager, databaseManager } from './DatabaseManager.js';

// Base repository
export { BaseRepository } from './BaseRepository.js';

// Repository classes
export { ProjectRepository } from './ProjectRepository.js';
export { SessionRepository } from './SessionRepository.js';
export { MessageRepository } from './MessageRepository.js';
export { CanvasItemRepository } from './CanvasItemRepository.js';
export { SessionNoteRepository } from './SessionNoteRepository.js';
export { TodoRepository } from './TodoRepository.js';
export { WorkLogRepository } from './WorkLogRepository.js';
export { SessionSummaryRepository } from './SessionSummaryRepository.js';

// Singleton instances
import { ProjectRepository } from './ProjectRepository.js';
import { MessageRepository } from './MessageRepository.js';
import { CanvasItemRepository } from './CanvasItemRepository.js';
import { SessionNoteRepository } from './SessionNoteRepository.js';
import { TodoRepository } from './TodoRepository.js';
import { WorkLogRepository } from './WorkLogRepository.js';
import { SessionSummaryRepository } from './SessionSummaryRepository.js';

export const projects = new ProjectRepository();
export const messages = new MessageRepository();
export const canvasItems = new CanvasItemRepository();
export const sessionNotes = new SessionNoteRepository();
export const todos = new TodoRepository();
export const workLogs = new WorkLogRepository();
export const sessionSummaries = new SessionSummaryRepository();

// SessionRepository needs to be instantiated after messages is available
import { SessionRepository } from './SessionRepository.js';
export const sessions = new SessionRepository();

// Legacy function exports for backward compatibility
import { databaseManager } from './DatabaseManager.js';

export function initDatabase(dbPath) {
  return databaseManager.init(dbPath);
}

export function getDatabase() {
  return databaseManager.get();
}

export function closeDatabase() {
  return databaseManager.close();
}

export function generateId() {
  return databaseManager.generateId();
}

export function transaction(fn) {
  return databaseManager.transaction(fn);
}
