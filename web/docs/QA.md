# Freenetic visual QA

Run this checklist on a test image after automated checks pass. It deliberately
covers interactions that static tests cannot render or announce to a screen
reader.

## Layout and themes

| Viewport | Check |
| --- | --- |
| 1440 px | Open/close sidebar and settings. The page cards must not reflow unexpectedly and the hidden settings panel must not take focus. |
| 768 px | Check the compact settings drawer, sidebar backdrop, and all dialogs. No action should be clipped or overlap another control. |
| 320 px | Check login, dashboard, Wi-Fi QR, Services/Applications, Routing, and Port Forwarding. Text, dialogs, and buttons must remain reachable without horizontal scrolling. |

For each viewport, check Light, Dark, and Automatic appearance. Confirm primary
buttons, warning/error text, selected tabs, focus rings, and the login screen
remain legible. With the operating system's prefers-reduced-motion enabled,
drawer, toast, and decorative animations should stop or become effectively
instant.

## Keyboard and screen reader flow

1. Start on Dashboard, activate a sidebar item with the keyboard, and confirm
   focus lands on the newly rendered page's main landmark and its title is
   announced.
2. Open Settings with the gear, then close it with Escape. Verify focus returns
   to the gear; while closed, its controls must not be tabbable.
3. In Applications, Routing, and Port Forwarding, use Left/Right, Up/Down,
   Home, and End. The selected tab, its panel label, and the focused tab must
   stay in sync.
4. Open the Wi-Fi QR dialog and each login dialog. Tab and Shift+Tab must loop
   within the dialog; Escape and close/cancel must return focus to the opener.
5. On the login page, open **Other management options** and confirm that the
   interface switch clearly says it changes the shell for every web-UI user.

## Localization and operational checks

1. Switch LuCI to Russian, reload, and check the settings drawer, login page,
   sidebar groups **Службы** and **Ещё**, raw partition descriptions, and the
   IPsec labels.
2. If ttyd is installed, open **Command Line** behind the normal hostname,
   an IPv6 hostname if available, and any reverse-proxy prefix. It must target
   the current origin on port 7681 without copying a stale host/protocol.
3. Before publishing APKs, commit the intended source changes and run
   make release. It must reject a dirty worktree and must reject an
   index.json whose advertised APK file is absent.

This checklist was written without a browser-rendering session; record the
tested browser, viewport, image version, and any visual regression alongside a
release candidate.
