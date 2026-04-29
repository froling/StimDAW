<script lang="ts">
  import { app, connectMock, simulateDisconnect, reconnectMock } from './stores.svelte';

  let statusLabel = $derived.by(() => {
    switch (app.connection) {
      case 'connected':
        return 'Connected to mock NeoDK';
      case 'ramping':
        return `Ramping up… (${app.rampInfo.effective}%)`;
      case 'connecting':
        return 'Connecting…';
      case 'disconnected':
        return 'Disconnected';
    }
  });

  let statusClass = $derived(app.connection);
</script>

<div class="banner {statusClass}">
  <div class="status">
    <span class="dot"></span>
    <span class="label">{statusLabel}</span>
    {#if app.lastError}
      <span class="error">⚠ {app.lastError}</span>
    {/if}
  </div>
  <div class="actions">
    {#if app.connection === 'disconnected'}
      <button onclick={() => (client_exists() ? reconnectMock() : connectMock())}>
        {client_exists() ? 'Reconnect' : 'Connect to mock'}
      </button>
    {:else if app.connection === 'connected' || app.connection === 'ramping'}
      <button class="ghost" onclick={simulateDisconnect} title="Dev: simulate transport drop">
        Simulate disconnect
      </button>
    {/if}
  </div>
</div>

<script lang="ts" module>
  // tiny helper used in template (Svelte requires it visible there)
  function client_exists(): boolean {
    return true; // we always have a mock available
  }
</script>

<style>
  .banner {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 0.6rem 1rem;
    border-radius: 6px;
    border: 1px solid;
    font-size: 0.9rem;
  }
  .banner.connected {
    background: #e8f5e9;
    border-color: #66bb66;
    color: #1b5e20;
  }
  .banner.ramping {
    background: #fff8e1;
    border-color: #ffb74d;
    color: #5d4037;
  }
  .banner.connecting {
    background: #f0f4ff;
    border-color: #80a8ff;
    color: #1a3a8a;
  }
  .banner.disconnected {
    background: #ffebee;
    border-color: #ef5350;
    color: #b71c1c;
  }
  .status {
    display: flex;
    align-items: center;
    gap: 0.6rem;
  }
  .dot {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: currentColor;
    animation: pulse 2s ease-in-out infinite;
  }
  .banner.disconnected .dot {
    animation: blink 1s ease-in-out infinite;
  }
  .ramping .dot {
    animation: pulse 0.6s ease-in-out infinite;
  }
  @keyframes pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
  @keyframes blink {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.2; }
  }
  .label {
    font-weight: 500;
  }
  .error {
    color: #b71c1c;
    margin-left: 0.5rem;
    font-size: 0.85rem;
  }
  button {
    padding: 0.35rem 0.85rem;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
    border: 1px solid currentColor;
    background: white;
    color: inherit;
  }
  button.ghost {
    background: transparent;
    opacity: 0.7;
  }
  button:hover {
    background: rgba(0, 0, 0, 0.04);
  }
</style>
