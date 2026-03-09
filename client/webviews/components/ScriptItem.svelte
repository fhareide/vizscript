<script lang="ts">
  import ContainerIcon from "../icons/Container.svelte";
  import SceneIcon from "../icons/Scene.svelte";
  import type { VizScriptObject } from "../../src/shared/types";

  interface Props {
    script: VizScriptObject;
    selectedScriptId: string;
    selectedScriptIds?: string[];
    sidebarSettings?: any;
    depth?: number;
    searchTerm?: string;
    isCollapsible?: boolean;
    isCollapsed?: boolean;
    childrenMatchSearch?: boolean;
    firstMatchingChildId?: string;
    onScriptSelected?: (detail: { script: VizScriptObject; isShiftClick: boolean }) => void;
    onDoubleClick?: (detail: { script: VizScriptObject }) => void;
    onToggleCollapse?: (vizId: string) => void;
    onOpenAndSearch?: (detail: { vizId: string; searchTerm: string }) => void;
  }

  let { 
    script, 
    selectedScriptId, 
    selectedScriptIds = [], 
    sidebarSettings = null,
    depth = 0,
    searchTerm = "",
    isCollapsible = false,
    isCollapsed = false,
    childrenMatchSearch = false,
    firstMatchingChildId,
    onScriptSelected,
    onDoubleClick,
    onToggleCollapse,
    onOpenAndSearch,
  }: Props = $props();

  // selectedItem as class names
  const buttonStyles: string = "bg-vscode-list-activeSelectionBackground border-vscode-inputOption-activeBackground border-[1.8px] hover:bg-vscode-menu-selectionBackground/50 ";

  const handleScriptSelected = (event: MouseEvent) => {
    onScriptSelected?.({
      script: script,
      isShiftClick: event.shiftKey
    });
  };

  const handleDoubleClick = () => {
    onDoubleClick?.({ script });
  };

  const handleRightClick = (event: MouseEvent) => {
    onScriptSelected?.({
      script: script,
      isShiftClick: false
    });
  };

  const handleChevronClick = (event: MouseEvent) => {
    event.stopPropagation();
    onToggleCollapse?.(script.vizId);
  };

  const handleOpenAndSearch = (event: MouseEvent) => {
    event.stopPropagation();
    if (!searchTerm) return;
    // For a collapsed group whose children match, open the first matching child instead
    const targetVizId = (script.isGroup && firstMatchingChildId) ? firstMatchingChildId : script.vizId;
    onOpenAndSearch?.({ vizId: targetVizId, searchTerm });
  };

  // Highlight matching substring in text
  function highlightParts(text: string, term: string): { text: string; highlight: boolean }[] {
    if (!term) return [{ text, highlight: false }];
    const idx = text.toLowerCase().indexOf(term.toLowerCase());
    if (idx === -1) return [{ text, highlight: false }];
    return [
      { text: text.slice(0, idx), highlight: false },
      { text: text.slice(idx, idx + term.length), highlight: true },
      { text: text.slice(idx + term.length), highlight: false },
    ];
  }

  let nameParts = $derived(highlightParts(script.name, searchTerm));

  const lowerTerm = $derived(searchTerm.trim().toLowerCase());

  // True when the match is in the code body (not the name)
  let codeMatches = $derived(
    !!lowerTerm &&
    !script.name.toLowerCase().includes(lowerTerm) &&
    !!(script.code ?? "").toLowerCase().includes(lowerTerm)
  );

  // True when the script matches and should show the highlight border.
  // For collapsed groups, suppress the highlight — the children are hidden so
  // showing the border on the parent would be misleading.
  let anyMatch = $derived(
    !!lowerTerm &&
    !(isCollapsible && isCollapsed) &&
    (
      script.name.toLowerCase().includes(lowerTerm) ||
      (script.code ?? "").toLowerCase().includes(lowerTerm)
    )
  );
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
  class={`cursor-pointer w-full h-[72px] relative select-none 
	${selectedScriptId === script.vizId || selectedScriptIds.includes(script.vizId) ? buttonStyles : depth > 0 ? "hover:bg-vscode-list-hoverBackground bg-black/20" : "hover:bg-vscode-list-hoverBackground"}
	${selectedScriptIds.includes(script.vizId) && selectedScriptIds.length > 1 ? "border-l-4 border-vscode-textLink-foreground" : (anyMatch || (script.isGroup && childrenMatchSearch)) ? "border-l-[3px] border-yellow-400" : ""}`}
>

  <!-- absolutely fill the row, offset by depth indent -->
  <div
    class="absolute inset-0 flex items-center overflow-hidden"
    style="padding-left: {depth * 16}px; padding-right: 7px;"
  >
    <!-- Chevron toggle for collapsible groups, or spacer to align non-group items -->
    {#if isCollapsible}
      <button
        onclick={handleChevronClick}
        ondblclick={(e) => e.stopPropagation()}
        class="flex items-center justify-center w-[32px] shrink-0 self-stretch text-vscode-descriptionForeground hover:text-vscode-foreground bg-transparent border-0 cursor-pointer p-0 outline-none"
        style="outline: none !important; box-shadow: none !important;"
        title={isCollapsed ? "Expand group" : "Collapse group"}
      >
        {#if isCollapsed}
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l6 4-6 4V4z"/></svg>
        {:else}
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 16 16" fill="currentColor"><path d="M4 6l4 6 4-6H4z"/></svg>
        {/if}
      </button>
    {:else}
      <div class="w-[32px] shrink-0"></div>
    {/if}

    <!-- Icon -->
    <div class="flex items-center justify-center w-[40px] shrink-0 mr-4">
      {#if script.type == "Scene"}
        <SceneIcon size={40} />
      {:else}
        <ContainerIcon size={40} />
      {/if}
    </div>

    <!-- Text content -->
    <div class="flex flex-col justify-center overflow-hidden flex-1 min-w-0">
      <div class="h-[19px] overflow-hidden flex items-center gap-0">
        {#each nameParts as part}
          {#if part.highlight}
            <mark class="bg-yellow-300 text-black rounded-sm px-0 shrink-0">{part.text}</mark>
          {:else}
            <span>{part.text}</span>
          {/if}
        {/each}
      </div>
      <div class="text-vscode-descriptionForeground flex gap-2 text-sm truncate">
        {#if codeMatches}
          <span class="text-xs bg-yellow-500/20 text-yellow-300 rounded px-1 shrink-0">in code</span>
        {/if}
        {#if script.treePath && !Array.isArray(script.treePath)}
          <span class="text-vscode-textLink-foreground text-xs truncate" title={script.treePath}>
            {script.treePath}
          </span>
        {:else if Array.isArray(script.treePath) && script.treePath.length > 0}
          <span class="text-vscode-textLink-foreground text-xs truncate" title={script.treePath.join('\n')}>
            {script.treePath[0]}{script.treePath.length > 1 ? ` +${script.treePath.length - 1}` : ''}
          </span>
        {:else if !script.isGroup}
          <span>{script.type}</span>
        {/if}
      </div>
      <div class="text-xs text-vscode-descriptionForeground">{script.extension}</div>
    </div>

    <!-- Open-and-find button: shown when search is active and either not a group, or a group with matching children -->
    {#if searchTerm && (!script.isGroup || childrenMatchSearch)}
      <button
        onclick={handleOpenAndSearch}
        ondblclick={(e) => e.stopPropagation()}
        class="shrink-0 ml-1 flex items-center justify-center w-[24px] h-[24px] rounded text-vscode-descriptionForeground hover:text-vscode-foreground hover:bg-vscode-toolbar-hoverBackground bg-transparent border-0 cursor-pointer p-0 outline-none"
        style="outline: none !important; box-shadow: none !important;"
        title="Open in editor and jump to '{searchTerm}'"
      >
        <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
          <path d="M11.742 10.344a6.5 6.5 0 1 0-1.397 1.398l3.85 3.85a1 1 0 0 0 1.415-1.414l-3.868-3.834zm-5.242 1.406a5 5 0 1 1 0-10 5 5 0 0 1 0 10z"/>
        </svg>
      </button>
    {/if}
  </div>
</div>

<style>
  button:focus,
  button:focus-visible {
    outline: none !important;
    box-shadow: none !important;
  }
</style>
