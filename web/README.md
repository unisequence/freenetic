# Freenetic web interface

This component contains only browser-facing LuCI code, split by package:

- `theme/` — CSS, fonts, login/shell templates, menu renderer and theme
  settings;
- `application/` — router views and their shared frontend modules/tests;
- `docs/` — interface screenshots;

It calls standard LuCI, rpcd and ubus APIs but does not own router ACLs,
package metadata, privileged helpers or deployment. Those belong in `app/`.
This is a LuCI component rather than a standalone SPA.

Run its checks from the repository root:

```sh
make check-static
```
