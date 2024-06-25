<script lang="ts">
  import TailwindCss from "../TailwindCSS.svelte";
  import type { VizScriptObject } from "../types";
  import ScriptItem from "./ScriptItem.svelte";
  import { onMount } from "svelte";

  let vizscripts: VizScriptObject[] = tsvscode.getState()?.vizscripts || [];

  const handleGetScripts = async () => {
    tsvscode.postMessage({
      type: "getscripts",
      value: "Get scripts",
    });
  };

  $: {
    tsvscode.setState({ vizscripts });
  }

  onMount(() => {
    window.addEventListener("message", (event) => {
      const message = event.data;
      switch (message.type) {
        case "getscripts":
          console.log("Scripts received", message.value);
          vizscripts = message.value;
          break;
      }
    });
  });
</script>

<TailwindCss />

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->

<div class="h-full relative whitespace-nowrap w-full">
  <div class="h-full overflow-hidden">
    <div class="p-2">
      <button on:click={handleGetScripts}>Get scripts from Viz</button>
    </div>

    <div class="h-full flex flex-col bg-vscode-sideBar-background">
      {#if vizscripts == undefined || vizscripts.length === 0}
        <div class="flex items-center justify-center h-full text-vscode-descriptionForeground">No scripts found</div>
      {:else}
        {#each Object.values(vizscripts) as script}
          <ScriptItem {script} />
        {/each}
      {/if}
    </div>
  </div>
</div>
