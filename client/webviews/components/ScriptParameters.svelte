<script lang="ts">
  import type { VizScriptObject, ScriptParameter, ScriptParametersData } from "../../src/shared/types";

  interface Props {
    selectedScript: VizScriptObject | undefined;
    hostname: string;
    port: number;
    parametersData?: ScriptParametersData | null;
    parametersCache?: { [scriptId: string]: ScriptParametersData };
    showParameters?: boolean;
    onGetParameters?: (detail: { scriptId: string; hostname: string; port: number }) => void;
    onSetParameter?: (detail: { scriptId: string; parameterName: string; value: string; hostname: string; port: number }) => void;
    onInvokeParameter?: (detail: { scriptId: string; parameterName: string; hostname: string; port: number }) => void;
  }

  let { 
    selectedScript,
    hostname,
    port,
    parametersData = $bindable(null),
    parametersCache = $bindable({}),
    showParameters = $bindable(true),
    onGetParameters,
    onSetParameter,
    onInvokeParameter
  }: Props = $props();

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
    
    onGetParameters?.({
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
    onSetParameter?.({
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
    onInvokeParameter?.({
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

  function handleStringParameterChange(parameter: ScriptParameter, event: Event) {
    const target = event.target as HTMLInputElement;
    handleParameterChange(parameter, target.value);
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

  function toggleShowParameters() {
    showParameters = !showParameters;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      toggleShowParameters();
    }
  }
</script>

<!-- Script Parameters Section -->
<div class="{showParameters ? 'flex-1' : 'h-auto min-h-40'} flex flex-col border-t border-vscode-editorGroup-border">
  <div 
    class="flex items-center justify-between p-2 bg-vscode-sideBarSectionHeader-background hover:bg-vscode-list-hoverBackground cursor-pointer select-none {showParameters ? 'border-b border-vscode-editorGroup-border' : ''}"
    onclick={toggleShowParameters}
    onkeydown={handleKeydown}
    tabindex="0"
    role="button"
    title="Click to {showParameters ? 'collapse' : 'expand'} parameters panel"
  >
    <h3 class="text-sm font-medium text-vscode-sideBarSectionHeader-foreground">Script Tools</h3>
    <div class="text-xs transition-transform duration-150 {showParameters ? '' : 'rotate-180'}">
      ▼
    </div>
  </div>
  
  {#if showParameters}
    <div class="flex-1 min-h-0 bg-vscode-sideBar-background flex items-center justify-center p-4">
      <span class="text-xs text-vscode-descriptionForeground text-center">Script parameter support is in the works</span>
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
