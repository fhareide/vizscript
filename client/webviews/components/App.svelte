<script lang="ts">
  import TailwindCss from "../TailwindCSS.svelte";
  import type { VizScriptObject } from "../types";

  import ScriptControls from "./ScriptControls.svelte";
  import Sidebar from "./Sidebar.svelte";
  export let viewId;

  console.log(viewId);
</script>

<TailwindCss />

{#if viewId === "main"}
  <Sidebar />
{:else if viewId === "secondary"}
  <ScriptControls />
{:else}
  <div>Default</div>
{/if}
