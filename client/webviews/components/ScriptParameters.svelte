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
        if (parameter.min !== undefined && numValue < parameter.min) processedValue = parameter.min.toString();
        if (parameter.max !== undefined && numValue > parameter.max) processedValue = parameter.max.toString();
        break;
      }
      case "FLOAT":
      case "DOUBLE":
      case "SLIDERDOUBLE": {
        const numValue = parseFloat(newValue);
        if (isNaN(numValue)) return;
        if (parameter.min !== undefined && numValue < parameter.min) processedValue = parameter.min.toString();
        if (parameter.max !== undefined && numValue > parameter.max) processedValue = parameter.max.toString();
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

  function onDragMove(event: MouseEvent) {
    if (!dragParam) return;
    const dx = event.clientX - dragStartX;
    let newVal = dragStartValue + dx * dragStep;
    if (dragParam.min !== undefined && newVal < dragParam.min) newVal = dragParam.min;
    if (dragParam.max !== undefined && newVal > dragParam.max) newVal = dragParam.max;
    const formatted = dragIsFloat ? parseFloat(newVal.toFixed(2)).toString() : Math.round(newVal).toString();
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

  let sliderDragParam: ScriptParameter | null = $state(null);

  function getSliderPercent(parameter: ScriptParameter): number {
    const min = parameter.min ?? 0;
    const max = parameter.max ?? 100;
    const val = parseFloat(getParameterDisplayValue(parameter)) || 0;
    if (max === min) return 0;
    return Math.max(0, Math.min(100, ((val - min) / (max - min)) * 100));
  }

  function sliderPointerDown(event: PointerEvent, parameter: ScriptParameter) {
    const track = (event.currentTarget as HTMLElement);
    track.setPointerCapture(event.pointerId);
    sliderDragParam = parameter;
    updateSliderFromPointer(event, parameter);
  }

  function sliderPointerMove(event: PointerEvent, parameter: ScriptParameter) {
    if (sliderDragParam !== parameter) return;
    updateSliderFromPointer(event, parameter);
  }

  function sliderPointerUp(event: PointerEvent, parameter: ScriptParameter) {
    if (sliderDragParam !== parameter) return;
    const track = (event.currentTarget as HTMLElement);
    track.releasePointerCapture(event.pointerId);
    sliderDragParam = null;
    handleParameterChange(parameter, getParameterDisplayValue(parameter), false);
  }

  function updateSliderFromPointer(event: PointerEvent, parameter: ScriptParameter) {
    const track = (event.currentTarget as HTMLElement);
    const rect = track.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    const min = parameter.min ?? 0;
    const max = parameter.max ?? 100;
    const isFloat = isFloatType(parameter.type);
    const step = isFloat ? 0.01 : 1;
    let val = min + ratio * (max - min);
    val = Math.round(val / step) * step;
    val = Math.max(min, Math.min(max, val));
    const formatted = isFloat ? parseFloat(val.toFixed(2)).toString() : Math.round(val).toString();
    handleParameterChange(parameter, formatted, true);
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

<div class="{showParameters ? 'flex-1' : 'h-auto min-h-40'} flex flex-col border-t border-vscode-editorGroup-border">
  <div 
    class="flex items-center justify-between p-2 bg-vscode-sideBarSectionHeader-background hover:bg-vscode-list-hoverBackground cursor-pointer select-none {showParameters ? 'border-b border-vscode-editorGroup-border' : ''}"
    onclick={toggleShowParameters}
    onkeydown={handleKeydown}
    tabindex="0"
    role="button"
    title="Click to {showParameters ? 'collapse' : 'expand'} parameters panel"
  >
    <h3 class="text-sm font-medium text-vscode-sideBarSectionHeader-foreground">Parameters</h3>
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
              <div class="param-section-header">
                <span>{parameter.displayName}</span>
              </div>

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
              <div class="param-row">
                <span class="param-label">{parameter.displayName}</span>
                <div class="param-slider-wrap">
                  <!-- svelte-ignore a11y_no_static_element_interactions -->
                  <div
                    class="param-slider-track"
                    onpointerdown={(e) => sliderPointerDown(e, parameter)}
                    onpointermove={(e) => sliderPointerMove(e, parameter)}
                    onpointerup={(e) => sliderPointerUp(e, parameter)}
                  >
                    <div class="param-slider-fill" style="width: {getSliderPercent(parameter)}%"></div>
                    <div class="param-slider-thumb" style="left: {getSliderPercent(parameter)}%"></div>
                  </div>
                  <input
                    id="param-{parameter.name}"
                    type="number"
                    value={getParameterDisplayValue(parameter)}
                    min={parameter.min}
                    max={parameter.max}
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
              <div class="param-row param-row-inline">
                <span class="param-label">{parameter.displayName}</span>
                <input
                  id="param-{parameter.name}"
                  type="color"
                  value={getParameterDisplayValue(parameter) || "#000000"}
                  onchange={(e) => handleColorParameterChange(parameter, e)}
                  class="param-color"
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

  .param-slider-track {
    flex: 1;
    min-width: 0;
    height: 20px;
    background: #2a2a2a;
    border-radius: 3px;
    position: relative;
    cursor: pointer;
    touch-action: none;
    overflow: hidden;
  }

  .param-slider-fill {
    position: absolute;
    top: 0;
    left: 0;
    height: 100%;
    background: #2a6a8a;
    border-radius: 3px 0 0 3px;
    pointer-events: none;
  }

  .param-slider-thumb {
    position: absolute;
    top: 0;
    width: 4px;
    height: 100%;
    background: #5bb8de;
    transform: translateX(-50%);
    pointer-events: none;
    border-radius: 1px;
  }

  .param-slider-track:hover .param-slider-thumb {
    background: #6cc8ee;
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
  .param-color {
    width: 28px;
    height: 20px;
    padding: 0;
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 2px;
    cursor: pointer;
    background: none;
    flex-shrink: 0;
  }

  .param-color::-webkit-color-swatch-wrapper {
    padding: 1px;
  }

  .param-color::-webkit-color-swatch {
    border: none;
    border-radius: 1px;
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
