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
    onSetParameter?: (detail: { scriptId: string; parameterName: string; value: string; hostname: string; port: number; skipRefresh?: boolean }) => void;
    onInvokeParameter?: (detail: { scriptId: string; parameterName: string; hostname: string; port: number }) => void;
    onBrowseFile?: (detail: { parameterName: string; defaultPath?: string; filter?: string }) => void;
    onBrowseDir?: (detail: { parameterName: string; currentPath?: string }) => void;
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
    onInvokeParameter,
    onBrowseFile,
    onBrowseDir,
  }: Props = $props();

  let isLoadingParameters = $state(false);

  let dragParam: ScriptParameter | null = $state(null);
  let dragStartX = 0;
  let dragStartValue = 0;
  let dragStep = 1;
  let dragIsFloat = false;

  export function fetchParametersForSelectedScript(script?: VizScriptObject, forceRefresh = false) {
    const targetScript = script || selectedScript;
    
    if (!targetScript?.vizId) {
      parametersData = null;
      isLoadingParameters = false;
      return;
    }

    if (!hostname || !port) {
      parametersData = null;
      isLoadingParameters = false;
      return;
    }

    isLoadingParameters = true;
    parametersData = { scriptId: targetScript.vizId, parameters: [], currentValues: {} };
    
    onGetParameters?.({
      scriptId: targetScript.vizId,
      hostname: hostname,
      port: port
    });
  }

  function handleParameterChange(parameter: ScriptParameter, newValue: string, skipRefresh = false) {
    if (!selectedScript?.vizId) return;

    let processedValue = newValue;

    switch (parameter.type) {
      case "INT":
      case "SLIDERINT": {
        const numValue = parseInt(newValue);
        if (isNaN(numValue)) return;
        const min = parameter.min !== undefined && parameter.max !== undefined ? Math.min(parameter.min, parameter.max) : parameter.min;
        const max = parameter.min !== undefined && parameter.max !== undefined ? Math.max(parameter.min, parameter.max) : parameter.max;
        if (min !== undefined && numValue < min) processedValue = min.toString();
        if (max !== undefined && numValue > max) processedValue = max.toString();
        break;
      }
      case "FLOAT":
      case "DOUBLE":
      case "SLIDERDOUBLE": {
        const numValue = parseFloat(newValue);
        if (isNaN(numValue)) return;
        const min = parameter.min !== undefined && parameter.max !== undefined ? Math.min(parameter.min, parameter.max) : parameter.min;
        const max = parameter.min !== undefined && parameter.max !== undefined ? Math.max(parameter.min, parameter.max) : parameter.max;
        if (min !== undefined && numValue < min) processedValue = min.toString();
        if (max !== undefined && numValue > max) processedValue = max.toString();
        break;
      }
      case "BOOL": {
        processedValue = (newValue === "1" || newValue === "true") ? "1" : "0";
        break;
      }
    }

    parameter.value = processedValue;

    onSetParameter?.({
      scriptId: selectedScript.vizId,
      parameterName: parameter.name,
      value: processedValue,
      hostname: hostname,
      port: port,
      skipRefresh
    });
  }

  function handleParameterInvoke(parameter: ScriptParameter) {
    if (!selectedScript?.vizId) return;
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

  function handleRefreshParameters() {
    fetchParametersForSelectedScript(undefined, true);
  }

  function handleBoolParameterChange(parameter: ScriptParameter, event: Event) {
    const target = event.target as HTMLInputElement;
    handleParameterChange(parameter, target.checked ? "1" : "0");
  }

  function handleStringParameterChange(parameter: ScriptParameter, event: Event) {
    const target = event.target as HTMLInputElement;
    handleParameterChange(parameter, target.value);
  }

  function handleTextParameterChange(parameter: ScriptParameter, event: Event) {
    const target = event.target as HTMLTextAreaElement;
    handleParameterChange(parameter, target.value);
  }

  function handleColorParameterChange(parameter: ScriptParameter, event: Event) {
    const target = event.target as HTMLInputElement;
    handleParameterChange(parameter, target.value);
  }

  function argbToRgba(argb: number): { r: number; g: number; b: number; a: number } {
    const u = argb >>> 0;
    return {
      r: (u >>> 24) & 0xff,
      g: (u >>> 16) & 0xff,
      b: (u >>> 8)  & 0xff,
      a:  u         & 0xff,
    };
  }

  function rgbaToArgb(r: number, g: number, b: number, a: number): number {
    return (((r & 0xff) << 24) | ((g & 0xff) << 16) | ((b & 0xff) << 8) | (a & 0xff)) >>> 0;
  }

  function getColorRgba(parameter: ScriptParameter): { r: number; g: number; b: number; a: number } {
    const raw = getParameterDisplayValue(parameter);
    const n = parseInt(raw);
    if (!isNaN(n)) return argbToRgba(n);
    return { r: 0, g: 0, b: 0, a: 255 };
  }

  function rgbaToHex(r: number, g: number, b: number, a = 255): string {
    return "#" + [r, g, b, a].map(v => v.toString(16).padStart(2, "0")).join("");
  }

  function handleColorSwatchChange(parameter: ScriptParameter, event: Event, commit: boolean) {
    const hex = (event.target as HTMLInputElement).value;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    const a = hex.length >= 9 ? parseInt(hex.slice(7, 9), 16) : getColorRgba(parameter).a;
    const newVal = rgbaToArgb(r, g, b, a).toString();
    parameter.value = newVal;
    if (commit) {
      handleParameterChange(parameter, newVal, false);
    } else {
      onSetParameter?.({
        scriptId: selectedScript!.vizId,
        parameterName: parameter.name,
        value: newVal,
        hostname,
        port,
        skipRefresh: true,
      });
    }
  }

  function handleColorChannelChange(parameter: ScriptParameter, channel: "r"|"g"|"b"|"a", value: number) {
    const { r, g, b, a } = getColorRgba(parameter);
    const clamped = Math.max(0, Math.min(255, Math.round(value)));
    const updated = { r, g, b, a, [channel]: clamped };
    handleParameterChange(parameter, rgbaToArgb(updated.r, updated.g, updated.b, updated.a).toString());
  }

  function handleSelectParameterChange(parameter: ScriptParameter, event: Event) {
    const target = event.target as HTMLSelectElement;
    handleParameterChange(parameter, target.value);
  }

  function handleRadioParameterChange(parameter: ScriptParameter, index: number) {
    handleParameterChange(parameter, index.toString());
  }

  function getParameterDisplayValue(parameter: ScriptParameter): string {
    if (parameter.value !== undefined && parameter.value !== null) return String(parameter.value);
    if (parameter.defaultValue !== undefined && parameter.defaultValue !== null) return String(parameter.defaultValue);
    return "";
  }

  function getParameterBoolValue(parameter: ScriptParameter): boolean {
    const val = parameter.value ?? parameter.defaultValue;
    return val === true || val === 1 || val === "1" || val === "true";
  }

  function getParameterIntValue(parameter: ScriptParameter): number {
    const val = parameter.value ?? parameter.defaultValue ?? 0;
    return typeof val === "number" ? val : parseInt(String(val)) || 0;
  }

  function isFloatType(type: string): boolean {
    return type === "FLOAT" || type === "DOUBLE" || type === "SLIDERDOUBLE";
  }

  function isPlainNumericType(type: string): boolean {
    return type === "INT" || type === "FLOAT" || type === "DOUBLE";
  }

  function isSliderType(type: string): boolean {
    return type === "SLIDERINT" || type === "SLIDERDOUBLE";
  }

  const DRAG_THRESHOLD = 3;
  let dragPending = false;
  let dragPendingParam: ScriptParameter | null = null;
  let dragPendingEvent: MouseEvent | null = null;

  function startDrag(event: MouseEvent, parameter: ScriptParameter) {
    const target = event.target as HTMLInputElement;
    if (document.activeElement === target) return;

    event.preventDefault();
    dragPending = true;
    dragPendingParam = parameter;
    dragPendingEvent = event;

    document.addEventListener("mousemove", onDragThreshold);
    document.addEventListener("mouseup", onDragCancel);
  }

  function onDragThreshold(event: MouseEvent) {
    if (!dragPending || !dragPendingEvent || !dragPendingParam) return;
    const dx = Math.abs(event.clientX - dragPendingEvent.clientX);
    if (dx < DRAG_THRESHOLD) return;

    dragPending = false;
    document.removeEventListener("mousemove", onDragThreshold);
    document.removeEventListener("mouseup", onDragCancel);

    const parameter = dragPendingParam;
    const isFloat = isFloatType(parameter.type);
    const currentVal = isFloat
      ? parseFloat(getParameterDisplayValue(parameter)) || 0
      : parseInt(getParameterDisplayValue(parameter)) || 0;

    dragParam = parameter;
    dragStartX = dragPendingEvent.clientX;
    dragStartValue = currentVal;
    dragIsFloat = isFloat;
    dragLastStep = isFloat ? 1 : 1;
    dragLastVal = currentVal;
    dragLastX = dragPendingEvent.clientX;

    if (parameter.min !== undefined && parameter.max !== undefined) {
      const range = parameter.max - parameter.min;
      dragStep = range / 300;
      if (!isFloat) dragStep = Math.max(1, Math.round(dragStep));
    } else {
      dragStep = isFloat ? 0.1 : 1;
    }

    document.addEventListener("mousemove", onDragMove);
    document.addEventListener("mouseup", onDragEnd);
    document.body.style.cursor = "ew-resize";
    document.body.style.userSelect = "none";
    onDragMove(event);
  }

  function onDragCancel() {
    dragPending = false;
    document.removeEventListener("mousemove", onDragThreshold);
    document.removeEventListener("mouseup", onDragCancel);

    if (dragPendingParam) {
      const input = document.getElementById(`param-${dragPendingParam.name}`) as HTMLInputElement;
      if (input) { input.focus(); input.select(); }
    }
    dragPendingParam = null;
    dragPendingEvent = null;
  }

  let dragLastStep = 1;
  let dragLastVal = 0;
  let dragLastX = 0;

  function onDragMove(event: MouseEvent) {
    if (!dragParam) return;
    const dx = event.clientX - dragStartX;

    let step = dragStep;
    if (dragIsFloat) {
      if (event.ctrlKey && event.shiftKey) step = 0.01;
      else if (event.ctrlKey) step = 0.1;
      else step = 1;
    }

    // When modifier changes mid-drag, re-anchor so value doesn't jump
    if (step !== dragLastStep) {
      dragStartX = dragLastX;
      dragStartValue = dragLastVal;
      dragLastStep = step;
    }

    dragLastX = event.clientX;
    const newDx = event.clientX - dragStartX;
    let newVal = dragStartValue + newDx * step;
    if (dragParam.min !== undefined && newVal < dragParam.min) newVal = dragParam.min;
    if (dragParam.max !== undefined && newVal > dragParam.max) newVal = dragParam.max;
    dragLastVal = newVal;
    const decimals = step === 0.01 ? 4 : step === 0.1 ? 3 : 2;
    const formatted = dragIsFloat ? parseFloat(newVal.toFixed(decimals)).toString() : Math.round(newVal).toString();
    handleParameterChange(dragParam, formatted, true);
  }

  function onDragEnd() {
    const endedParam = dragParam;
    dragParam = null;
    document.removeEventListener("mousemove", onDragMove);
    document.removeEventListener("mouseup", onDragEnd);
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    if (endedParam && selectedScript?.vizId) {
      handleParameterChange(endedParam, getParameterDisplayValue(endedParam), false);
    }
  }

  export function handleParametersReceived(receivedData: ScriptParametersData) {
    isLoadingParameters = false;
    parametersData = receivedData;
    if (parametersData && parametersData.scriptId) {
      parametersCache[parametersData.scriptId] = parametersData;
    }
  }

  function toggleShowParameters() {
    showParameters = !showParameters;
  }

  function handleKeydown(e: KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') toggleShowParameters();
  }

  let hasParameters = $derived(
    parametersData && parametersData.parameters && parametersData.parameters.length > 0
  );
</script>

<div class="{showParameters ? 'flex-1 min-h-0 overflow-hidden' : 'h-auto min-h-40'} flex flex-col border-t border-vscode-editorGroup-border">
  <div 
    class="flex items-center justify-between p-2 bg-vscode-sideBarSectionHeader-background hover:bg-vscode-list-hoverBackground cursor-pointer select-none {showParameters ? 'border-b border-vscode-editorGroup-border' : ''}"
    onclick={toggleShowParameters}
    onkeydown={handleKeydown}
    tabindex="0"
    role="button"
    title="Click to {showParameters ? 'collapse' : 'expand'} parameters panel"
  >
    <h3 class="text-sm font-medium text-vscode-sideBarSectionHeader-foreground">Script Parameters</h3>
    <div class="flex items-center gap-1">
      {#if showParameters && selectedScript?.vizId}
        <!-- svelte-ignore a11y_click_events_have_key_events -->
        <!-- svelte-ignore a11y_no_static_element_interactions -->
        <div
          class="p-0.5 rounded hover:bg-vscode-toolbar-hoverBackground cursor-pointer text-vscode-descriptionForeground hover:text-vscode-foreground"
          onclick={(e) => { e.stopPropagation(); handleRefreshParameters(); }}
          title="Refresh parameters"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
            <path d="M13.451 5.609l-.579-.939-1.068.812-.076.094c.335.57.528 1.236.528 1.949 0 2.044-1.588 3.713-3.588 3.84l.87-.726-.636-.762-2.17 1.81 2.17 1.81.637-.762-.78-.65c2.791-.104 5.025-2.417 5.025-5.26 0-.776-.168-1.512-.47-2.174zM7.467 3.56l.78.65C5.456 4.314 3.222 6.627 3.222 9.47c0 .776.168 1.512.47 2.174l.58.938 1.067-.812.076-.094A3.86 3.86 0 0 1 4.887 9.727c0-2.044 1.588-3.713 3.588-3.84l-.87.726.636.762 2.17-1.81-2.17-1.81-.637.762z"/>
          </svg>
        </div>
      {/if}
      <div class="text-xs transition-transform duration-150 {showParameters ? '' : 'rotate-180'}">▼</div>
    </div>
  </div>
  
  {#if showParameters}
    <div class="flex-1 min-h-0 overflow-auto bg-vscode-sideBar-background">
      {#if !selectedScript?.vizId}
        <div class="flex items-center justify-center p-4 h-full">
          <span class="text-xs text-vscode-descriptionForeground text-center">Select a script to view parameters</span>
        </div>
      {:else if isLoadingParameters}
        <div class="flex items-center justify-center p-4 h-full">
          <span class="text-xs text-vscode-descriptionForeground text-center">Loading parameters...</span>
        </div>
      {:else if !hasParameters}
        <div class="flex items-center justify-center p-4 h-full">
          <span class="text-xs text-vscode-descriptionForeground text-center">No parameters registered for this script</span>
        </div>
      {:else}
        <div class="param-list">
          {#each parametersData!.parameters as parameter (parameter.name)}

            {#if parameter.type === "INFO"}
              {#if parameter.displayName}
                <div class="param-section-header">
                  <span>{parameter.displayName}</span>
                </div>
              {/if}
              {#if getParameterDisplayValue(parameter)}
                <div class="param-info-text">
                  <pre>{getParameterDisplayValue(parameter).trim()}</pre>
                </div>
              {/if}

            {:else if parameter.type === "LABEL"}
              <div class="param-row">
                <span class="param-label-only">{parameter.displayName}</span>
              </div>

            {:else if parameter.type === "PUSHBUTTON"}
              <div class="param-row">
                <button class="param-button" onclick={() => handleParameterInvoke(parameter)}>
                  {parameter.displayName}
                </button>
              </div>

            {:else if parameter.type === "BOOL"}
              <div class="param-row param-row-inline">
                <span class="param-label">{parameter.displayName}</span>
                <input
                  id="param-{parameter.name}"
                  type="checkbox"
                  checked={getParameterBoolValue(parameter)}
                  onchange={(e) => handleBoolParameterChange(parameter, e)}
                  class="param-checkbox"
                />
              </div>

            {:else if isSliderType(parameter.type)}
              {@const sliderMin = Math.min(parameter.min ?? 0, parameter.max ?? 100)}
              {@const sliderMax = Math.max(parameter.min ?? 0, parameter.max ?? 100)}
              <div class="param-row">
                <span class="param-label">{parameter.displayName}</span>
                <div class="param-slider-wrap">
                  <input
                    type="range"
                    bind:value={parameter.value}
                    min={sliderMin}
                    max={sliderMax}
                    step={isFloatType(parameter.type) ? "0.01" : "1"}
                    oninput={(e) => handleParameterChange(parameter, (e.target as HTMLInputElement).value, true)}
                    onchange={(e) => handleParameterChange(parameter, (e.target as HTMLInputElement).value, false)}
                    class="param-range"
                  />
                  <input
                    id="param-{parameter.name}"
                    type="number"
                    value={getParameterDisplayValue(parameter)}
                    min={sliderMin}
                    max={sliderMax}
                    step={isFloatType(parameter.type) ? "0.01" : "1"}
                    onchange={(e) => handleNumberInput(e, parameter)}
                    onmousedown={(e) => startDrag(e, parameter)}
                    class="param-slider-number drag-input"
                  />
                </div>
              </div>

            {:else if isPlainNumericType(parameter.type)}
              <div class="param-row param-row-inline">
                <span class="param-label">{parameter.displayName}</span>
                <input
                  id="param-{parameter.name}"
                  type="number"
                  value={getParameterDisplayValue(parameter)}
                  min={parameter.min}
                  max={parameter.max}
                  step={isFloatType(parameter.type) ? "0.01" : "1"}
                  onchange={(e) => handleNumberInput(e, parameter)}
                  onmousedown={(e) => startDrag(e, parameter)}
                  class="param-input-number drag-input"
                />
              </div>

            {:else if parameter.type === "STRING"}
              <div class="param-row">
                <span class="param-label">{parameter.displayName}</span>
                <input
                  id="param-{parameter.name}"
                  type="text"
                  value={getParameterDisplayValue(parameter)}
                  maxlength={parameter.maxLength}
                  onchange={(e) => handleStringParameterChange(parameter, e)}
                  class="param-input-text"
                />
              </div>

            {:else if parameter.type === "TEXT"}
              <div class="param-row">
                <span class="param-label">{parameter.displayName}</span>
                <textarea
                  id="param-{parameter.name}"
                  value={getParameterDisplayValue(parameter)}
                  onchange={(e) => handleTextParameterChange(parameter, e)}
                  rows="3"
                  class="param-textarea"
                ></textarea>
              </div>

            {:else if parameter.type === "COLOR"}
              {@const rgba = getColorRgba(parameter)}
              <div class="param-row param-row-inline">
                <span class="param-label">{parameter.displayName}</span>
                <input
                  type="color"
                  {...{"alpha": true}}
                  value={rgbaToHex(rgba.r, rgba.g, rgba.b, rgba.a)}
                  oninput={(e) => handleColorSwatchChange(parameter, e, false)}
                  onchange={(e) => handleColorSwatchChange(parameter, e, true)}
                  class="param-color-swatch"
                  title="Pick color"
                />
              </div>

            {:else if parameter.type === "DROPDOWN"}
              <div class="param-row">
                <span class="param-label">{parameter.displayName}</span>
                <select
                  id="param-{parameter.name}"
                  value={getParameterDisplayValue(parameter)}
                  onchange={(e) => handleSelectParameterChange(parameter, e)}
                  class="param-select"
                >
                  {#if parameter.entries}
                    {#each parameter.entries as entry, i}
                      <option value={i}>{entry}</option>
                    {/each}
                  {/if}
                </select>
              </div>

            {:else if parameter.type === "LIST" || parameter.type === "HLIST"}
              <div class="param-row">
                <span class="param-label">{parameter.displayName}</span>
                <select
                  id="param-{parameter.name}"
                  value={getParameterDisplayValue(parameter)}
                  onchange={(e) => handleSelectParameterChange(parameter, e)}
                  class="param-select"
                  size="4"
                >
                  {#if parameter.entries}
                    {#each parameter.entries as entry, i}
                      <option value={i}>{entry}</option>
                    {/each}
                  {/if}
                </select>
              </div>

            {:else if parameter.type === "RADIOBUTTON"}
              <div class="param-row">
                <span class="param-label">{parameter.displayName}</span>
                <div class="param-radio-group">
                  {#if parameter.entries}
                    {#each parameter.entries as entry, i}
                      <label class="param-radio-item">
                        <input
                          type="radio"
                          name="param-{parameter.name}"
                          checked={getParameterIntValue(parameter) === i}
                          onchange={() => handleRadioParameterChange(parameter, i)}
                        />
                        <span>{entry}</span>
                      </label>
                    {/each}
                  {/if}
                </div>
              </div>

            {:else if parameter.type === "DIR"}
              <div class="param-row">
                <span class="param-label">{parameter.displayName}</span>
                <div class="param-dir-wrap">
                  <input
                    id="param-{parameter.name}"
                    type="text"
                    value={getParameterDisplayValue(parameter)}
                    onchange={(e) => handleStringParameterChange(parameter, e)}
                    class="param-input-text"
                  />
                  <button
                    class="param-browse-btn"
                    onclick={() => onBrowseDir?.({ parameterName: parameter.name, currentPath: getParameterDisplayValue(parameter) })}
                    title="Browse for folder..."
                  ><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M14.5 3H7.71l-.85-.85L6.51 2h-5l-.5.5v11l.5.5h13l.5-.5v-10L14.5 3zm-.51 8.49V13h-12V7h12v4.49zm0-5.49h-12V3h4.29l.85.85.36.15H14v2.5z"/></svg></button>
                </div>
              </div>

            {:else if parameter.type === "FILE"}
              <div class="param-row">
                <span class="param-label">{parameter.displayName}</span>
                <div class="param-dir-wrap">
                  <input
                    id="param-{parameter.name}"
                    type="text"
                    value={getParameterDisplayValue(parameter)}
                    onchange={(e) => handleStringParameterChange(parameter, e)}
                    class="param-input-text"
                  />
                  <button
                    class="param-browse-btn"
                    onclick={() => onBrowseFile?.({ parameterName: parameter.name, defaultPath: parameter.defaultPath, filter: parameter.filter })}
                    title="Browse for file{parameter.filter ? ` (${parameter.filter})` : ''}..."
                  ><svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><path d="M13.71 4.29l-3-3L10 1H4L3 2v12l1 1h9l1-1V5l-.29-.71zM13 14H4V2h5v4h4v8zm-3-9V2l3 3h-3z"/></svg></button>
                </div>
              </div>

            {:else if parameter.type === "CONTAINER" || parameter.type === "IMAGE"}
              <div class="param-row">
                <span class="param-label">{parameter.displayName}</span>
                <div class="param-container-ref">
                  {getParameterDisplayValue(parameter) || ""}
                </div>
              </div>

            {:else}
              <div class="param-row">
                <span class="param-label">{parameter.displayName}</span>
                <input
                  id="param-{parameter.name}"
                  type="text"
                  value={getParameterDisplayValue(parameter)}
                  onchange={(e) => handleStringParameterChange(parameter, e)}
                  class="param-input-text"
                />
              </div>
            {/if}
          {/each}
        </div>
      {/if}
    </div>
  {/if}
</div>

<style>
  /* ── Layout ── */
  .param-list {
    display: flex;
    flex-direction: column;
  }

  .param-row {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .param-row-inline {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
  }

  .param-row:hover {
    background: rgba(255, 255, 255, 0.03);
  }

  /* ── Labels ── */
  .param-label {
    font-size: 11px;
    color: #6ab0c3;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    user-select: none;
  }

  .param-label-only {
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
  }

  /* ── Section header ── */
  .param-section-header {
    padding: 5px 10px;
    background: rgba(255, 255, 255, 0.04);
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  }

  .param-section-header span {
    font-size: 10px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.5px;
    color: var(--vscode-sideBarSectionHeader-foreground);
  }

  /* ── Info text ── */
  .param-info-text {
    padding: 6px 10px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  }

  .param-info-text pre {
    margin: 0;
    font-family: var(--vscode-font-family);
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    white-space: pre-wrap;
    word-break: break-word;
    line-height: 1.5;
  }

  /* ── Shared input base ── */
  .param-input-text,
  .param-input-number,
  .param-select,
  .param-textarea {
    background: rgba(0, 0, 0, 0.25);
    color: var(--vscode-input-foreground);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 2px;
    font-size: 11px;
    padding: 3px 6px;
    outline: none;
    width: 100%;
    box-sizing: border-box;
  }

  .param-input-text:focus,
  .param-input-number:focus,
  .param-select:focus,
  .param-textarea:focus {
    border-color: var(--vscode-focusBorder);
  }

  /* ── Number input (inline) ── */
  .param-input-number {
    text-align: right;
    flex: 1;
    min-width: 0;
  }

  /* ── Slider ── */
  .param-slider-wrap {
    display: flex;
    align-items: center;
    gap: 6px;
  }

  .param-range {
    flex: 1;
    min-width: 0;
    height: 4px;
    accent-color: #4a9fc5;
    cursor: pointer;
  }

  .param-slider-number {
    width: 64px;
    flex-shrink: 0;
    text-align: right;
    background: rgba(0, 0, 0, 0.25);
    color: var(--vscode-input-foreground);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 2px;
    font-size: 11px;
    padding: 3px 6px;
    outline: none;
    box-sizing: border-box;
  }

  .param-slider-number:focus {
    border-color: var(--vscode-focusBorder);
  }

  /* ── Checkbox ── */
  .param-checkbox {
    width: 14px;
    height: 14px;
    accent-color: #4a9fc5;
    cursor: pointer;
    flex-shrink: 0;
  }

  /* ── Button ── */
  .param-button {
    width: 100%;
    background: rgba(255, 255, 255, 0.08);
    color: var(--vscode-button-foreground);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 2px;
    padding: 4px 8px;
    font-size: 11px;
    cursor: pointer;
    text-align: center;
  }

  .param-button:hover {
    background: rgba(255, 255, 255, 0.12);
  }

  .param-button:active {
    background: rgba(255, 255, 255, 0.16);
  }

  /* ── Color ── */
  .param-color-swatch {
    width: 36px;
    height: 22px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 2px;
    cursor: pointer;
    background: none;
    flex-shrink: 0;
  }

  .param-color-swatch::-webkit-color-swatch-wrapper {
    padding: 1px;
  }

  .param-color-swatch::-webkit-color-swatch {
    border: none;
    border-radius: 1px;
  }


  /* ── Dir selector ── */
  .param-dir-wrap {
    display: flex;
    gap: 4px;
    align-items: center;
  }

  .param-dir-wrap .param-input-text {
    flex: 1;
    min-width: 0;
    width: 0;
  }

  .param-browse-btn {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(255, 255, 255, 0.08);
    color: var(--vscode-descriptionForeground);
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 2px;
    padding: 0;
    cursor: pointer;
  }

  .param-browse-btn:hover {
    background: rgba(255, 255, 255, 0.14);
    color: var(--vscode-foreground);
  }

  /* ── Container / Image ref ── */
  .param-container-ref {
    background: rgba(0, 0, 0, 0.15);
    border: 1px dashed rgba(255, 255, 255, 0.15);
    border-radius: 2px;
    padding: 6px;
    font-size: 11px;
    color: var(--vscode-descriptionForeground);
    min-height: 28px;
    box-sizing: border-box;
  }

  /* ── Textarea ── */
  .param-textarea {
    resize: vertical;
    min-height: 48px;
  }

  .param-textarea::-webkit-resizer {
    background: transparent;
    border: none;
    border-right: 2px solid rgba(255, 255, 255, 0.15);
    border-bottom: 2px solid rgba(255, 255, 255, 0.15);
  }

  /* ── Radio group ── */
  .param-radio-group {
    display: flex;
    flex-direction: column;
    gap: 3px;
  }

  .param-radio-item {
    display: flex;
    align-items: center;
    gap: 5px;
    font-size: 11px;
    color: var(--vscode-foreground);
    cursor: pointer;
  }

  .param-radio-item input {
    accent-color: #4a9fc5;
  }

  /* ── Select ── */
  select option {
    background: var(--vscode-dropdown-background);
    color: var(--vscode-dropdown-foreground);
  }

  /* ── Drag input ── */
  .drag-input {
    cursor: ew-resize;
  }

  .drag-input:focus {
    cursor: text;
  }

  /* ── Hide number spinners ── */
  input[type="number"]::-webkit-inner-spin-button,
  input[type="number"]::-webkit-outer-spin-button {
    -webkit-appearance: none;
    margin: 0;
  }

  input[type="number"] {
    -moz-appearance: textfield;
    appearance: textfield;
  }

  /* ── Utility ── */
  .rotate-180 {
    transform: rotate(180deg);
  }

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

  .min-h-40 {
    min-height: 40px;
  }
</style>
