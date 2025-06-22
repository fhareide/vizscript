<script lang="ts">
  import { createEventDispatcher } from 'svelte';
  import type { VizScriptObject, ScriptParameter, ScriptParametersData } from "../../src/shared/types";

  const dispatch = createEventDispatcher();

  // Props
  export let selectedScript: VizScriptObject | undefined;
  export let hostname: string;
  export let port: number;
  export let parametersData: ScriptParametersData | null = null;
  export let parametersCache: { [scriptId: string]: ScriptParametersData } = {};
  export let showParameters = true;


  // Functions
  export function fetchParametersForSelectedScript(script?: VizScriptObject, forceRefresh = false) {
    const targetScript = script || selectedScript;
    
    if (!targetScript?.vizId) {
      console.log("No script or vizId provided, clearing parameters");
      parametersData = null;
      return;
    }

    // Check cache first (unless forcing refresh)
    if (!forceRefresh && parametersCache[targetScript.vizId]) {
      console.log("Loading parameters from cache for script:", targetScript.vizId);
      parametersData = parametersCache[targetScript.vizId];
      return;
    }

    if (!hostname || !port) {
      console.log("No hostname or port configured, can't fetch parameters");
      parametersData = null;
      return;
    }

    console.log("Fetching parameters for script:", targetScript.vizId, "from", hostname, ":", port);
    parametersData = { scriptId: targetScript.vizId, parameters: [], currentValues: {} }; // Set loading state
    
    dispatch('getParameters', {
      scriptId: targetScript.vizId,
      hostname: hostname,
      port: port
    });
  }

  function handleParameterChange(parameter: ScriptParameter, newValue: string) {
    if (!selectedScript?.vizId) return;

    let processedValue = newValue;

    // Validate integer inputs
    if (parameter.type === "INT") {
      const numValue = parseInt(newValue);
      if (isNaN(numValue)) return;
      
      // Check bounds
      if (parameter.min !== undefined && numValue < parameter.min) {
        processedValue = parameter.min.toString();
      }
      if (parameter.max !== undefined && numValue > parameter.max) {
        processedValue = parameter.max.toString();
      }
    }

    console.log(`Setting parameter ${parameter.name} to ${processedValue}`);
    dispatch('setParameter', {
      scriptId: selectedScript.vizId,
      parameterName: parameter.name,
      value: processedValue,
      hostname: hostname,
      port: port
    });
  }

  function handleParameterInvoke(parameter: ScriptParameter) {
    if (!selectedScript?.vizId) return;

    console.log(`Invoking parameter ${parameter.name}`);
    dispatch('invokeParameter', {
      scriptId: selectedScript.vizId,
      parameterName: parameter.name,
      hostname: hostname,
      port: port
    });
  }

  function handleNumberInput(event: Event, parameter: ScriptParameter) {
    const target = event.target as HTMLInputElement;
    handleParameterChange(parameter, target.value);
  }

  function handleRangeInput(event: Event, parameter: ScriptParameter) {
    const target = event.target as HTMLInputElement;
    handleParameterChange(parameter, target.value);
  }

  function handleRefreshParameters() {
    fetchParametersForSelectedScript(undefined, true); // Force refresh, bypass cache
  }

  function handleBoolParameterChange(parameter: ScriptParameter, event: Event) {
    const target = event.target as HTMLInputElement;
    handleParameterChange(parameter, target.checked ? "1" : "0");
  }

  function handleColorParameterChange(parameter: ScriptParameter, event: Event) {
    const target = event.target as HTMLInputElement;
    handleParameterChange(parameter, target.value);
  }

  // Handle received parameters data
  export function handleParametersReceived(receivedData: ScriptParametersData) {
    console.log("Raw parameters message received:", receivedData);
    parametersData = receivedData;
    
    // Cache the parameters if we received valid data
    if (parametersData && parametersData.scriptId) {
      parametersCache[parametersData.scriptId] = parametersData;
      console.log("Cached parameters for script:", parametersData.scriptId);
    }
    
    console.log("Parameters data set to:", parametersData);
  }
</script>

<!-- Script Parameters Section -->
<div class="{showParameters ? 'flex-1' : 'h-auto min-h-40'} flex flex-col border-t border-vscode-editorGroup-border">
  <div 
    class="flex items-center justify-between p-2 bg-vscode-sideBarSectionHeader-background hover:bg-vscode-list-hoverBackground cursor-pointer select-none {showParameters ? 'border-b border-vscode-editorGroup-border' : ''}"
    on:click={() => showParameters = !showParameters}
    on:keydown={(e) => (e.key === 'Enter' || e.key === ' ') && (showParameters = !showParameters)}
    tabindex="0"
    role="button"
    title="Click to {showParameters ? 'collapse' : 'expand'} parameters panel"
  >
    <h3 class="text-sm font-medium text-vscode-sideBarSectionHeader-foreground">Script Parameters</h3>
    <div class="text-xs transition-transform duration-150 {showParameters ? '' : 'rotate-180'}">
      ▼
    </div>
  </div>
  
  {#if showParameters}
    <div class="flex-1 min-h-0 overflow-hidden bg-vscode-sideBar-background">
      {#if selectedScript}
        <div class="p-2">
          <button 
            on:click={handleRefreshParameters}
            class="w-full mb-2 px-2 py-1 text-xs bg-vscode-button-background text-vscode-button-foreground hover:bg-vscode-button-hoverBackground border-none rounded cursor-pointer"
          >
            Refresh Parameters
          </button>
        </div>
        
        {#if parametersData && parametersData.parameters.length > 0}
          <div class="overflow-y-auto px-2 pb-2">
            <div class="space-y-1">
              {#each parametersData.parameters as parameter (parameter.name)}
                <div class="parameter-item py-1">
                  <div class="parameter-control">
                    {#if parameter.type === "INFO"}
                      <details class="mb-2">
                        <summary class="cursor-pointer text-sm text-vscode-foreground hover:text-vscode-textLink-foreground">
                          ▶ {parameter.displayName || parameter.name}
                        </summary>
                        <div class="mt-1 ml-4 text-xs text-vscode-descriptionForeground bg-vscode-textBlockQuote-background p-2 rounded">
                          {parameter.value || parameter.description || ''}
                        </div>
                      </details>
                    {:else if parameter.type === "PUSHBUTTON"}
                      <button
                        on:click={() => handleParameterInvoke(parameter)}
                        class="w-full px-3 py-2 bg-gray-800 text-white hover:bg-gray-700 border-none rounded cursor-pointer transition-colors text-sm font-medium"
                      >
                        {parameter.displayName}
                      </button>
                    {:else if parameter.type === "BOOL"}
                      <div class="flex items-center gap-2">
                        <input
                          type="checkbox"
                          id="param-{parameter.name}"
                          checked={parameter.value === "1" || parameter.value === 1 || parameter.value === true}
                          on:change={(e) => handleBoolParameterChange(parameter, e)}
                          class="rounded"
                        />
                        <label for="param-{parameter.name}" class="text-sm text-vscode-foreground cursor-pointer">
                          {parameter.displayName}
                        </label>
                      </div>
                    {:else if parameter.type === "INT"}
                      <div class="flex items-center justify-between">
                        <span class="text-sm text-vscode-foreground">{parameter.displayName}</span>
                        <input
                          type="number"
                          value={parameter.value}
                          min={parameter.min}
                          max={parameter.max}
                          on:change={(e) => handleNumberInput(e, parameter)}
                          class="w-20 px-2 py-1 text-sm bg-vscode-input-background text-vscode-input-foreground border border-vscode-input-border rounded focus:outline-none focus:border-vscode-focusBorder text-right"
                        />
                      </div>
                    {:else if parameter.type === "COLOR"}
                      <div class="flex items-center justify-between">
                        <span class="text-sm text-vscode-foreground">{parameter.displayName}</span>
                        <input
                          type="color"
                          value={parameter.value || "#000000"}
                          on:change={(e) => handleColorParameterChange(parameter, e)}
                          class="w-8 h-8 rounded border border-vscode-input-border cursor-pointer"
                        />
                      </div>
                    {:else}
                      <div class="text-xs text-vscode-descriptionForeground">
                        Parameter type "{parameter.type}" not yet supported
                      </div>
                    {/if}
                  </div>
                </div>
              {/each}
            </div>
          </div>
        {:else if parametersData}
          <div class="p-2 text-center text-vscode-descriptionForeground text-xs">
            No parameters found for this script
          </div>
        {:else}
          <div class="p-2 text-center text-vscode-descriptionForeground text-xs">
            Loading parameters...
          </div>
        {/if}
      {:else}
        <div class="p-2 text-center text-vscode-descriptionForeground text-xs">
          Select a script to view its parameters
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  .parameter-item {
    transition: all 0.2s ease;
  }
  
  .parameter-item:hover {
    background-color: var(--vscode-list-hoverBackground);
  }
  
  input[type="range"] {
    -webkit-appearance: none;
    appearance: none;
    height: 4px;
    background: var(--vscode-progressBar-background);
    border-radius: 2px;
  }
  
  input[type="range"]::-webkit-slider-thumb {
    -webkit-appearance: none;
    appearance: none;
    height: 12px;
    width: 12px;
    border-radius: 50%;
    background: var(--vscode-button-background);
    cursor: pointer;
  }
  
  input[type="range"]::-moz-range-thumb {
    height: 12px;
    width: 12px;
    border-radius: 50%;
    background: var(--vscode-button-background);
    cursor: pointer;
    border: none;
  }

  /* Custom styling for INFO parameter sections */
  details > summary {
    list-style: none;
  }
  
  details > summary::-webkit-details-marker {
    display: none;
  }
  
  details[open] > summary::before {
    content: "▼ ";
  }
  
  details:not([open]) > summary::before {
    content: "▶ ";
  }

  /* Header transitions */
  .rotate-180 {
    transform: rotate(180deg);
  }

  /* Smooth collapse/expand animation */
  .transition-transform {
    transition-property: transform;
    transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
  }

  .duration-150 {
    transition-duration: 150ms;
  }

  .select-none {
    -webkit-user-select: none;
    -moz-user-select: none;
    -ms-user-select: none;
    user-select: none;
  }

  /* Ensure minimum height for collapsed header */
  .min-h-40 {
    min-height: 40px;
  }
</style> 