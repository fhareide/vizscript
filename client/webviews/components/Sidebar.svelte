<script lang="ts">
  import { onMount } from "svelte";
  import type {VizScriptObject, ScriptParameter, ScriptParametersData} from "../../src/shared/types"
  import ScriptItem from "./ScriptItem.svelte";
  import ScriptParameters from "./ScriptParameters.svelte";
  
  let vizscripts: VizScriptObject[] = $state([]);
  let selectedScriptId: string = $state('');
  let selectedScriptIds: string[] = $state([]); // For multi-selection

  let hostname = $state("localhost");
  let port = $state(6100);
  let sidebarSettings: any = $state({});
  let useGlobalSettings = $state(true); // Default to using global settings

  let selectedLayer = $state("MAIN_SCENE");
  let previousLayer = $state("MAIN_SCENE");

  // Script parameters state
  let parametersData: ScriptParametersData | null = $state(null);
  let showParameters = $state(true);
  let parametersCache: { [scriptId: string]: ScriptParametersData } = $state({}); // Controls collapsible parameters section
  let scriptParametersComponent: ScriptParameters | undefined = $state();
  
  // Resizer state
  let isResizing = $state(false);
  let scriptListHeight = $state(60); // Percentage of available space for script list
  let startY = $state(0);
  let startHeight = $state(0);

  let selectedScript = $derived(vizscripts.find((script) => script.vizId === selectedScriptId) || undefined);
  
  // Calculate effective script list height based on parameters panel state
  // When collapsed, leave enough space for the header (~10% should be sufficient for header visibility)
  let effectiveScriptListHeight = $derived(showParameters ? scriptListHeight : 90);

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

  const handleScriptPreviewCallback = (detail: { script: VizScriptObject }) => {
    const script = detail.script;
    if (!script) return;
    
    tsvscode.postMessage({
      type: "onScriptSelected",
      value: script.vizId,
    });
  };

  const handleScriptEdit = () => {
    if (!selectedScript) return;
    tsvscode.postMessage({
      type: "editScript",
      value: selectedScript.vizId,
    });
  };

  const handleScriptEditForceRefresh = () => {
    if (!selectedScript) return;
    tsvscode.postMessage({
      type: "editScriptForceRefresh",
      value: selectedScript.vizId,
    });
  };

  const handleScriptSet = () => {
    if (!selectedScript) {
      // If no script is selected, send empty vizId to clear/reset the scene
      tsvscode.postMessage({
        type: "setScript",
        value: { vizId: "", selectedLayer, hostname, port },
      });
      return;
    }
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

    const prevLayer = currentState.selectedLayer;
    const newLayer = target.value;

    if (prevLayer !== newLayer) {
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

  // Parameter handling functions
  function handleGetScriptParameters(detail: { scriptId: string; hostname: string; port: number }) {
    tsvscode.postMessage({
      type: "getScriptParameters",
      value: detail
    });
  }

  function handleSetScriptParameter(detail: { scriptId: string; parameterName: string; value: string; hostname: string; port: number }) {
    tsvscode.postMessage({
      type: "setScriptParameter",
      value: detail
    });
  }

  function handleInvokeScriptParameter(detail: { scriptId: string; parameterName: string; hostname: string; port: number }) {
    tsvscode.postMessage({
      type: "invokeScriptParameter",
      value: detail
    });
  }

  // Resizer functions
  function startResize(event: MouseEvent) {
    isResizing = true;
    startY = event.clientY;
    startHeight = scriptListHeight;
    
    document.addEventListener('mousemove', handleResize);
    document.addEventListener('mouseup', stopResize);
    document.body.style.cursor = 'row-resize';
    event.preventDefault();
  }

  function handleResize(event: MouseEvent) {
    if (!isResizing) return;
    
    const deltaY = event.clientY - startY;
    
    // Get the actual container height for true 1:1 resizing
    const container = document.querySelector('.h-full.flex.flex-col.bg-vscode-sideBar-background');
    if (!container) return;
    
    const containerHeight = container.clientHeight;
    const deltaPercent = (deltaY / containerHeight) * 100;
    
    let newHeight = startHeight + deltaPercent;
    newHeight = Math.max(20, Math.min(80, newHeight)); // Limit between 20% and 80%
    
    scriptListHeight = newHeight;
  }

  function stopResize() {
    isResizing = false;
    document.removeEventListener('mousemove', handleResize);
    document.removeEventListener('mouseup', stopResize);
    document.body.style.cursor = '';
    
    // Save the resize state
    const currentState = tsvscode.getState() || {};
    const updatedState = {
      ...currentState,
      scriptListHeight: scriptListHeight,
      parametersCache
    };
    tsvscode.setState(updatedState);
  }

  const handleMessage = (event: any) => {
    const message = event.data;
    if (message.type === "receiveScripts") {
      console.log("Scripts received", message.value);
      vizscripts = [...message.value];
    } else if (message.type === "receiveSettings") {
      console.log("Settings received", message.value);
      
      // Always update the settings object
      sidebarSettings = message.value.sidebar || {};
      
      // Only update hostname/port if using global settings
      if (useGlobalSettings) {
        hostname = message.value.hostName;
        port = message.value.hostPort;
      }
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
    } else if (message.type === "receiveScriptParameters") {
      // Delegate to ScriptParameters component
      if (scriptParametersComponent) {
        scriptParametersComponent.handleParametersReceived(message.value);
        // Update local cache as well
        parametersData = message.value;
        if (parametersData && parametersData.scriptId) {
          parametersCache[parametersData.scriptId] = parametersData;
        }
      }
    }
  };

  const handleScriptDoubleClick = (detail: { script: VizScriptObject }) => {
    selectedScriptId = detail.script.vizId;
    
    // Check setting for double-click action
    const doubleClickAction = sidebarSettings?.doubleClickAction || 'preview';
    
    if (doubleClickAction === 'edit') {
      handleScriptEdit();
    } else {
      handleScriptPreview();
    }
  };

  const handleScriptSelection = (detail: { script: VizScriptObject; isShiftClick: boolean }) => {
    const { script, isShiftClick } = detail;
    
    if (isShiftClick && script.type === "Container" && !script.isGroup) {
      // Multi-select for container scripts only
      if (selectedScriptIds.includes(script.vizId)) {
        // Deselect if already selected
        selectedScriptIds = selectedScriptIds.filter(id => id !== script.vizId);
      } else {
        // Add to selection - include the current selected script if it's a container and not already in the list
        let newSelection = [...selectedScriptIds];
        
        // If we have a single selected script that's a container and not in multi-selection, add it
        if (selectedScriptId && !selectedScriptIds.includes(selectedScriptId)) {
          const currentScript = vizscripts.find(s => s.vizId === selectedScriptId);
          if (currentScript && currentScript.type === "Container" && !currentScript.isGroup) {
            newSelection.push(selectedScriptId);
          }
        }
        
        // Add the new script
        newSelection.push(script.vizId);
        selectedScriptIds = newSelection;
        
        // Clear single selection when multi-selecting
        selectedScriptId = '';
      }
    } else {
      // Single selection - clear multi-selection
      selectedScriptIds = [];
      selectedScriptId = script.vizId;
    }
    
    // Fetch parameters for the selected script (pass script directly to avoid reactive timing issues)
    if (scriptParametersComponent) {
      scriptParametersComponent.fetchParametersForSelectedScript(script);
    }
    
    // Save state
    const currentState = tsvscode.getState() || {};
    const updatedState = {
      ...currentState,
      selectedScriptId: selectedScriptId,
      selectedScriptIds: selectedScriptIds,
      parametersCache
    };
    tsvscode.setState(updatedState);
  };

  // Handle toggling between global settings and manual input
  const handleGlobalSettingsToggle = (event: Event) => {
    const target = event.target as HTMLInputElement;
    useGlobalSettings = target.checked;
    
    if (useGlobalSettings) {
      // Request current settings from extension
      tsvscode.postMessage({ type: "getSettings" });
    }
    
    // Save the preference in state
    saveCurrentState();
  };

  // Save manual hostname/port changes to state when not using global settings
  const handleManualConnectionChange = () => {
    if (!useGlobalSettings) {
      saveCurrentState();
    }
  };

  // Helper function to save current state
  const saveCurrentState = () => {
    const currentState = tsvscode.getState() || {};
    const updatedState = {
      ...currentState,
      useGlobalSettings,
      manualHostname: useGlobalSettings ? undefined : hostname,
      manualPort: useGlobalSettings ? undefined : port,
      parametersCache,
    };
    tsvscode.setState(updatedState);
  };

  // Handle clicks on the script list container to deselect when clicking outside items
  const handleContainerClick = (event: MouseEvent) => {
    // Only deselect if the click target is the container itself, not a child element
    if (event.target === event.currentTarget) {
      selectedScriptId = '';
      selectedScriptIds = [];
      
      // Save state
      const currentState = tsvscode.getState() || {};
      const updatedState = {
        ...currentState,
        selectedScriptId: '',
        selectedScriptIds: []
      };
      tsvscode.setState(updatedState);
    }
  };

  onMount(() => {
    // Always get settings to populate the sidebar settings and conditionally the connection info
    tsvscode.postMessage({ type: "getSettings" });
    tsvscode.postMessage({ type: "loadState" });

    const currentState = tsvscode.getState() || {};
    console.log("Current state", currentState);

    selectedScriptId = currentState.selectedScriptId;
    selectedScriptIds = currentState.selectedScriptIds || [];
    selectedLayer = currentState.selectedLayer || "MAIN_SCENE";
    previousLayer = selectedLayer;

    // Restore resizer state
    if (currentState.scriptListHeight !== undefined) {
      scriptListHeight = currentState.scriptListHeight;
    }

    // Restore the global settings preference if saved in state
    if (currentState.useGlobalSettings !== undefined) {
      useGlobalSettings = currentState.useGlobalSettings;
    }

    // Restore parameters cache if saved in state
    if (currentState.parametersCache) {
      parametersCache = currentState.parametersCache;
    }

    // If not using global settings, restore manual values from state
    if (!useGlobalSettings && currentState.manualHostname && currentState.manualPort) {
      hostname = currentState.manualHostname;
      port = currentState.manualPort;
    }

    window.addEventListener("message", handleMessage);
    return () => window.removeEventListener("message", handleMessage);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->

<div class="h-full relative whitespace-nowrap w-full overflow-hidden" data-vscode-context={JSON.stringify({
    "preventDefaultContextMenuItems": true
  })}>
  <div class="h-full overflow-hidden">
    <div class="p-2 flex flex-col gap-2">
      <div class="flex items-center gap-2 mb-1">
        <input 
          type="checkbox" 
          id="use-global-settings" 
          bind:checked={useGlobalSettings} 
          onchange={handleGlobalSettingsToggle}
          class="rounded"
        />
        <label for="use-global-settings" class="text-sm">Use global connection settings</label>
      </div>
      <div class="flex gap-2">
        <input 
          type="Text" 
          placeholder="Hostname" 
          bind:value={hostname} 
          disabled={useGlobalSettings}
          onchange={handleManualConnectionChange}
          class="w-1/2 bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border px-2 py-1 rounded text-sm focus:outline-none focus:border-vscode-focusBorder disabled:opacity-50 disabled:cursor-not-allowed" 
        />
        <input 
          type="Text" 
          placeholder="Port" 
          bind:value={port} 
          disabled={useGlobalSettings}
          onchange={handleManualConnectionChange}
          class="w-1/4 bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border px-2 py-1 rounded text-sm focus:outline-none focus:border-vscode-focusBorder disabled:opacity-50 disabled:cursor-not-allowed" 
        />
      </div>
      <div class="flex gap-2 justify-between px-20">
        Viz Layer:
        <div class="flex gap-1">
          <input type="radio" id="front-layer" name="layer" value="FRONT_SCENE" bind:group={selectedLayer} onchange={handleLayerChange} />
          <label for="front-layer">Front</label>
        </div>
        <div class="flex gap-1">
          <input type="radio" id="main-layer" name="layer" value="MAIN_SCENE" bind:group={selectedLayer} onchange={handleLayerChange} />
          <label for="main-layer">Mid</label>
        </div>
        <div class="flex gap-1">
          <input type="radio" id="back-layer" name="layer" value="BACK_SCENE" bind:group={selectedLayer} onchange={handleLayerChange} />
          <label for="back-layer">Back</label>
        </div>
      </div>
      <button 
        onclick={handleGetScripts}
        class="w-full bg-vscode-button-background text-vscode-button-foreground border-0 px-4 py-2 rounded cursor-pointer hover:bg-vscode-button-hoverBackground focus:outline-none focus:bg-vscode-button-hoverBackground transition-colors duration-150"
      >
        Get scripts from Viz
      </button>
      
    </div>

    <div class="h-full flex flex-col bg-vscode-sideBar-background">
      <div class="flex flex-col border-b border-vscode-editorGroup-border" style="height: {effectiveScriptListHeight}%">
        <div class="flex-1 overflow-auto" onclick={handleContainerClick}>
          {#if selectedScriptIds.length > 1}
            <div class="px-2 py-1 bg-vscode-editorGroupHeader-tabsBackground text-vscode-textLink-foreground text-xs">
              {selectedScriptIds.length} items selected (Shift+Click to select more, click empty space to deselect)
            </div>
          {/if}
          {#if vizscripts == undefined || vizscripts.length === 0}
            <ScriptItem 
              script={{
                name: "No scene script found",
                vizId: "",
                type: "Scene",
                extension: ".viz",
                code: "",
                scenePath: selectedLayer,
                isGroup: false,
                children: []
              }}
              selectedScriptId={selectedScriptId}
              selectedScriptIds={selectedScriptIds}
              {sidebarSettings}
              onDoubleClick={handleScriptDoubleClick}
              onScriptSelected={handleScriptSelection}
            />
          {:else}
            {#each Object.values(vizscripts) as script}
              <ScriptItem 
                {script} 
                {selectedScriptId}
                {selectedScriptIds}
                {sidebarSettings}
                onDoubleClick={handleScriptDoubleClick}
                onScriptSelected={handleScriptSelection}
              />
            {/each}
          {/if}
        </div>
        
        <!-- Script Info Section - Always at bottom -->
        <div class="border-t border-vscode-editorGroup-border">
          <div class="p-2 text-white">
            {#if selectedScript}
              <div class="flex justify-between items-start gap-2 mb-2">
                <div class="flex-1 overflow-hidden">
                  <div class="flex gap-2 items-center">
                    <div class="overflow-hidden text-ellipsis">{selectedScript.name}</div>
                    <div class="text-vscode-descriptionForeground text-sm">{selectedScript.type}</div>
                  </div>
                  <div class="text-xs text-vscode-descriptionForeground">{selectedScript.scenePath}</div>
                  {#if selectedScript.isGroup}
                    <div class="text-yellow-400 text-xs">Group ({selectedScript.children.length} scripts)</div>
                  {/if}
                </div>
                <div class="text-xs text-vscode-descriptionForeground">{selectedScript.extension}</div>
              </div>
              
              <div class="flex gap-2 mb-2">
                <div class="flex-1 flex gap-1">
                  <button 
                    onclick={handleScriptEdit}
                    class="flex-1 bg-vscode-button-background text-vscode-button-foreground border-0 px-2 py-1 rounded text-md cursor-pointer hover:bg-vscode-button-hoverBackground transition-colors"
                  >
                    Edit
                  </button>
                </div>
                <button 
                  onclick={handleScriptPreview}
                  class="flex-1 bg-vscode-button-background text-vscode-button-foreground border-0 px-2 py-1 rounded text-md cursor-pointer hover:bg-vscode-button-hoverBackground transition-colors"
                >
                  Preview
                </button>
              </div>
              
              <button 
                onclick={handleScriptSet}
                class="w-full bg-vscode-button-background text-vscode-button-foreground border-0 px-2 py-1 rounded text-md cursor-pointer hover:bg-vscode-button-hoverBackground transition-colors"
              >
                Set script in Viz
              </button>
            {:else}
              <div class="flex justify-between items-start gap-2 mb-2">
                <div class="flex-1 overflow-hidden">
                  <div class="flex gap-2 items-center">
                    <div class="text-vscode-descriptionForeground">No script selected</div>
                  </div>
                  <div class="text-xs text-vscode-descriptionForeground">Select a script to view details and controls</div>
                </div>
              </div>
              
              <div class="flex gap-2 mb-2">
                <div class="flex-1 flex gap-1">
                  <button 
                    disabled
                    class="flex-1 bg-vscode-button-background text-vscode-button-foreground border-0 px-2 py-1 rounded text-md opacity-50 cursor-not-allowed"
                  >
                    Edit
                  </button>
                </div>
                <button 
                  disabled
                  class="flex-1 bg-vscode-button-background text-vscode-button-foreground border-0 px-2 py-1 rounded text-md opacity-50 cursor-not-allowed"
                >
                  Preview
                </button>
              </div>
              
              <button 
                disabled
                class="w-full bg-vscode-button-background text-vscode-button-foreground border-0 px-2 py-1 rounded text-md opacity-50 cursor-not-allowed"
              >
                Set script in Viz
              </button>
            {/if}
          </div>
        </div>
      </div>

      <!-- Resize Handle - Only show when parameters panel is expanded -->
      {#if showParameters}
        <div 
          class="h-1 bg-vscode-editorGroup-border hover:bg-vscode-focusBorder cursor-row-resize flex items-center justify-center relative group select-none"
          onmousedown={startResize}
        >
          <div class="w-8 h-0.5 bg-vscode-descriptionForeground group-hover:bg-vscode-foreground rounded transition-colors"></div>
        </div>
      {/if}

      <!-- Bottom Section Container -->
      <div class="flex flex-col" style="height: {100 - effectiveScriptListHeight}%">
        <!-- Script Info and Controls Section -->


      <!-- Script Parameters Component -->
      <ScriptParameters 
        bind:this={scriptParametersComponent}
        {selectedScript}
        {hostname}
        {port}
        bind:parametersData
        bind:parametersCache
        bind:showParameters
        onGetParameters={handleGetScriptParameters}
        onSetParameter={handleSetScriptParameter}
        onInvokeParameter={handleInvokeScriptParameter}
      />
      </div> <!-- Close Bottom Section Container -->
    </div>
  </div>
</div>

<style>
  /* Resize handle styling */
  .cursor-row-resize {
    cursor: row-resize;
  }

  .cursor-row-resize:active {
    background-color: var(--vscode-focusBorder);
  }

  /* Prevent text selection during resize */
  .select-none {
    -webkit-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    user-select: none;
  }
</style>
