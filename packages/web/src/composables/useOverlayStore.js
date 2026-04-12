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
export const TELEPORT_TARGET_KEY = Symbol('overlay-teleport-target');

/**
 * Returns the sessions store from the nearest provider, or falls back to the
 * global Pinia singleton. Must be called during component setup().
 *
 * @example
 * // In a component rendered inside SessionChatOverlay's tree:
 * import { useInjectedSessionsStore } from '../composables/useOverlayStore.js';
 *
 * const sessionsStore = useInjectedSessionsStore();
 * // `sessionsStore` is the overlay's isolated instance when inside the overlay,
 * // or the global Pinia singleton everywhere else.
 *
 * // DO NOT do this inside overlay-rendered components:
 * // import { useSessionsStore } from '../stores/sessions.js';
 * // const store = useSessionsStore();  // <-- bypasses overlay isolation!
 */
export function useInjectedSessionsStore() {
  return inject(SESSIONS_STORE_KEY, useSessionsStore());
}

/**
 * Returns the todos store from the nearest provider, or falls back to the
 * global Pinia singleton. Must be called during component setup().
 *
 * @example
 * // In a component rendered inside SessionChatOverlay's tree:
 * import { useInjectedTodosStore } from '../composables/useOverlayStore.js';
 *
 * const todosStore = useInjectedTodosStore();
 * // `todosStore` is the overlay's isolated instance when inside the overlay,
 * // or the global Pinia singleton everywhere else.
 *
 * // DO NOT do this inside overlay-rendered components:
 * // import { useTodosStore } from '../stores/todos.js';
 * // const store = useTodosStore();  // <-- bypasses overlay isolation!
 */
export function useInjectedTodosStore() {
  return inject(TODOS_STORE_KEY, useTodosStore());
}

/**
 * Returns whether modals should disable teleporting when inside the overlay.
 *
 * When inside a SessionChatOverlay (which uses a native <dialog> in the top layer),
 * modals must NOT teleport to <body> — doing so moves them outside the dialog's
 * top layer, where the ::backdrop blocks pointer events. By disabling the Teleport,
 * modals render inline within the dialog and remain fully interactive.
 *
 * Outside the overlay tree, returns false so modals teleport to body as normal.
 *
 * @returns {boolean} true when inside the overlay (disable teleport), false otherwise.
 */
export function useOverlayTeleportDisabled() {
  return inject(TELEPORT_TARGET_KEY, false);
}
