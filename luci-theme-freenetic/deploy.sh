#!/bin/sh
# Deploy the Freenetic theme to the test router and bust LuCI's caches.
set -e

ROUTER="root@192.168.1.1"
cd "$(dirname "$0")"

# Both the /tmp staging dir and the on-router destination dirs are wiped
# before every extract/copy — tar and cp only ever add/overwrite, so a file
# renamed or deleted locally (e.g. swapping which font ships) would otherwise
# survive forever on the router across deploys.
# The Applications page shells out to package-manager-call, which ships
# in luci-app-package-manager (declared as a real package dependency in
# Makefile — this only matters for the opkg/apk install path). deploy.sh
# bypasses that entirely by copying files over SSH, so it has to ensure
# the dependency itself; skip if already installed.
ssh "$ROUTER" 'apk info -e luci-app-package-manager >/dev/null 2>&1 || apk add luci-app-package-manager'

ssh "$ROUTER" 'rm -rf /tmp/freenetic-pkg && mkdir -p /tmp/freenetic-pkg'
tar czf - htdocs root ucode | ssh "$ROUTER" 'tar xzf - -C /tmp/freenetic-pkg'
ssh "$ROUTER" '
    rm -rf /www/luci-static/freenetic
    mkdir -p /www/luci-static/freenetic /www/luci-static/resources
    cp -r /tmp/freenetic-pkg/htdocs/luci-static/freenetic/. /www/luci-static/freenetic/
    # resources/ is shared with other LuCI packages, so it cannot be wiped
    # wholesale like freenetic/ above — a file renamed/removed under
    # view/{network,status,system}/freenetic-*.js or *-freenetic.js here
    # will still leak a stale copy on the router until deleted by hand.
    cp -r /tmp/freenetic-pkg/htdocs/luci-static/resources/. /www/luci-static/resources/
    mkdir -p /usr/share/ucode/luci/template/themes/freenetic
    cp /tmp/freenetic-pkg/ucode/template/themes/freenetic/*.ut /usr/share/ucode/luci/template/themes/freenetic/
    mkdir -p /usr/share/luci/menu.d /usr/share/rpcd/acl.d /usr/libexec
    cp /tmp/freenetic-pkg/root/usr/share/luci/menu.d/*.json /usr/share/luci/menu.d/
    cp /tmp/freenetic-pkg/root/usr/share/rpcd/acl.d/*.json /usr/share/rpcd/acl.d/
    cp /tmp/freenetic-pkg/root/usr/libexec/freenetic-* /usr/libexec/
    chmod +x /usr/libexec/freenetic-*
    /etc/init.d/rpcd reload
    rm -f /tmp/luci-indexcache*
    rm -rf /tmp/luci-modulecache
    # Theme files live outside /etc, so a plain sysupgrade (which only keeps
    # /etc plus whatever this lists) would wipe them — keep this list synced
    # with everything deploy.sh installs above.
    touch /etc/sysupgrade.conf
    for p in /www/luci-static/freenetic /usr/share/ucode/luci/template/themes/freenetic \
             /usr/share/luci/menu.d/luci-theme-freenetic.json /usr/share/rpcd/acl.d/luci-theme-freenetic.json \
             /usr/libexec/freenetic-backup-call /usr/libexec/freenetic-clear-luci-cache; do
        grep -qxF "$p" /etc/sysupgrade.conf || echo "$p" >> /etc/sysupgrade.conf
    done
'
echo "Deployed. Hard-refresh the LuCI page (Ctrl+Shift+R)."
