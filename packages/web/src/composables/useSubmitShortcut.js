/**
 * Creates a keydown handler for Command+Enter (Mac) or Ctrl+Enter (Win/Linux)
 * @param {Function} callback - Function to call on shortcut
 * @returns {Function} Event handler
 */
export function useSubmitShortcut(callback) {
  return function handleKeydown(event) {
    if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      callback();
    }
  };
}
