<script lang="ts">
  import ContainerIcon from "../icons/Container.svelte";
  import SceneIcon from "../icons/Scene.svelte";
	import { createEventDispatcher } from "svelte";
  import type { VizScriptObject } from "../../src/shared/types";

  export let script: VizScriptObject;
  export let selectedScriptId: string;
  export let selectedScriptIds: string[] = [];
  export let sidebarSettings: any = null;

  // selectedItem as class names
  const buttonStyles: string = "bg-vscode-list-activeSelectionBackground border-vscode-inputOption-activeBackground border-[1.8px] hover:bg-vscode-menu-selectionBackground/50 ";

	const dispatch = createEventDispatcher();

  const handleScriptSelected = (event: MouseEvent) => {
    // Dispatch selection event to parent component
    dispatch('scriptSelected', {
      script: script,
      isShiftClick: event.shiftKey
    });

    // If preview on single click is enabled, also dispatch preview
    if (sidebarSettings?.previewOnSingleClick) {
      dispatch('preview', { script });
    }
  };

	const handleDoubleClick = () => {
    dispatch('doubleClick', { script });
  };

  const handleRightClick = (event: MouseEvent) => {
    // Select the script so VS Code commands know which script to act on
    dispatch('scriptSelected', {
      script: script,
      isShiftClick: false
    });
    // Don't prevent default - let VS Code show its built-in context menu
  };




</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->

<div
  title={sidebarSettings?.previewOnSingleClick ? 'Single-click to preview, double-click to edit' : (sidebarSettings?.doubleClickAction ? `Double-click ${sidebarSettings.doubleClickAction === 'edit' ? 'to edit' : 'to preview'}` : '')}
  on:click={handleScriptSelected}
	on:dblclick={handleDoubleClick}
  on:contextmenu={handleRightClick}
  class={`cursor-pointer overflow-hidden w-full h-[72px] relative 
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


