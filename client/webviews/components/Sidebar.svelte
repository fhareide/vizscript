<script lang="ts">
  import { onMount } from "svelte";
	import type {VizScriptObject} from "../../src/shared/types"
  import ScriptItem from "./ScriptItem.svelte";
  let vizscripts: VizScriptObject[] = [];
  let selectedScriptId: string;
  let selectedScript: VizScriptObject | undefined;

  let hostname = "localhost";
  let port = "6100";

  $: selectedScript = vizscripts.find((script) => script.vizId === selectedScriptId) || undefined;

  const handleGetScripts = async () => {
    tsvscode.postMessage({
      type: "getscripts",
      value: { hostname, port },
    });
  };

  const handleScriptPreview = () => {
    if (!selectedScript) return;
    tsvscode.postMessage({
      type: "onScriptSelected",
      value: selectedScript.vizId,
    });
  };

  const handleScriptDiff = () => {
    if (!selectedScript) return;
    tsvscode.postMessage({
      type: "diff",
      value: selectedScript.vizId,
    });
  };

  const handleScriptEdit = () => {
    if (!selectedScript) return;
    tsvscode.postMessage({
      type: "editScript",
      value: selectedScript.vizId,
    });
  };

	const handleScriptSet = () => {
		if (!selectedScript) return;
		tsvscode.postMessage({
			type: "setScript",
			value: selectedScript.vizId,
		});
	};

  const handleMessage = (event: any) => {
    const message = event.data;
    if (message.type === "receiveScripts") {
      console.log("Scripts received", message.value);
      //tsvscode.postMessage({ type: "saveState", value: { vizscripts: message.value } });
      vizscripts = [...message.value];
    } else if (message.type === "receiveSettings") {
      console.log("Settings received", message.value);
      hostname = message.value.hostName;
      port = message.value.hostPort;
    } else if (message.type === "receiveState") {
      console.log("State received", message.value);
      vizscripts = [...message.value];
    }
  };

  const handleScriptDoubleClick = (event: CustomEvent) => {
    selectedScriptId = event.detail.script.vizId;
    handleScriptPreview();
  };

  onMount(() => {
    tsvscode.postMessage({ type: "getSettings" });
    tsvscode.postMessage({ type: "loadState" });

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  });
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->

<div class="h-full relative whitespace-nowrap w-full overflow-hidden">
  <div class="h-full overflow-hidden">
    <div class="p-2 flex flex-col gap-2">
      <div class="flex gap-2">
        <input type="Text" placeholder="Hostname" bind:value={hostname} class="w-1/2" />
        <input type="Text" placeholder="Port" bind:value={port} class="w-1/4" />
      </div>
			<button on:click={handleGetScripts}>Get scripts from Viz</button>
    </div>

    <div class="h-full flex flex-col bg-vscode-sideBar-background overflow-hidden">
      <div class="h-2/3 border-b-2 border-vscode-editorGroup-border overflow-auto">
        {#if vizscripts == undefined || vizscripts.length === 0}
          <div class="flex items-center justify-center h-full text-vscode-descriptionForeground">No scripts found</div>
        {:else}
          {#each Object.values(vizscripts) as script}
            <ScriptItem {script} bind:selectedScriptId on:doubleClick={handleScriptDoubleClick} />
          {/each}
        {/if}
      </div>
      {#if selectedScript}
        <div class="h-1/3 flex text-white overflow-hidden">
          <div class="p-2 flex-1 flex-col justify-center overflow-hidden">
            <div class="flex gap-2">
              <div class="overflow-hidden flex">{selectedScript.name}</div>
              <div class="text-vscode-descriptionForeground">{selectedScript.type}</div>
            </div>
						<div>{selectedScript.scenePath}</div>
            <div class="items-center justify-end h-[24px] flex overflow-hidden pr-[7px]">
              {selectedScript.extension}
            </div>
            <div class="w-full flex flex-col gap-2">
              <button on:click={handleScriptEdit}>Edit</button>
              <button on:click={handleScriptPreview}>Preview</button>
              <button on:click={handleScriptDiff}>Diff</button>
							<button on:click={handleScriptSet}>Set script in Viz</button>
            </div>
          </div>
        </div>
      {:else}
        <div class="h-1/3 flex text-white">
          <div class="p-2 flex-1 flex-col justify-center overflow-hidden">
            <div class="flex gap-2">
              <div class="overflow-hidden flex">No script selected</div>
            </div>
          </div>
        </div>
      {/if}
    </div>
  </div>
</div>
