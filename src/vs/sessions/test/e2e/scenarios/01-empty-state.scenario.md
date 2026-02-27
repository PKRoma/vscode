# Empty state — no session, no customizations

Tests the baseline empty state before any session or workspace is active.
The "new AI developer" state who doesn't have any customizations yet.

## Preconditions

- On "New Session" screen
- No folder selected
- No user customizations created

## Steps

1. Wait for the sessions workbench to load
2. Click the customizations sidebar
3. Wait for the customizations overview to load
4. Verify all sidebar badges are hidden
5. Click the instructions section
6. Verify the management editor is visible
7. Verify text "No instructions yet" appears on the page
8. Click the back button
9. Click the agents section
10. Verify text "No agents yet" appears on the page
11. Click the back button
12. Click the skills section
13. Verify text "No skills yet" appears on the page
14. Click the back button
15. Click the prompts section
16. Verify text "No prompts yet" appears on the page
17. Click the back button
18. Click the hooks section
19. Verify text "No hooks yet" appears on the page
20. Run command "Developer: Customizations Debug"
