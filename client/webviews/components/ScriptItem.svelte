<script lang="ts">
  import ContainerIcon from "../icons/Container.svelte";
  import SceneIcon from "../icons/Scene.svelte";
	import { createEventDispatcher } from "svelte";
  import type { VizScriptObject } from "../../src/shared/types";

  export let script: VizScriptObject;
  export let selectedScriptId: string;
  export let selectedScriptIds: string[] = [];
  export let vizscripts: VizScriptObject[] = [];
	
  let showContextMenu = false;
  let contextMenuX = 0;
  let contextMenuY = 0;
  let canShowMerge = false;
  let canShowSplit = false;
  let scriptsToCheck: string[] = [];

  // selectedItem as class names
  const buttonStyles: string = "bg-vscode-list-activeSelectionBackground border-vscode-inputOption-activeBackground border-[1.8px] hover:bg-vscode-menu-selectionBackground/50 ";

	const dispatch = createEventDispatcher();

  const handleScriptSelected = (event: MouseEvent) => {
    // Dispatch selection event to parent component
    dispatch('scriptSelected', {
      script: script,
      isShiftClick: event.shiftKey
    });
  };

	const handleDoubleClick = () => {
    dispatch('doubleClick', { script });
  };

  const handleRightClick = (event: MouseEvent) => {
    event.preventDefault();
    
    console.log("=== RIGHT CLICK DEBUG ===");
    console.log("Script:", script.vizId, script.name);
    console.log("Is group:", script.isGroup);
    console.log("Selected IDs:", selectedScriptIds);
    console.log("Selected count:", selectedScriptIds.length);
    console.log("Current script selected?", selectedScriptIds.includes(script.vizId));
    console.log("Current selectedScriptId:", selectedScriptId);
    
    // Show context menu for groups (split option) or when multiple containers are selected (merge option)
    canShowSplit = script.isGroup === true;
    
    // For merge: check if we have 2+ container scripts selected, or 1+ selected + right-clicking another container
    let totalContainerScripts = selectedScriptIds.length;
    
    // If right-clicking on a container that's not already selected, count it too
    if (script.type === "Container" && !script.isGroup && !selectedScriptIds.includes(script.vizId)) {
      totalContainerScripts += 1;
    }
    
    console.log("Total container scripts for merge:", totalContainerScripts);
    console.log("Selected IDs:", selectedScriptIds);
    console.log("Current script:", script.vizId, "type:", script.type, "isGroup:", script.isGroup);
    
    // Show merge if we have 2+ containers total AND all selected scripts are valid containers
    canShowMerge = totalContainerScripts >= 2 && 
                   selectedScriptIds.every(id => {
                     const s = vizscripts.find(vs => vs.vizId === id);
                     return s && s.type === "Container" && (s.isGroup !== true);
                   }) &&
                   (script.type === "Container" && !script.isGroup); // Right-clicked script must also be a valid container
    
    // Update scriptsToCheck for the menu display
    scriptsToCheck = [...selectedScriptIds];
    if (script.type === "Container" && !script.isGroup && !selectedScriptIds.includes(script.vizId)) {
      scriptsToCheck.push(script.vizId);
    }
    
    console.log("Can show split:", canShowSplit);
    console.log("Can show merge:", canShowMerge);
    console.log("Event coordinates:", event.clientX, event.clientY);
    
    if (canShowSplit || canShowMerge) {
      contextMenuX = event.clientX;
      contextMenuY = event.clientY;
      showContextMenu = true;
      console.log("Setting showContextMenu to true, position:", contextMenuX, contextMenuY);
    } else {
      console.log("NOT showing context menu");
    }
    
    console.log("showContextMenu state:", showContextMenu);
    console.log("=========================");
  };

  const handleSplitGroup = () => {
    if (script.isGroup) {
      tsvscode.postMessage({
        type: "splitGroup",
        value: script.vizId,
      });
    }
    showContextMenu = false;
  };

  const handleMergeSelected = () => {
    // Include current script if it's a container and not already in selection
    let scriptsToMerge = [...selectedScriptIds];
    if (script.type === "Container" && !script.isGroup && !selectedScriptIds.includes(script.vizId)) {
      scriptsToMerge.push(script.vizId);
    }
    
    if (scriptsToMerge.length >= 2) {
      tsvscode.postMessage({
        type: "mergeSelectedScripts",
        value: scriptsToMerge,
      });
    }
    showContextMenu = false;
  };

  const closeContextMenu = () => {
    showContextMenu = false;
  };
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->

<div
  on:click={handleScriptSelected}
	on:dblclick={handleDoubleClick}
  on:contextmenu={handleRightClick}
  class={`cursor-pointer overflow-hidden w-full h-[72px] relative select-none
	${selectedScriptId === script.vizId || selectedScriptIds.includes(script.vizId) ? buttonStyles : "hover:bg-vscode-list-hoverBackground"}`}
>
  <div class="flex h-full overflow-hidden w-full box-border pl-[16px] absolute">
    <div class="relative flex items-center pr-4">
      {#if script.type == "Scene"}
        <SceneIcon class="w-full" size={40} />
      {:else}
        <ContainerIcon class="w-full" size={40} />
      {/if}
    </div>
    <div class="flex-1 flex-col justify-center overflow-hidden">
      <div class="h-[19px] overflow-hidden flex pr-[11px]">{script.name}</div>
      <div class="text-vscode-descriptionForeground flex gap-2"><p>
				{script.type}
			</p>
			<p>
				{script.vizId}
			</p>
			{#if script.isGroup}
				<p class="text-yellow-400">
					[GROUP]
				</p>
			{/if}
			{#if script.treePath}
				<p class="text-vscode-textLink-foreground text-xs">
					{Array.isArray(script.treePath) ? script.treePath.slice(0, 2).join(', ') + (script.treePath.length > 2 ? '...' : '') : script.treePath}
				</p>
			{/if}
		</div>
      <div class="items-center justify-end h-[24px] flex overflow-hidden pr-[7px]">{script.extension}</div>
    </div>
  </div>
</div>

<!-- Context Menu -->
{#if showContextMenu}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div 
    class="fixed inset-0" 
    style="z-index: 9999;"
    on:click={closeContextMenu}
  >
    <div 
      class="absolute bg-gray-800 border border-gray-600 shadow-xl rounded-md py-1 min-w-[140px] text-white"
      style="left: {contextMenuX}px; top: {contextMenuY}px; z-index: 10000;"
      on:click|stopPropagation
    >
      {#if canShowSplit}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div 
          class="px-3 py-2 hover:bg-gray-700 cursor-pointer text-sm"
          on:click={handleSplitGroup}
        >
          Split Group
        </div>
      {/if}
      
      {#if canShowMerge}
        <!-- svelte-ignore a11y-click-events-have-key-events -->
        <!-- svelte-ignore a11y-no-static-element-interactions -->
        <div 
          class="px-3 py-2 hover:bg-gray-700 cursor-pointer text-sm"
          on:click={handleMergeSelected}
        >
          Merge Selected ({scriptsToCheck.length})
        </div>
      {/if}
    </div>
  </div>
{/if}
