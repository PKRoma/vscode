# Create new user instruction in active worktree session

Tests creating a user-scoped instruction, which should be stored under `~/.copilot/instructions/`
rather than the VS Code profile folder.

## Preconditions

- Active session with a worktree checked out (continuing from Scenario 3)

## Steps

1. Wait for the sessions workbench to load
2. Set name to "test-user-instruction"
3. Click the customizations sidebar
4. Wait for the customizations overview to load
5. Click the instructions section
6. Verify the management editor is visible
7. Click the add dropdown
8. Click menu item "New Instruction (User)"
9. Select "<name>" in the quick input
10. Verify the embedded editor is visible
11. Verify the editor header contains ".copilot/instructions/<name>.instructions.md"
12. Click the back button
13. Verify user items is visible
14. Verify text "<name>" appears on the page
15. Click the back button
16. Run command "Developer: Customizations Debug"
