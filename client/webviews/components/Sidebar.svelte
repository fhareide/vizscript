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

  // Sort and search state
  type SortOrder = "default" | "name-asc" | "name-desc" | "type";
  let sortOrder: SortOrder = $state("default");
  let sortOpen = $state(false);
  let searchTerm = $state("");
  // Use a plain array for collapsed group IDs — Svelte 5 fully proxies arrays
  let collapsedGroupIds: string[] = $state([]);

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
  let isMultiSelect = $derived(selectedScriptIds.length > 1);
  let multiSelectCount = $derived(selectedScriptIds.length);
  
  // Calculate effective script list height based on parameters panel state
  // When collapsed, leave enough space for the header (~10% should be sufficient for header visibility)
  let effectiveScriptListHeight = $derived(showParameters ? scriptListHeight : 90);

  // Build the set of all child vizIds across all groups
  let childVizIds = $derived(new Set(
    vizscripts.filter(s => s.isGroup).flatMap(s => s.children)
  ));

  // Sorted and filtered display list
  // Each entry: { script, depth, childrenMatchSearch } where depth=1 means indented child under a group
  type DisplayItem = { script: VizScriptObject; depth: number; childrenMatchSearch?: boolean; firstMatchingChildId?: string };

  let displayScripts: DisplayItem[] = $derived.by(() => {
    const term = searchTerm.trim().toLowerCase();

    // Sort the base array
    let sorted: VizScriptObject[];

    if (sortOrder === "name-asc") {
      sorted = [...vizscripts].sort((a, b) => a.name.localeCompare(b.name));
    } else if (sortOrder === "name-desc") {
      sorted = [...vizscripts].sort((a, b) => b.name.localeCompare(a.name));
    } else if (sortOrder === "type") {
      const order = (s: VizScriptObject) => s.type === "Scene" ? 0 : s.isGroup ? 2 : 1;
      sorted = [...vizscripts].sort((a, b) => order(a) - order(b));
    } else {
      sorted = [...vizscripts];
    }

    // Build flat display list with group expansion
    const result: DisplayItem[] = [];

    for (const script of sorted) {
      // Always skip raw children — they appear under their group row when expanded
      if (childVizIds.has(script.vizId)) continue;

      const isCollapsed = collapsedGroupIds.includes(script.vizId);

      // Filter the script itself
      const scriptMatches = !term ||
        script.name.toLowerCase().includes(term) ||
        (script.code ?? "").toLowerCase().includes(term);

      if (script.isGroup) {
        // Check if any child matches the search
        const anyChildMatches = term ? script.children.some(childId => {
          const child = vizscripts.find(s => s.vizId === childId);
          return child && (
            child.name.toLowerCase().includes(term) ||
            (child.code ?? "").toLowerCase().includes(term)
          );
        }) : false;
        // Show group row if group itself matches, a child matches, or no search
        if (!term || scriptMatches || anyChildMatches) {
          // Find first matching child so the group's search-icon can open it directly
          const firstMatchingChildId = anyChildMatches ? script.children.find(childId => {
            const child = vizscripts.find(s => s.vizId === childId);
            return child && (
              child.name.toLowerCase().includes(term) ||
              (child.code ?? "").toLowerCase().includes(term)
            );
          }) : undefined;
          result.push({ script, depth: 0, childrenMatchSearch: anyChildMatches, firstMatchingChildId });
        }
        // Emit children only if expanded — never force-expand due to search
        if (!isCollapsed) {
          const childScripts = script.children
            .map(childId => vizscripts.find(s => s.vizId === childId))
            .filter((c): c is VizScriptObject => !!c);

          // Sort children to match the current sort order
          if (sortOrder === "name-asc") {
            childScripts.sort((a, b) => a.name.localeCompare(b.name));
          } else if (sortOrder === "name-desc") {
            childScripts.sort((a, b) => b.name.localeCompare(a.name));
          }

          for (const child of childScripts) {
            const childMatches = !term ||
              child.name.toLowerCase().includes(term) ||
              (child.code ?? "").toLowerCase().includes(term);
            if (childMatches) result.push({ script: child, depth: 1 });
          }
        }
      } else {
        if (scriptMatches) result.push({ script, depth: 0 });
      }
    }

    return result;
  });

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
    if (isMultiSelect) {
      // Multi-selection: send all selected vizIds for bulk set
      // Spread into a plain array — Svelte 5 $state proxies can't be structurally cloned by postMessage
      tsvscode.postMessage({
        type: "setScripts",
        value: { vizIds: [...selectedScriptIds], selectedLayer, hostname, port },
      });
      return;
    }
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

  function handleSetScriptParameter(detail: { scriptId: string; parameterName: string; value: string; hostname: string; port: number; skipRefresh?: boolean }) {
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
      parametersCache,
      sortOrder,
      collapsedGroups: collapsedGroupIds,
    };
    tsvscode.setState(updatedState);
  }

  const handleMessage = (event: any) => {
    const message = event.data;
    if (message.type === "receiveScripts") {
      console.log("Scripts received", message.value);

      // Capture which groups existed before the update
      const previouslyKnownGroupIds = new Set(
        vizscripts.filter(s => s.isGroup).map(s => s.vizId)
      );

      vizscripts = [...message.value];

      // For groups that already exist, preserve their collapsed state.
      // Only auto-collapse groups that are brand-new (not seen before).
      const incomingGroups = (message.value as VizScriptObject[])
        .filter((s: VizScriptObject) => s.isGroup)
        .map((s: VizScriptObject) => s.vizId);

      const currentlyCollapsed = new Set(collapsedGroupIds);

      collapsedGroupIds = incomingGroups.filter(id => {
        if (currentlyCollapsed.has(id)) return true;           // was collapsed — keep collapsed
        if (!previouslyKnownGroupIds.has(id)) return true;    // brand-new group — collapse by default
        return false;                                           // was expanded — keep expanded
      });
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
      // Multi-select mode: toggle this script in the selection
      if (selectedScriptIds.includes(script.vizId)) {
        // Deselect if already selected
        selectedScriptIds = selectedScriptIds.filter(id => id !== script.vizId);
      } else {
        // Build new multi-selection: include the currently single-selected item if applicable
        const base: string[] = selectedScriptIds.length > 0
          ? [...selectedScriptIds]
          : (selectedScriptId && selectedScriptId !== script.vizId ? [selectedScriptId] : []);
        selectedScriptIds = [...base, script.vizId];
      }
      // Keep selectedScriptId as the "anchor" — do NOT clear it
    } else {
      // Single selection - clear multi-selection
      selectedScriptIds = [];
      selectedScriptId = script.vizId;
    }
    
    // Fetch parameters for the selected script (pass script directly to avoid reactive timing issues)
    // Only fetch for single-selection, not during multi-select
    if (scriptParametersComponent && !isShiftClick) {
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
      sortOrder,
      collapsedGroups: collapsedGroupIds,
    };
    tsvscode.setState(updatedState);
  };

  const toggleGroupCollapse = (vizId: string) => {
    if (collapsedGroupIds.includes(vizId)) {
      collapsedGroupIds = collapsedGroupIds.filter(id => id !== vizId);
    } else {
      collapsedGroupIds = [...collapsedGroupIds, vizId];
    }
    const currentState = tsvscode.getState() || {};
    tsvscode.setState({ ...currentState, collapsedGroups: collapsedGroupIds });
  };

  const handleOpenAndSearch = (detail: { vizId: string; searchTerm: string }) => {
    tsvscode.postMessage({ type: "openAndSearch", value: detail });
  };

  const handleSortChange = (event: Event) => {
    const target = event.target as HTMLSelectElement;
    sortOrder = target.value as SortOrder;
    const currentState = tsvscode.getState() || {};
    tsvscode.setState({ ...currentState, sortOrder });
  };

  const setSortOrder = (value: SortOrder) => {
    sortOrder = value;
    sortOpen = false;
    const currentState = tsvscode.getState() || {};
    tsvscode.setState({ ...currentState, sortOrder });
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

    // Restore sort/search/collapse state
    if (currentState.sortOrder) {
      sortOrder = currentState.sortOrder as SortOrder;
    }
    if (currentState.collapsedGroups) {
      collapsedGroupIds = [...(currentState.collapsedGroups as string[])];
    }

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

        <!-- Search and Sort toolbar -->
        <div class="flex items-center gap-1 px-2 pt-1 pb-1 border-b border-vscode-editorGroup-border">
          <!-- Search input -->
          <div class="relative flex items-center flex-1 min-w-0">
            <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16" fill="currentColor" class="absolute left-2 text-vscode-descriptionForeground pointer-events-none shrink-0">
              <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.868-3.834zm-5.242 1.406a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"/>
            </svg>
            <input
              type="text"
              placeholder="Search scripts..."
              bind:value={searchTerm}
              class="w-full bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded text-sm focus:outline-none focus:border-vscode-focusBorder placeholder:text-vscode-descriptionForeground"
              style="padding: 4px 28px 4px 24px;"
            />
            {#if searchTerm}
              <button
                onclick={() => { searchTerm = ""; }}
                class="absolute right-1.5 flex items-center justify-center w-[18px] h-[18px] text-vscode-descriptionForeground hover:text-vscode-foreground cursor-pointer bg-transparent border-0 p-0 outline-none shrink-0"
                style="outline: none !important;"
                title="Clear search"
              >
                <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 16 16" fill="currentColor">
                  <path d="M2.146 2.854a.5.5 0 1 1 .708-.708L8 7.293l5.146-5.147a.5.5 0 0 1 .708.708L8.707 8l5.147 5.146a.5.5 0 0 1-.708.708L8 8.707l-5.146 5.147a.5.5 0 0 1-.708-.708L7.293 8z"/>
                </svg>
              </button>
            {/if}
          </div>
          <!-- Sort icon button with custom dropdown -->
          <div class="relative shrink-0">
            <button
              onclick={() => { sortOpen = !sortOpen; }}
              class="flex items-center justify-center w-[26px] h-[26px] rounded border-0 bg-transparent cursor-pointer p-0 outline-none
                {sortOrder !== 'default' ? 'text-vscode-textLink-foreground' : 'text-vscode-descriptionForeground hover:text-vscode-foreground'}"
              style="outline: none !important;"
              title="Sort order"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                <path d="M1 2.5A1.5 1.5 0 0 1 2.5 1h11A1.5 1.5 0 0 1 15 2.5v1.5a.5.5 0 0 1-.146.354L10 9.207V13.5a.5.5 0 0 1-.276.447l-3 1.5A.5.5 0 0 1 6 15V9.207L1.146 4.354A.5.5 0 0 1 1 4zm1.5-.5a.5.5 0 0 0-.5.5V4l5 5v5.5l2-1V9L14 4V2.5a.5.5 0 0 0-.5-.5z"/>
              </svg>
            </button>

            {#if sortOpen}
              <!-- Backdrop to close on outside click -->
              <div class="fixed inset-0 z-40" onclick={() => { sortOpen = false; }}></div>
              <!-- Dropdown menu -->
              <div class="absolute right-0 top-full mt-1 z-50 min-w-[180px] rounded border border-vscode-widget-border bg-vscode-menu-background shadow-lg overflow-hidden">
                {#each [
                  { value: 'default', label: 'Default (tree order)' },
                  { value: 'name-asc', label: 'Name A → Z' },
                  { value: 'name-desc', label: 'Name Z → A' },
                  { value: 'type', label: 'By type' },
                ] as opt}
                  <button
                    onclick={() => setSortOrder(opt.value as SortOrder)}
                    class="w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 border-0 cursor-pointer outline-none
                      {sortOrder === opt.value
                        ? 'bg-vscode-list-activeSelectionBackground text-vscode-list-activeSelectionForeground'
                        : 'bg-transparent text-vscode-menu-foreground hover:bg-vscode-menu-selectionBackground hover:text-vscode-menu-selectionForeground'}"
                  >
                    {#if sortOrder === opt.value}
                      <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 16 16" fill="currentColor" class="shrink-0">
                        <path d="M13.854 3.646a.5.5 0 0 1 0 .708l-7 7a.5.5 0 0 1-.708 0l-3.5-3.5a.5.5 0 1 1 .708-.708L6.5 10.293l6.646-6.647a.5.5 0 0 1 .708 0z"/>
                      </svg>
                    {:else}
                      <span class="w-[10px] shrink-0"></span>
                    {/if}
                    {opt.label}
                  </button>
                {/each}
              </div>
            {/if}
          </div>
        </div>

        <div class="flex-1 overflow-auto" onclick={handleContainerClick}>
          {#if isMultiSelect}
            <div class="px-2 py-1 bg-vscode-editorGroupHeader-tabsBackground text-vscode-textLink-foreground text-xs">
              {multiSelectCount} items selected (Shift+Click to select more, click empty space to deselect)
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
          {:else if displayScripts.length === 0}
            <div class="px-4 py-3 text-vscode-descriptionForeground text-xs">No scripts match "{searchTerm}"</div>
          {:else}
            {#each displayScripts as item (item.script.vizId)}
              <ScriptItem 
                script={item.script}
                depth={item.depth}
                {selectedScriptId}
                {selectedScriptIds}
                {sidebarSettings}
                {searchTerm}
                isCollapsible={item.script.isGroup === true}
                isCollapsed={collapsedGroupIds.includes(item.script.vizId)}
                childrenMatchSearch={item.childrenMatchSearch}
                firstMatchingChildId={item.firstMatchingChildId}
                onDoubleClick={handleScriptDoubleClick}
                onScriptSelected={handleScriptSelection}
                onToggleCollapse={toggleGroupCollapse}
                onOpenAndSearch={handleOpenAndSearch}
              />
            {/each}
          {/if}
        </div>
        
        <!-- Script Info Section - Always at bottom -->
        <div class="border-t border-vscode-editorGroup-border">
          <div class="p-2 text-white">
            {#if isMultiSelect}
              <!-- Multi-selection info panel -->
              <div class="flex justify-between items-start gap-2 mb-2">
                <div class="flex-1 overflow-hidden">
                  <div class="flex gap-2 items-center">
                    <div class="overflow-hidden text-ellipsis">{multiSelectCount} containers selected</div>
                  </div>
                  <div class="text-xs text-vscode-descriptionForeground">The current editor content will be pushed to all selected containers</div>
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
                onclick={handleScriptSet}
                class="w-full bg-vscode-button-background text-vscode-button-foreground border-0 px-2 py-1 rounded text-md cursor-pointer hover:bg-vscode-button-hoverBackground transition-colors"
              >
                Set {multiSelectCount} scripts in Viz
              </button>
            {:else if selectedScript}
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
