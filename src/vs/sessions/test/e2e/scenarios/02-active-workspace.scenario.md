# Active workspace selected from new session state

Tests the transition from empty state to having an active workspace selected.
Customizations should be loaded from the repository root and counts should reflect that.

## Preconditions

- On "New Session" screen (Scenario 1 completed)
- A git repository cloned on the machine is available to select

## Steps

1. Wait for the sessions workbench to load
2. Select workspace folder "vscode"
3. Wait 3 seconds
4. Click the customizations sidebar
5. Wait for the customizations overview to load
6. Store the instructions count text as instructionsCount
7. Click the instructions section
8. Verify the management editor is visible
9. Verify workspace items is visible
10. Click the back button
11. Click the agents section
12. Verify the management editor is visible
13. Verify customization items count is greater than 0
14. Click the back button
15. Click the skills section
16. Verify the management editor is visible
17. Click the back button
18. Click the prompts section
19. Verify the management editor is visible
20. Click the back button
21. Click the hooks section
22. Verify the management editor is visible
23. Verify extension items is not visible
24. Run command "Developer: Customizations Debug"
