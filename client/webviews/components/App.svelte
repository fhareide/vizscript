<script>
	  import TailwindCss from "../TailwindCSS.svelte";
  import Sidebar from "./Sidebar.svelte";
  export let viewId;
</script>

<TailwindCss />

{#if viewId === 'main'}
  <Sidebar />
{:else if viewId === 'secondary'}
  <div>Secondary</div>
{:else}
	<div>Default</div>
{/if}
