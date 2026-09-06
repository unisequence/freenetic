# Freenetic OpenWrt packages

This component owns two independently installable LuCI packages:

- `luci-theme-freenetic/` builds the visual shell: templates, CSS, fonts and
  theme settings;
- `luci-app-freenetic/` builds the router UI: views, LuCI menus, rpcd ACLs and
  backend helpers;
- `deploy.sh` installs the application and the web component on a test router;
- `tests/` checks contracts between privileged ACLs and browser-side calls.

Each package's `htdocs` and `ucode` entries are intentional links into `web/`.
They are the boundary through which the stock LuCI build system assembles the
browser sources into separate APKs. Browser implementation files belong in
`web/`, not here.

The application menu is named `zz-luci-freenetic.json` deliberately: its
entries override same-path stock LuCI pages (notably System) after LuCI's
lexical menu merge.

Point two OpenWrt package entries at the corresponding package directories:

```sh
ln -s /path/to/freenetic/app/luci-theme-freenetic /path/to/openwrt/package/luci-theme-freenetic
ln -s /path/to/freenetic/app/luci-app-freenetic /path/to/openwrt/package/luci-app-freenetic
```
