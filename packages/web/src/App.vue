<template>
  <div class="app">
    <header class="app-header" ref="headerRef">
      <div class="container">
        <router-link to="/" class="logo">
          <img src="/logo.png" alt="ClaudeTools.io Logo" class="logo-image" />
        </router-link>
        <nav class="nav">
          <SystemIndicators />
          <router-link to="/settings" class="nav-link" title="Settings">
            <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="4" y1="21" x2="4" y2="14"></line>
              <line x1="4" y1="10" x2="4" y2="3"></line>
              <line x1="12" y1="21" x2="12" y2="12"></line>
              <line x1="12" y1="8" x2="12" y2="3"></line>
              <line x1="20" y1="21" x2="20" y2="16"></line>
              <line x1="20" y1="12" x2="20" y2="3"></line>
              <line x1="1" y1="14" x2="7" y2="14"></line>
              <line x1="9" y1="8" x2="15" y2="8"></line>
              <line x1="17" y1="16" x2="23" y2="16"></line>
            </svg>
          </router-link>
        </nav>
      </div>
    </header>

    <main class="app-main">
      <router-view :key="$route.fullPath" />
    </main>

    <ToastContainer />
  </div>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import ToastContainer from './components/ToastContainer.vue';
import SystemIndicators from './components/SystemIndicators.vue';
import { useVisualViewport } from './composables/useVisualViewport.js';

// Initialize visual viewport tracking for iOS Safari browser chrome offset
useVisualViewport();

const headerRef = ref(null);
let resizeObserver = null;

function updateHeaderHeight() {
  if (headerRef.value) {
    const height = headerRef.value.offsetHeight;
    document.documentElement.style.setProperty('--header-height-computed', `${height}px`);
  }
}

// Double RAF ensures layout is settled on iOS Safari
// WebKit needs TWO frame callbacks to guarantee layout is complete
function measureAfterLayout() {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      updateHeaderHeight();
    });
  });
}

onMounted(() => {
  // Initial measurement after layout settles (critical for iOS Safari)
  measureAfterLayout();

  // ResizeObserver catches actual header size changes
  // More reliable than resize event for element-specific changes
  if (typeof ResizeObserver !== 'undefined' && headerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      updateHeaderHeight();
    });
    resizeObserver.observe(headerRef.value);
  }

  // Fallback for browsers without ResizeObserver + handles viewport changes
  window.addEventListener('resize', updateHeaderHeight);

  // Re-measure on orientation change (safe areas change on iPad)
  window.addEventListener('orientationchange', measureAfterLayout);
});

onUnmounted(() => {
  if (resizeObserver) {
    resizeObserver.disconnect();
  }
  window.removeEventListener('resize', updateHeaderHeight);
  window.removeEventListener('orientationchange', measureAfterLayout);
});
</script>

<style scoped>
.app {
  min-height: 100vh;
  min-height: 100dvh;
  display: flex;
  flex-direction: column;
}

.app-header {
  background-color: var(--color-background-soft);
  border-bottom: 1px solid var(--color-border);
  padding: 5px 0 !important;
  margin: 0 !important;
  display: flex;
  align-items: center;
  position: sticky;
  top: var(--viewport-offset-top, 0px);
  z-index: 100;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);

  /* Add safe area padding for iOS notch/status bar */
  padding-top: calc(5px + var(--safe-area-inset-top, 0px)) !important;
}

.app-header .container {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
  padding: 0 1rem !important;
  margin: 0 !important;
  max-width: 100%;
  width: 100%;
}

.logo {
  display: block;
  padding: 0 !important;
  margin: 0 !important;
  line-height: 0;
}

.logo-image {
  height: 40px;
  width: auto;
  max-width: 200px;
  display: block;
  margin: 0 !important;
  padding: 0 !important;
}

.logo:hover .logo-image {
  opacity: 0.8;
  transition: opacity 0.2s ease;
}

.nav {
  display: flex;
  gap: 1.5rem;
  align-items: center;
  flex-shrink: 1;
  min-width: 0;
}

.nav-link {
  color: var(--color-text-soft);
  font-size: 0.875rem;
  font-weight: 500;
  text-decoration: none;
  transition: color 0.2s ease;
  padding: 0.5rem 0;
  border-bottom: 2px solid transparent;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

.nav-link:hover {
  color: var(--color-text);
}

.nav-link.router-link-active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
}

@media (max-width: 480px) {
  .nav {
    gap: 0.75rem;
  }
}

.app-main {
  flex: 1 0 auto;
  padding: 0;
}
</style>
