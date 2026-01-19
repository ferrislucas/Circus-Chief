// Database manager
export { DatabaseManager, databaseManager } from './DatabaseManager.js';

// Base repository
export { BaseRepository } from './BaseRepository.js';

// Repository classes
export { ProjectRepository } from './ProjectRepository.js';
export { ProjectDefaultsRepository } from './ProjectDefaultsRepository.js';
export { SessionRepository } from './SessionRepository.js';
export { SessionTemplateRepository } from './SessionTemplateRepository.js';
export { MessageRepository } from './MessageRepository.js';
export { ConversationRepository } from './ConversationRepository.js';
export { CanvasItemRepository } from './CanvasItemRepository.js';
export { SessionNoteRepository } from './SessionNoteRepository.js';
export { TodoRepository } from './TodoRepository.js';
export { WorkLogRepository } from './WorkLogRepository.js';
export { SessionSummaryRepository } from './SessionSummaryRepository.js';
export { AttachmentRepository } from './AttachmentRepository.js';
export { CommandButtonRepository } from './CommandButtonRepository.js';
export { CommandRunRepository } from './CommandRunRepository.js';
export { QuickResponseRepository } from './QuickResponseRepository.js';
export { SettingsRepository } from './SettingsRepository.js';

// Singleton instances
import { ProjectRepository } from './ProjectRepository.js';
import { ProjectDefaultsRepository } from './ProjectDefaultsRepository.js';
import { MessageRepository } from './MessageRepository.js';
import { ConversationRepository } from './ConversationRepository.js';
import { CanvasItemRepository } from './CanvasItemRepository.js';
import { SessionNoteRepository } from './SessionNoteRepository.js';
import { TodoRepository } from './TodoRepository.js';
import { WorkLogRepository } from './WorkLogRepository.js';
import { SessionSummaryRepository } from './SessionSummaryRepository.js';
import { SessionTemplateRepository } from './SessionTemplateRepository.js';
import { AttachmentRepository } from './AttachmentRepository.js';
import { CommandButtonRepository } from './CommandButtonRepository.js';
import { CommandRunRepository } from './CommandRunRepository.js';
import { QuickResponseRepository } from './QuickResponseRepository.js';
import { SettingsRepository } from './SettingsRepository.js';

export const projects = new ProjectRepository();
export const projectDefaults = new ProjectDefaultsRepository();
export const messages = new MessageRepository();
export const conversations = new ConversationRepository();
export const canvasItems = new CanvasItemRepository();
export const sessionNotes = new SessionNoteRepository();
export const todos = new TodoRepository();
export const workLogs = new WorkLogRepository();
export const sessionSummaries = new SessionSummaryRepository();
export const sessionTemplates = new SessionTemplateRepository();
export const attachments = new AttachmentRepository();
export const commandButtons = new CommandButtonRepository();
export const commandRuns = new CommandRunRepository();
export const quickResponses = new QuickResponseRepository();
export const settings = new SettingsRepository();

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
