# Security policy

## Supported versions

Security fixes are developed on the active release branch and are published
only after the complete verification matrix passes. The current stable source
release is `v0.4.2`; its release matrix covers OpenWrt 24.10.8 (IPK/`opkg`)
and 25.12.5 (APK/`apk`) on Filogic, MT7621 and x86/64. Consult the release
assets and `COMPATIBILITY.md` for the tested scope of each device. Older
releases may be useful for reproducing a problem, but should be upgraded
before deployment.

Alpha releases are intended for test routers with a recovery path. They do
not become production-supported merely because their build matrix is green.

## Reporting a vulnerability

Please use GitHub's private vulnerability reporting for this repository. Do
not put credentials, private keys, configuration backups or an exploitable
proof of concept in a public issue.

Include, when safe to share:

- the Freenetic release and OpenWrt version;
- target/subtarget and device model;
- the affected page, helper or command;
- a minimal reproduction with secrets removed;
- whether the issue survives a fresh install or only an upgrade.

The most important reports are arbitrary command execution, ACL escalation,
secret disclosure, unsafe firmware/package update behavior, and destructive
changes to UCI sections that Freenetic did not create.

We will acknowledge a private report as soon as practical, reproduce it on a
supported profile, and coordinate a fix and release before public disclosure.

## Security boundaries

Freenetic is a LuCI layer over OpenWrt. The browser is untrusted input; the
rpcd ACL and small fixed-argv helpers are the privileged boundary. Freenetic
does not sit in the packet datapath, and removing its UI packages must not be
treated as a way to remove or reset the router's native network
configuration.

When in doubt, the safe behavior is to preserve an unknown UCI section or
option and report that the compact Freenetic form does not understand it.

## Package trust and key rotation

Freenetic release APKs are verified with the release key whose digest is
pinned in the generated installer. Release assets also receive GitHub/Sigstore
provenance. IPK payloads remain protected by installer-pinned SHA-256 hashes.

The optional AmneziaWG feed has a separate trust anchor bundled under
`/usr/share/freenetic/keys/`. The privileged feed helper imports only those
package-owned bytes; it never bootstraps a public key from the feed origin.
Changing either bundled key requires an explicit source review, verification
against the upstream maintainer's GitHub-controlled publication and an
independent fingerprint confirmation. The new bytes and SHA-256 regression
pins must land in a reviewed Freenetic release before the feed starts using
the rotated key. A runtime download must never be used as key rotation.
