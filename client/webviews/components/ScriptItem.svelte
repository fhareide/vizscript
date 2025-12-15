<script lang="ts">
  import ContainerIcon from "../icons/Container.svelte";
  import SceneIcon from "../icons/Scene.svelte";
  import type { VizScriptObject } from "../../src/shared/types";

  interface Props {
    script: VizScriptObject;
    selectedScriptId: string;
    selectedScriptIds?: string[];
    sidebarSettings?: any;
    onScriptSelected?: (detail: { script: VizScriptObject; isShiftClick: boolean }) => void;
    onDoubleClick?: (detail: { script: VizScriptObject }) => void;
  }

  let { 
    script, 
    selectedScriptId, 
    selectedScriptIds = [], 
    sidebarSettings = null,
    onScriptSelected,
    onDoubleClick
  }: Props = $props();

  // selectedItem as class names
  const buttonStyles: string = "bg-vscode-list-activeSelectionBackground border-vscode-inputOption-activeBackground border-[1.8px] hover:bg-vscode-menu-selectionBackground/50 ";

  const handleScriptSelected = (event: MouseEvent) => {
    // Dispatch selection event to parent component
    onScriptSelected?.({
      script: script,
      isShiftClick: event.shiftKey
    });
  };

  const handleDoubleClick = () => {
    onDoubleClick?.({ script });
  };

  const handleRightClick = (event: MouseEvent) => {
    // Select the script so VS Code commands know which script to act on
    onScriptSelected?.({
      script: script,
      isShiftClick: false
    });
    // Don't prevent default - let VS Code show its built-in context menu
  };
</script>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_static_element_interactions -->

<div
  title={sidebarSettings?.doubleClickAction ? `Double-click ${sidebarSettings.doubleClickAction === 'edit' ? 'to edit' : 'to preview'}` : ''}
  onclick={handleScriptSelected}
  ondblclick={handleDoubleClick}
  data-vscode-context={JSON.stringify({
    "webviewSection": "scriptItem", 
    "preventDefaultContextMenuItems": true,
    "script": script,
    "isSelected": selectedScriptId === script.vizId || selectedScriptIds.includes(script.vizId),
    "selectedScriptIds": selectedScriptIds,
    "hasMultipleSelection": selectedScriptIds.length > 1,
    "isGroup": script.isGroup,
    "isContainer": script.type === "Container"
  })}
  class={`cursor-pointer overflow-hidden w-full h-[72px] relative select-none 
	${selectedScriptId === script.vizId || selectedScriptIds.includes(script.vizId) ? buttonStyles : "hover:bg-vscode-list-hoverBackground"}
	${selectedScriptIds.includes(script.vizId) && selectedScriptIds.length > 1 ? "border-l-4 border-vscode-textLink-foreground" : ""}`}
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
