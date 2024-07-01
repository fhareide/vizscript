<script>
	import TailwindCss from "../TailwindCSS.svelte";
	import ScriptControls from "./ScriptControls.svelte";
	import Sidebar from "./Sidebar.svelte";
	export let viewId;
</script>

<TailwindCss />

{#if viewId === 'main'}
  <Sidebar />
{:else if viewId === 'secondary'}
  <ScriptControls />
{:else}
	<div>Default</div>
{/if}
