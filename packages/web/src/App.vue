<template>
  <div class="app">
    <header class="app-header">
      <div class="container">
        <router-link to="/" class="logo">ClaudeTools.io</router-link>
        <nav class="nav">
          <router-link to="/" class="nav-link">Projects</router-link>
          <router-link to="/sessions/active" class="nav-link">Sessions</router-link>
        </nav>
      </div>
    </header>

    <main class="app-main">
      <router-view />
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
  height: var(--header-height);
  display: flex;
  align-items: center;
  position: sticky;
  top: 0;
  z-index: 100;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
}

.app-header .container {
  display: flex;
  align-items: center;
  gap: 2rem;
}

.logo {
  font-size: 1.25rem;
  font-weight: 600;
  color: var(--color-text);
}

.logo:hover {
  text-decoration: none;
  color: var(--color-primary);
}

.nav {
  display: flex;
  gap: 1rem;
}

.nav-link {
  color: var(--color-text-soft);
  font-size: 0.875rem;
}

.nav-link:hover {
  color: var(--color-text);
}

.app-main {
  flex: 1;
  padding: 2rem 0;
}
</style>
