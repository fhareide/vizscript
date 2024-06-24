<script lang="ts">
  import TailwindCss from "../TailwindCSS.svelte";
  import { onMount } from "svelte";

  let vizscripts = {};

  const handleGetScripts = async () => {
    tsvscode.postMessage({
      type: "getscripts",
      value: "Get scripts",
    });
  };

  const handleMessage = () => {
    tsvscode.postMessage({
      type: "onInfo",
      value: "This is my message to you",
    });
  };

  onMount(() => {
    window.addEventListener("message", (event) => {
      const message = event.data;
      switch (message.type) {
        case "getscripts":
          console.log("Scripts received", message.value);
          vizscripts = message.value;
          break;
      }
    });
  });
</script>

<TailwindCss />

<!-- svelte-ignore a11y-click-events-have-key-events -->
<!-- svelte-ignore a11y-no-static-element-interactions -->

<div class="h-full relative whitespace-nowrap w-full">
  <div class="h-full overflow-hidden">
    <div class="p-2">
      <button on:click={handleGetScripts}>Get scripts from Viz</button>
    </div>
    <pre>{JSON.stringify(vizscripts, null, 2)}</pre>
    <div class="h-full flex flex-col bg-vscode-sideBar-background">
      <div
        on:click={handleMessage}
        class="cursor-pointer overflow-hidden w-full h-[72px] hover:bg-vscode-list-hoverBackground relative"
      >
        <div class="flex h-full overflow-hidden w-full box-border bg-vscode-contrastBorder pl-[16px] absolute">
          <div class="relative flex items-center">
            <img
              class="shrink h-[42px] w-[42px] pr-[14px] object-contain"
              alt=""
              src="https://ms-dotnettools.gallerycdn.vsassets.io/extensions/ms-dotnettools/vscode-dotnet-runtime/2.0.6/1718054591814/Microsoft.VisualStudio.Services.Icons.Default"
            />
          </div>
          <div class="flex-1 flex-col justify-center overflow-hidden">
            <div class="h-[19px] overflow-hidden flex pr-[11px]">Extension name</div>
            <div class="text-vscode-descriptionForeground">This is some text</div>
            <div class="items-center justify-end h-[24px] flex overflow-hidden pr-[7px]">Footer</div>
          </div>
        </div>
      </div>
      <div class="cursor-pointer overflow-hidden w-full h-[72px] hover:bg-vscode-list-hoverBackground relative">
        <div class="flex h-full overflow-hidden w-full box-border bg-vscode-contrastBorder pl-[16px] absolute">
          <div class="relative flex items-center">
            <img
              class="shrink h-[42px] w-[42px] pr-[14px] object-contain"
              alt=""
              src="https://ms-dotnettools.gallerycdn.vsassets.io/extensions/ms-dotnettools/vscode-dotnet-runtime/2.0.6/1718054591814/Microsoft.VisualStudio.Services.Icons.Default"
            />
          </div>
          <div class="flex-1 flex-col justify-center overflow-hidden">
            <div class="h-[19px] overflow-hidden flex pr-[11px]">Scene name</div>
            <div class="text-vscode-descriptionForeground">This is some text</div>
            <div class="items-center justify-end h-[24px] flex overflow-hidden pr-[7px]">Footer</div>
          </div>
        </div>
      </div>
      <div class="cursor-pointer overflow-hidden w-full h-[72px] hover:bg-vscode-list-hoverBackground relative">
        <div class="flex h-full overflow-hidden w-full box-border bg-vscode-contrastBorder pl-[16px] absolute">
          <div class="relative flex items-center">
            <img
              class="shrink h-[42px] w-[42px] pr-[14px] object-contain"
              alt=""
              src="https://ms-dotnettools.gallerycdn.vsassets.io/extensions/ms-dotnettools/vscode-dotnet-runtime/2.0.6/1718054591814/Microsoft.VisualStudio.Services.Icons.Default"
            />
          </div>
          <div class="flex-1 flex-col justify-center overflow-hidden">
            <div class="h-[19px] overflow-hidden flex pr-[11px]">Extension name</div>
            <div class="text-vscode-descriptionForeground">This is some text</div>
            <div class="items-center justify-end h-[24px] flex overflow-hidden pr-[7px]">Footer</div>
          </div>
        </div>
      </div>
    </div>
  </div>
</div>
