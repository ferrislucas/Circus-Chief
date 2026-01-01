import { onMounted, onUnmounted } from 'vue';

const shortcuts = new Map();

function handleKeyDown(event) {
  const key = getKeyString(event);
  const handlers = shortcuts.get(key);
  if (handlers) {
    for (const handler of handlers) {
      handler(event);
    }
  }
}

function getKeyString(event) {
  const parts = [];
  if (event.metaKey || event.ctrlKey) parts.push('mod');
  if (event.shiftKey) parts.push('shift');
  if (event.altKey) parts.push('alt');
  parts.push(event.key.toLowerCase());
  return parts.join('+');
}

/**
 * Register global keyboard shortcuts
 * @param {Object.<string, Function>} mappings - Key to handler mappings
 */
export function useKeyboardShortcuts(mappings) {
  onMounted(() => {
    if (shortcuts.size === 0) {
      document.addEventListener('keydown', handleKeyDown);
    }

    for (const [key, handler] of Object.entries(mappings)) {
      if (!shortcuts.has(key)) {
        shortcuts.set(key, new Set());
      }
      shortcuts.get(key).add(handler);
    }
  });

  onUnmounted(() => {
    for (const [key, handler] of Object.entries(mappings)) {
      const handlers = shortcuts.get(key);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          shortcuts.delete(key);
        }
      }
    }

    if (shortcuts.size === 0) {
      document.removeEventListener('keydown', handleKeyDown);
    }
  });
}
