# Create a new hook in active worktree session

Tests creating a new `hooks.json` workspace-scoped hook file.
The generated JSON should have `version: 1`, `bash` field, and all hook event types.

## Preconditions

- Active session with a worktree checked out (continuing from Scenario 3)
- No existing hooks.json in the worktree's `.github/hooks/` folder

## Steps

1. Wait for the sessions workbench to load
2. Click the customizations sidebar
3. Wait for the customizations overview to load
4. Click the hooks section
5. Verify the management editor is visible
6. Click the create button
7. Verify the embedded editor is visible
8. Verify the editor header contains ".github/hooks/hooks.json"
9. Verify text "version" appears on the page
10. Verify text "bash" appears on the page
11. Verify text "sessionStart" appears on the page
12. Verify text "userPromptSubmitted" appears on the page
13. Verify text "preToolUse" appears on the page
14. Verify text "postToolUse" appears on the page
15. Click the back button
16. Verify workspace items is visible
17. Click the back button
18. Run command "Developer: Customizations Debug"
