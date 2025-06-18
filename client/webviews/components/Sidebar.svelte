<script lang="ts">
  import { onMount } from "svelte";
	import type {VizScriptObject} from "../../src/shared/types"
  import ScriptItem from "./ScriptItem.svelte";
  let vizscripts: VizScriptObject[] = [];
  let selectedScriptId: string;
  let selectedScript: VizScriptObject | undefined;
  let selectedScriptIds: string[] = []; // For multi-selection

  let hostname = "localhost";
  let port = 6100;
  let sidebarSettings: any = {};

	let selectedLayer = "MAIN_SCENE";
  let previousLayer = selectedLayer;

  $: selectedScript = vizscripts.find((script) => script.vizId === selectedScriptId) || undefined;

  const handleGetScripts = async () => {
    console.log('Getting scripts for layer:', selectedLayer);
		console.log('Hostname:', hostname);
		console.log('Port:', port);
    tsvscode.postMessage({
      type: "fetchscripts",
      value: { hostname, port, selectedLayer },
    });
  };

  const handleScriptPreview = () => {
    if (!selectedScript) return;
    tsvscode.postMessage({
      type: "onScriptSelected",
      value: selectedScript.vizId,
    });
  };

  const handleScriptPreviewEvent = (event: CustomEvent) => {
    const script = event.detail.script;
    if (!script) return;
    
    tsvscode.postMessage({
      type: "onScriptSelected",
      value: script.vizId,
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
			value: { vizId: selectedScript.vizId, selectedLayer, hostname, port },
		});
	};

	const handleResetScripts = () => {
		tsvscode.postMessage({
			type: "resetScripts",
		});
	};





	const handleLayerChange = (event: Event) => {
		const target = event.target as HTMLInputElement;
		console.log("Target", target);
		const currentState = tsvscode.getState() || {};

		const previousLayer = currentState.selectedLayer;
		const newLayer = target.value;

		if (previousLayer !== newLayer) {
			vizscripts = [];
			selectedScriptId = '';
			handleResetScripts();
		};

		const updatedState = {
			...currentState,
			selectedLayer: target.value
		};

		console.log("Updated state", updatedState);

		tsvscode.setState(updatedState);
	};

  const handleMessage = (event: any) => {
    const message = event.data;
    if (message.type === "receiveScripts") {
      console.log("Scripts received", message.value);
      vizscripts = [...message.value];
    } else if (message.type === "receiveSettings") {
      console.log("Settings received", message.value);
      hostname = message.value.hostName;
      port = message.value.hostPort;
      sidebarSettings = message.value.sidebar || {};
    } else if (message.type === "receiveState") {
      console.log("State received", message.value);
      vizscripts = [...message.value];
    } else if (message.type === "getSelectedScript") {
      // Respond with selected script data
      const script = selectedScript;
      tsvscode.postMessage({
        type: "selectedScriptResponse",
        value: script
      });
    } else if (message.type === "getSelectedScriptData") {
      // Respond with selected script data including connection info
      const script = selectedScript;
      if (script) {
        tsvscode.postMessage({
          type: "selectedScriptDataResponse",
          value: {
            vizId: script.vizId,
            hostname: hostname,
            port: port,
            selectedLayer: selectedLayer
          }
        });
      } else {
        tsvscode.postMessage({
          type: "selectedScriptDataResponse",
          value: null
        });
      }
    }
  };

  const handleScriptDoubleClick = (event: CustomEvent) => {
    selectedScriptId = event.detail.script.vizId;
    
    // Check setting for double-click action
    const doubleClickAction = sidebarSettings?.doubleClickAction || 'preview';
    
    if (doubleClickAction === 'edit') {
      handleScriptEdit();
    } else {
      handleScriptPreview();
    }
  };

  const handleScriptSelection = (event: CustomEvent) => {
    const { script, isShiftClick } = event.detail;
    
    if (isShiftClick && script.type === "Container" && !script.isGroup) {
      // Multi-select for container scripts only
      if (selectedScriptIds.includes(script.vizId)) {
        // Deselect if already selected
        selectedScriptIds = selectedScriptIds.filter(id => id !== script.vizId);
      } else {
        // Add to selection
        selectedScriptIds = [...selectedScriptIds, script.vizId];
      }
    } else {
      // Single selection - clear multi-selection
      selectedScriptIds = [];
      selectedScriptId = script.vizId;
      
      const currentState = tsvscode.getState() || {};
      const updatedState = {
        ...currentState,
        selectedScriptId: script.vizId
      };
      tsvscode.setState(updatedState);
    }
  };



  onMount(() => {
    tsvscode.postMessage({ type: "getSettings" });
    tsvscode.postMessage({ type: "loadState" });

		const currentState = tsvscode.getState() || {};
		console.log("Current state", currentState);

		selectedScriptId = currentState.selectedScriptId;
		selectedLayer = currentState.selectedLayer || "MAIN_SCENE";
		previousLayer = selectedLayer;


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
			<div class="flex gap-2 justify-between px-20">
				Viz Layer:
				<div class="flex gap-1">
					<input type="radio" id="front-layer" name="layer" value="FRONT_SCENE" bind:group={selectedLayer} on:change={handleLayerChange} />
					<label for="front-layer">Front</label>
				</div>
				<div class="flex gap-1">
					<input type="radio" id="main-layer" name="layer" value="MAIN_SCENE" bind:group={selectedLayer} on:change={handleLayerChange} />
					<label for="main-layer">Mid</label>
				</div>
				<div class="flex gap-1">
					<input type="radio" id="back-layer" name="layer" value="BACK_SCENE" bind:group={selectedLayer} on:change={handleLayerChange} />
					<label for="back-layer">Back</label>
				</div>
			</div>
			<button on:click={handleGetScripts}>Get scripts from Viz</button>
			
    </div>

    <div class="h-full flex flex-col bg-vscode-sideBar-background overflow-hidden">
      <div class="h-2/3 border-b-2 border-vscode-editorGroup-border overflow-auto">
        {#if vizscripts == undefined || vizscripts.length === 0}
          <div class="flex items-center justify-center h-full text-vscode-descriptionForeground">No scripts found</div>
        {:else}
          {#each Object.values(vizscripts) as script}
            <ScriptItem 
              {script} 
              {selectedScriptId}
              {selectedScriptIds}
              {sidebarSettings}
              on:doubleClick={handleScriptDoubleClick}
              on:scriptSelected={handleScriptSelection}
              on:preview={handleScriptPreviewEvent}
            />
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

						{#if selectedScript.isGroup}
							<div class="text-yellow-400">Group ({selectedScript.children.length} scripts)</div>
						{/if}
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
