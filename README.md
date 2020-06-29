# Viz Script for Visual Studio Code

> Syntax Highlighting, Auto Complete, Signature Help and Jump to Definition for Viz Script

## Features
* Syntax Highlighting
* Signature Help (for both built-in and document functions. With support for overloading)
* Definition Provider(Ctrl-click to jump to definition)
* Symbol Searching (Ctrl-Shift-O to trigger)
* Auto-Completion (supports both built-in and document completions)
	Includes completions updated to Viz Engine/Artist 3.12


## Supported filetypes
* .vs 
* .v3script 
* .viz


## VS Code Settings
I recommend these settings in VS Code to get the best result with this plugin.

```json
	"editor.quickSuggestions": {
        "other": true,
        "comments": false,
        "strings": false
    },
    "editor.wordBasedSuggestions": false,
    "editor.foldingHighlight": false
```


## Disclaimer
I have no affiliation with Vizrt and this extension is personal work. 

<br>

---

<br>
<br>

## Demos

### Type Completion
![Structure support demo](images/TypeCompletion.gif)

### Structure support
![Structure support demo](images/StructureSupport.gif)

### Jump to Definition
![Jump to Definition demo](images/JumpToDefinition.gif)

### Signature Help
![Signature Help demo](images/SignatureHelp.gif)
