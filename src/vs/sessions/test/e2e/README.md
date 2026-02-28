# Agent Sessions — E2E Tests

Natural-language Playwright tests for the Agent Sessions window.

## Architecture

```
e2e/
├── scenarios/               # Plain-English test scenarios (*.scenario.md)
│   └── 01-repo-picker-on-submit.scenario.md
├── extensions/
│   └── mock-chat-provider/  # VS Code extension that provides a fake GitHub
│                            # auth session + chat participant (no real LLM)
├── actionMap.ts             # Maps natural-language steps → Playwright calls
├── scenarioParser.ts        # Parses *.scenario.md files into step arrays
├── scenarios.spec.ts        # Test runner: discovers scenarios, runs steps
├── sessionApp.ts            # Launches VS Code via CDP and returns a Page handle
├── tsconfig.json            # TypeScript config (compiles to out/)
└── out/                     # Compiled JS (git-ignored)
```

### How a Test Runs

1. `sessionApp.ts` spawns the VS Code Electron binary with:
   - `--sessions` — opens the Agent Sessions window instead of the normal workbench
   - `--skip-sessions-welcome` — bypasses the sign-in overlay
   - `--extensionDevelopmentPath=extensions/mock-chat-provider` — injects the mock auth/chat
   - `--remote-debugging-port=<N>` — exposes CDP for Playwright to connect
   - A fresh temporary `--user-data-dir` per run
2. Playwright connects over CDP and finds the sessions workbench page.
3. `scenarioParser.ts` reads every `*.scenario.md` under `scenarios/` and extracts the
   `## Steps` bullet list.
4. For each step bullet, `actionMap.ts` matches it against a list of regex handlers and
   executes the corresponding Playwright action.
5. Results are printed with ✅/❌ per step. Failed steps capture a screenshot to
   `failure-step<N>.png` in the `e2e/` folder.

### Stable Selectors (`data-testid`)

Elements in the Sessions UI use `data-testid` attributes so tests don't break when CSS
class names change. The root workbench element is `[data-testid="sessions-workbench"]`.
When adding new UI elements to the Sessions window, add a corresponding `data-testid`
and register the element in the `ELEMENT_MAP` in `actionMap.ts`.

## Prerequisites

- VS Code compiled: `out/` must exist at the repo root.
  ```bash
  nvm use && npm i && ./scripts/code.sh   # first time only
  ```
- Root `node_modules` installed (the step above handles this).

## Running

```bash
cd src/vs/sessions/test/e2e
node ../../../../../node_modules/typescript/bin/tsc   # compile
node out/scenarios.spec.js                            # run
```

### Environment Variables

| Variable | Description |
|----------|-------------|
| `SESSIONS_E2E_ROOT` | Override the VS Code repo root (defaults to auto-detected) |
| `SESSIONS_E2E_ELECTRON_PATH` | Override the Electron binary path |

Example:

```bash
SESSIONS_E2E_ROOT=/path/to/vscode node out/scenarios.spec.js
```

## Writing a Scenario

Create a `*.scenario.md` in `scenarios/`:

```markdown
# My Scenario Name

Short description of what this scenario tests.

## Steps

- wait for the sessions workbench to load
- verify the sidebar is visible
- type "hello" in the chat input
- press Enter
- verify a chat response appears
```

The `## Steps` section is the only required section. An optional `## Preconditions`
section (bullet list) is parsed and printed before the steps run, but not executed.

### Supported Steps

| Pattern | Action |
|---------|--------|
| `wait for <element> to load` | Wait for element to be visible (30 s) |
| `wait <N> seconds` | Explicit wait |
| `verify <element> is visible` | Assert element is visible (10 s) |
| `verify <element> is not visible` | Assert element is hidden (10 s) |
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
| `press Enter to submit` | Press Enter inside the chat input |
| `click <element>` | Click an element |
| `click button "<text>"` | Click button by visible text |
| `click menu item "<text>"` | Click menu item by visible text |
| `click link "<text>"` | Click link by visible text |
| `select "<text>" in the quick input` | Type and confirm in quick input |
| `run command "<command>"` | Open command palette and run command |
| `select workspace folder "<path>"` | Select a workspace folder |

### Variables

Steps can use `<varName>` placeholders replaced at runtime:

```markdown
- set name to "my-instruction"
- select "<name>" in the quick input
- verify the editor header contains "<name>.instructions.md"
```

### Known Elements

**Workbench parts:** `the sessions workbench`, `the workbench`, `the sidebar`,
`the chat bar`, `the titlebar`, `the auxiliary bar`, `the panel`

**Chat:** `the chat input`, `a chat response`

**Session target (Local / Cloud):** `the target picker`, `the local button`,
`the cloud button`

**Repository:** `the repo picker`, `the repository picker`, `the repository picker dropdown`

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

1. Add a `data-testid="<your-id>"` attribute to the element in the Sessions UI source.
2. Add a new entry to the `ELEMENT_MAP` in `actionMap.ts`:
   ```ts
   'the my new element': `[data-testid="my-id"]`,
   ```
