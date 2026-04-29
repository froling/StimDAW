<script lang="ts">
  import { app, sendDebug } from './stores.svelte';
  import { DebugCommands } from '../protocol/debug-cli';

  let input = $state('');
  let logEl: HTMLDivElement | undefined = $state();

  $effect(() => {
    // Scroll log to bottom on new entry
    if (app.debugLog.length && logEl) {
      logEl.scrollTop = logEl.scrollHeight;
    }
  });

  async function submit(): Promise<void> {
    const cmd = input.trim();
    if (!cmd) return;
    input = '';
    await sendDebug(cmd);
  }

  function handleKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') submit();
  }

  const quickCmds: Array<[string, string]> = [
    ['/0', 'Off'],
    ['/3', '30%'],
    ['/5', '50%'],
    ['/7', '70%'],
    ['/u', '+2'],
    ['/d', '−2'],
    ['/b', 'Btn'],
    ['/n', 'Next'],
    ['/v', 'Ver'],
    ['/?', 'Help'],
  ];

  function fmtTs(ts: number): string {
    const d = new Date(ts);
    const pad = (n: number) => n.toString().padStart(2, '0');
    return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  }
</script>

<section class="cli">
  <h2>Debug CLI</h2>

  <div class="quick">
    {#each quickCmds as [cmd, label]}
      <button onclick={() => sendDebug(cmd)} disabled={app.connection === 'disconnected'}>
        <span class="cmd">{cmd}</span>
        <span class="label">{label}</span>
      </button>
    {/each}
  </div>

  <div class="log" bind:this={logEl}>
    {#each app.debugLog as entry (entry.ts)}
      <div class="entry {entry.direction}">
        <span class="ts">{fmtTs(entry.ts)}</span>
        <span class="dir">{entry.direction === 'sent' ? '▶' : entry.direction === 'received' ? '◀' : '·'}</span>
        <span class="text">{entry.text}</span>
      </div>
    {/each}
  </div>

  <div class="input">
    <input
      type="text"
      placeholder="/X command"
      bind:value={input}
      onkeydown={handleKey}
      disabled={app.connection === 'disconnected'}
    />
    <button
      onclick={submit}
      disabled={app.connection === 'disconnected' || !input.trim()}
    >Send</button>
  </div>
</section>

<style>
  .cli {
    background: white;
    border: 1px solid #e5e5e5;
    border-radius: 8px;
    padding: 1rem 1.25rem;
    display: flex;
    flex-direction: column;
    min-height: 0;
  }
  h2 {
    margin: 0 0 0.75rem;
    font-size: 0.95rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: #666;
  }
  .quick {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
    margin-bottom: 0.75rem;
  }
  .quick button {
    padding: 0.35rem 0.7rem;
    border: 1px solid #d0d0d0;
    background: #fafafa;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.85rem;
    display: inline-flex;
    align-items: baseline;
    gap: 0.4rem;
  }
  .quick button:hover:not(:disabled) {
    background: #f0f0f0;
  }
  .quick button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .quick .cmd {
    font-family: ui-monospace, monospace;
    color: #0066cc;
    font-weight: 600;
  }
  .quick .label {
    color: #666;
    font-size: 0.78rem;
  }
  .log {
    flex: 1;
    min-height: 180px;
    max-height: 260px;
    overflow-y: auto;
    background: #1a1a1a;
    color: #ccc;
    font-family: ui-monospace, monospace;
    font-size: 0.78rem;
    padding: 0.6rem;
    border-radius: 4px;
    margin-bottom: 0.5rem;
  }
  .entry {
    line-height: 1.45;
    display: grid;
    grid-template-columns: auto auto 1fr;
    gap: 0.5rem;
  }
  .entry.sent .dir { color: #66ddaa; }
  .entry.received .dir { color: #66aaff; }
  .entry.system .text { color: #888; font-style: italic; }
  .entry .ts {
    color: #555;
  }
  .input {
    display: flex;
    gap: 0.5rem;
  }
  .input input {
    flex: 1;
    padding: 0.5rem 0.75rem;
    border: 1px solid #d0d0d0;
    border-radius: 4px;
    font-family: ui-monospace, monospace;
    font-size: 0.9rem;
  }
  .input button {
    padding: 0.5rem 1rem;
    border: 1px solid #0066cc;
    background: #0066cc;
    color: white;
    border-radius: 4px;
    cursor: pointer;
    font-size: 0.9rem;
  }
  .input button:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
</style>
