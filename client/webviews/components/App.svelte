<script lang="ts">
  import ScriptControls from "./ScriptControls.svelte";
  import Sidebar from "./Sidebar.svelte";
  export let viewId;

  console.log(viewId);
</script>


{#if viewId === "main"}
  <Sidebar />
{:else if viewId === "secondary"}
  <ScriptControls />
{:else}
  <div>Default</div>
{/if}
