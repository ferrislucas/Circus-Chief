<template>
  <div class="app">
    <header class="app-header">
      <div class="container">
        <router-link to="/" class="logo">
          <img src="/logo.png" alt="ClaudeTools.io Logo" class="logo-image" />
        </router-link>
        <nav class="nav">
          <router-link to="/sessions/active" class="nav-link">Active Sessions</router-link>
          <router-link to="/settings/providers" class="nav-link">Providers</router-link>
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
import ToastContainer from './components/ToastContainer.vue';
</script>

<style scoped>
.app {
  min-height: 100vh;
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
  top: 0;
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
}

.nav-link {
  color: var(--color-text-soft);
  font-size: 0.875rem;
  font-weight: 500;
  text-decoration: none;
  transition: color 0.2s ease;
  padding: 0.5rem 0;
  border-bottom: 2px solid transparent;
}

.nav-link:hover {
  color: var(--color-text);
}

.nav-link.router-link-active {
  color: var(--color-primary);
  border-bottom-color: var(--color-primary);
}

.app-main {
  flex: 1 0 auto;
  padding: 0;
}
</style>
