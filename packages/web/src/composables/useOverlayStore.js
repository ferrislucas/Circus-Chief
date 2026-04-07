import { inject } from 'vue';
import { useSessionsStore } from '../stores/sessions.js';
import { useTodosStore } from '../stores/todos.js';

/**
 * Injection keys for overlay store isolation.
 *
 * When a SessionChatOverlay provides its own isolated store instances via
 * Vue's provide/inject, all descendant components that use these composables
 * will receive the overlay-scoped stores instead of the global Pinia singletons.
 *
 * Components outside the overlay tree (or in tests without a provider) fall
 * back to the default Pinia singletons, preserving existing behaviour.
 */
export const SESSIONS_STORE_KEY = Symbol('overlay-sessions-store');
export const TODOS_STORE_KEY = Symbol('overlay-todos-store');

/**
 * Returns the sessions store from the nearest provider, or falls back to the
 * global Pinia singleton. Must be called during component setup().
 */
export function useInjectedSessionsStore() {
  return inject(SESSIONS_STORE_KEY, useSessionsStore());
}

/**
 * Returns the todos store from the nearest provider, or falls back to the
 * global Pinia singleton. Must be called during component setup().
 */
export function useInjectedTodosStore() {
  return inject(TODOS_STORE_KEY, useTodosStore());
}
