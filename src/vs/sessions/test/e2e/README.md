# Agent Sessions — E2E Tests

Natural-language Playwright tests for the Agent Sessions window.

## How it Works

1. **Scenarios** are written in markdown under `scenarios/`. Each `.scenario.md` file
   describes a test using plain English steps (e.g., "verify the sidebar is visible").
2. **The action map** (`actionMap.ts`) translates each step into a Playwright operation
   against the sessions window DOM.
3. **A mock chat extension** (`extensions/mock-chat-provider/`) is loaded into VS Code
   so chat input works without needing a real LLM.
4. **The test runner** (`scenarios.spec.ts`) discovers all scenario files, creates
   test cases for each step, and runs them sequentially.

## Prerequisites

- VS Code compiled: `out/` directory must exist at the repo root (run
  `./scripts/code.sh` from the repo root once).
- Correct Electron downloaded (happens automatically during `./scripts/code.sh`).
- Root `node_modules` installed (`npm install` from repo root).

## Running

```bash
cd src/vs/sessions/test/e2e
node ../../../../../node_modules/typescript/bin/tsc
node out/scenarios.spec.js
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `SESSIONS_E2E_ROOT` | Override the VS Code repo root (defaults to auto-detected) |
| `SESSIONS_E2E_ELECTRON_PATH` | Override the Electron binary path |

Example with overrides:

```bash
SESSIONS_E2E_ROOT=/path/to/vscode SESSIONS_E2E_ELECTRON_PATH=/path/to/electron node out/scenarios.spec.js
```

## Writing a Scenario

Create a `*.scenario.md` in `scenarios/`:

```markdown
# My Scenario Name

Description of what this tests.

## Steps

- wait for the sessions workbench to load
- verify the sidebar is visible
- type "hello" in the chat input
- press Enter
- verify a chat response appears
```

### Supported Steps

| Pattern | Action |
|---------|--------|
| `wait for <element> to load` | Wait for element to be visible (30s) |
| `wait <N> seconds` | Explicit wait |
| `verify <element> is visible` | Assert element is visible (10s) |
| `verify <element> is not visible` | Assert element is hidden (10s) |
| `verify <element> has text "<text>"` | Assert element contains text |
| `verify <element> text contains "<text>"` | Assert element text includes substring |
| `verify text "<text>" appears on the page` | Assert text visible anywhere on page |
| `verify <element> count is <N>` | Assert number of matching elements |
| `verify <element> count is greater than <N>` | Assert at least N+1 matching elements |
| `verify all sidebar badges are hidden` | Assert all badge counts are 0 or empty |
| `verify the editor header contains "<text>"` | Assert editor header includes text |
| `store <element> text as <varName>` | Save element text to a variable |
| `set <varName> to "<value>"` | Set a variable for later steps |
| `type "<text>" in <element>` | Focus element and type text |
| `press <key>` | Press a keyboard key |
| `click <element>` | Click an element |
| `click button "<text>"` | Click button by visible text |
| `click menu item "<text>"` | Click menu item by visible text |
| `click link "<text>"` | Click link by visible text |
| `select "<text>" in the quick input` | Type and confirm in quick input |
| `run command "<command>"` | Open command palette and run command |
| `select workspace folder "<path>"` | Select a workspace folder |

### Variables

Steps can use `<varName>` placeholders that get replaced at runtime:

```markdown
- set name to "my-instruction"
- select "<name>" in the quick input
- verify the editor header contains "<name>.instructions.md"
```

### Known Elements

**Workbench parts:** `the sessions workbench`, `the sidebar`, `the chat bar`,
`the titlebar`, `the auxiliary bar`, `the panel`

**Chat:** `the chat input`, `a chat response`

**AI Customization overview:** `the customizations sidebar`,
`the customizations overview`, `the agents section`, `the skills section`,
`the instructions section`, `the prompts section`, `the hooks section`

**Section counts:** `the agents count`, `the skills count`,
`the instructions count`, `the prompts count`, `the hooks count`

**Management editor:** `the management editor`, `the editor header`,
`the embedded editor`, `the empty state`, `workspace items`, `user items`,
`extension items`, `customization items`

**Buttons:** `the create button`, `the back button`, `the add dropdown`

**Inputs:** `the quick input`, `the quick input box`, `sidebar badges`

## Adding New Steps

Add a new `StepHandler` entry to the `STEP_HANDLERS` array in `actionMap.ts`.

## Adding New Elements

Add a new entry to the `ELEMENT_MAP` in `actionMap.ts` mapping a natural-language
name to a CSS selector scoped to `.agent-sessions-workbench`.
