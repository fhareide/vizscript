<script lang="ts">
  import ContainerIcon from "../icons/Container.svelte";
  import SceneIcon from "../icons/Scene.svelte";
	import { createEventDispatcher } from "svelte";
  import type { VizScriptObject } from "../types";

  export let script: VizScriptObject;
  export let selectedScriptId: string;

  // selectedItem as class names
  const buttonStyles: string = "bg-vscode-menu-selectionBackground hover:bg-vscode-menu-selectionBackground/50 ";


	const dispatch = createEventDispatcher();


  const handleScriptSelected = () => {
    selectedScriptId = script.vizId;
  };

	const handleDoubleClick = () => {
    dispatch('doubleClick', { script });
  };
</script>

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->

<div
  on:click={handleScriptSelected}
	on:dblclick={handleDoubleClick}
  class={`cursor-pointer overflow-hidden w-full h-[72px] relative select-none
	${selectedScriptId === script.vizId ? buttonStyles : "hover:bg-vscode-list-hoverBackground "}`}
>
  <div class="flex h-full overflow-hidden w-full box-border bg-vscode-contrastBorder pl-[16px] absolute">
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
		</div>
      <div class="items-center justify-end h-[24px] flex overflow-hidden pr-[7px]">{script.extension}</div>
    </div>
  </div>
</div>
