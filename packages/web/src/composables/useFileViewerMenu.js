import { ref, onMounted, onUnmounted } from 'vue';

export async function copyToClipboard(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    try {
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      return true;
    } catch (fallbackErr) {
      console.error('Copy failed:', fallbackErr);
      return false;
    }
  }
}

export function formatRelativeTime(timestamp) {
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `${days}d ago`;
  if (hours > 0) return `${hours}h ago`;
  if (minutes > 0) return `${minutes}m ago`;
  return 'just now';
}

export function formatLastModified(timestamp) {
  if (!timestamp) return '';
  const now = Date.now();
  const diff = now - timestamp;
  const seconds = Math.floor(diff / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  if (days > 0) return `Modified ${days}d ago`;
  if (hours > 0) return `Modified ${hours}h ago`;
  if (minutes > 0) return `Modified ${minutes}m ago`;
  return 'Modified just now';
}

export function useFileViewerMenu(props, emit) {
  const menuOpen = ref(false);
  const menuHighlightedIndex = ref(null);
  const menuContainerRef = ref(null);

  function toggleMenu() {
    menuOpen.value = !menuOpen.value;
    if (menuOpen.value) {
      menuHighlightedIndex.value = 0;
    }
  }

  function closeMenu() {
    menuOpen.value = false;
    menuHighlightedIndex.value = null;
  }

  async function handleMenuCopyFilename() {
    const filename = props.item.filename || 'Untitled';
    await copyToClipboard(filename);
    closeMenu();
  }

  function handleMenuDeleteAll() {
    const filename = props.item.filename || props.item.id;
    emit('deleteAll', filename);
    closeMenu();
  }

  function handleMenuKeyDown(event) {
    const itemCount = 2;
    switch (event.key) {
      case 'ArrowDown': {
        event.preventDefault();
        menuHighlightedIndex.value = menuHighlightedIndex.value === null ? 0 : (menuHighlightedIndex.value + 1) % itemCount;
        break;
      }
      case 'ArrowUp': {
        event.preventDefault();
        menuHighlightedIndex.value = menuHighlightedIndex.value === null ? itemCount - 1 : (menuHighlightedIndex.value - 1 + itemCount) % itemCount;
        break;
      }
      case 'Enter': {
        event.preventDefault();
        if (menuHighlightedIndex.value === 0) {
          handleMenuCopyFilename();
        } else if (menuHighlightedIndex.value === 1) {
          handleMenuDeleteAll();
        }
        break;
      }
      case 'Escape': {
        event.preventDefault();
        closeMenu();
        break;
      }
    }
  }

  function handleDocumentClick(event) {
    if (menuContainerRef.value && !menuContainerRef.value.contains(event.target)) {
      closeMenu();
    }
  }

  onMounted(() => {
    document.addEventListener('click', handleDocumentClick);
  });

  onUnmounted(() => {
    document.removeEventListener('click', handleDocumentClick);
  });

  return {
    menuOpen,
    menuHighlightedIndex,
    menuContainerRef,
    toggleMenu,
    closeMenu,
    handleMenuCopyFilename,
    handleMenuDeleteAll,
    handleMenuKeyDown,
  };
}
