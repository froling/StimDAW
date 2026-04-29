<script lang="ts">
  import { stop } from './stores.svelte';
</script>

<button class="stop" onclick={stop} title="Emergency stop — instant amplitude=0">
  STOP
</button>

<style>
  .stop {
    background: #cc0033;
    color: white;
    border: none;
    border-radius: 8px;
    padding: 0.85rem 1.5rem;
    font-size: 1.1rem;
    font-weight: 700;
    letter-spacing: 0.08em;
    cursor: pointer;
    box-shadow: 0 2px 8px rgba(204, 0, 51, 0.3);
    transition: transform 0.05s ease, box-shadow 0.05s ease;
    min-width: 120px;
  }
  .stop:hover {
    background: #b8002d;
    box-shadow: 0 3px 12px rgba(204, 0, 51, 0.4);
  }
  .stop:active {
    transform: translateY(1px);
    box-shadow: 0 1px 4px rgba(204, 0, 51, 0.3);
  }
</style>
