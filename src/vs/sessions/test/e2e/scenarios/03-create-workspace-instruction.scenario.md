# Create new workspace instruction in active worktree session

Tests creating a new workspace-scoped instruction file from the management editor.
The file should be created in the worktree's `.github/instructions/` folder.

## Preconditions

- Active session with a worktree checked out (task started)
- Same repository as Scenario 2

## Steps

1. Wait for the sessions workbench to load
2. Set name to "test-instruction"
3. Click the customizations sidebar
4. Wait for the customizations overview to load
5. Store the instructions count text as countBefore
6. Click the instructions section
7. Verify the management editor is visible
8. Click the create button
9. Click button "New Instruction (Workspace)"
10. Select "<name>" in the quick input
11. Verify the embedded editor is visible
12. Verify the editor header contains ".github/instructions/<name>.instructions.md"
13. Type "This is a test instruction for E2E testing." in the embedded editor
14. Click the back button
15. Verify workspace items is visible
16. Verify text "<name>" appears on the page
17. Click the back button
18. Verify the customizations overview is visible
