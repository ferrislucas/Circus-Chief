<template>
  <section class="circus-time-tab">
    <div class="circus-time-panel">
      <div class="circus-time-copy">
        <p class="eyebrow">Proprietary add-on</p>
        <h3>Circus Time</h3>
        <p>
          Configure recurring tasks that invoke templates, make HTTP calls, or
          execute commands on any recurring schedule.
        </p>
        <p>
          The Circus Time add-on is still in development. If Circus Chief is
          useful to you, you can support ongoing development by purchasing an
          early Circus Time license. Your support helps fund both Circus Chief
          and the Circus Time add-on.
        </p>
      </div>
      <a
        class="btn btn-primary"
        href="https://mydayoff.lemonsqueezy.com/"
        target="_blank"
        rel="noopener noreferrer"
      >
        Get Circus Time
      </a>
    </div>
  </section>
</template>

<style scoped>
.circus-time-tab {
  padding: 1rem 0;
}

.circus-time-panel {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1.5rem;
  padding: 1.25rem;
  border: 1px solid var(--color-border);
  border-radius: var(--border-radius);
  background: var(--color-background-soft);
}

.circus-time-copy {
  display: grid;
  gap: 0.5rem;
  max-width: 44rem;
}

.eyebrow {
  color: var(--color-primary);
  font-size: 0.75rem;
  font-weight: 700;
  line-height: 1;
  text-transform: uppercase;
}

h3 {
  color: var(--color-text);
  font-size: 1.25rem;
  line-height: 1.2;
}

p {
  color: var(--color-text-soft);
}

.btn {
  flex: 0 0 auto;
}

@media (max-width: 640px) {
  .circus-time-panel {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
