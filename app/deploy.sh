#!/bin/sh
# Deploy both Freenetic LuCI components to the test router and bust caches.
set -e

ROUTER="root@192.168.1.1"
SSH_CMD="${FREENETIC_SSH_CMD:-ssh}"
APP_DIR="$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)"
PROJECT_DIR="$(dirname "$APP_DIR")"
THEME_PACKAGE_DIR="$APP_DIR/luci-theme-freenetic"
APPLICATION_PACKAGE_DIR="$APP_DIR/luci-app-freenetic"
THEME_WEB_DIR="$PROJECT_DIR/web/theme"
APPLICATION_WEB_DIR="$PROJECT_DIR/web/application"

# Both the /tmp staging dir and the on-router destination dirs are wiped
# before every extract/copy — tar and cp only ever add/overwrite, so a file
# renamed or deleted locally (e.g. swapping which font ships) would otherwise
# survive forever on the router across deploys.
# The Applications page shells out to package-manager-call, which ships
# in luci-app-package-manager (declared as a real package dependency in
# app/luci-app-freenetic/Makefile). deploy.sh bypasses the package install
# path, so it has to ensure the dependency itself; skip if already installed.
$SSH_CMD "$ROUTER" 'apk info -e luci-app-package-manager >/dev/null 2>&1 || apk add luci-app-package-manager'

$SSH_CMD "$ROUTER" 'rm -rf /tmp/freenetic-pkg && mkdir -p /tmp/freenetic-pkg'
tar czf - -C "$THEME_WEB_DIR" htdocs ucode \
	-C "$APPLICATION_WEB_DIR" htdocs \
	-C "$THEME_PACKAGE_DIR" root \
	-C "$APPLICATION_PACKAGE_DIR" root | \
	$SSH_CMD "$ROUTER" 'tar xzf - -C /tmp/freenetic-pkg'
$SSH_CMD "$ROUTER" '
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
    # Seed the Freenetic UCI settings once; never overwrite the selected
    # release channel on subsequent development deployments.
    if [ ! -f /etc/config/freenetic ] && [ -f /tmp/freenetic-pkg/root/etc/config/freenetic ]; then
        mkdir -p /etc/config
        cp /tmp/freenetic-pkg/root/etc/config/freenetic /etc/config/freenetic
    fi
    mkdir -p /usr/share/luci/menu.d /usr/share/rpcd/acl.d /usr/libexec
    # Remove the menu filename used by the former monolithic theme package.
    rm -f /usr/share/luci/menu.d/luci-theme-freenetic.json
    cp /tmp/freenetic-pkg/root/usr/share/luci/menu.d/*.json /usr/share/luci/menu.d/
    cp /tmp/freenetic-pkg/root/usr/share/rpcd/acl.d/*.json /usr/share/rpcd/acl.d/
    cp /tmp/freenetic-pkg/root/usr/libexec/freenetic-* /usr/libexec/
    chmod +x /usr/libexec/freenetic-*
    mkdir -p /www/cgi-bin
    cp /tmp/freenetic-pkg/root/www/cgi-bin/freenetic-events /www/cgi-bin/freenetic-events
    chmod +x /www/cgi-bin/freenetic-events
    /etc/init.d/rpcd reload
    rm -f /tmp/luci-indexcache*
    rm -rf /tmp/luci-modulecache
    # Theme files live outside /etc, so a plain sysupgrade (which only keeps
    # /etc plus whatever this lists) would wipe them — keep this list synced
    # with everything deploy.sh installs above.
    touch /etc/sysupgrade.conf
    for p in /www/luci-static/freenetic /usr/share/ucode/luci/template/themes/freenetic \
             /www/luci-static/resources/freenetic-diagnostics.js \
             /www/luci-static/resources/freenetic-network.js \
             /www/luci-static/resources/freenetic-qrcode.js \
             /www/luci-static/resources/freenetic-rpc.js \
             /www/luci-static/resources/freenetic-ui.js \
             /www/luci-static/resources/freenetic-view-guard.js \
             /www/luci-static/resources/menu-freenetic.js \
             /www/luci-static/resources/freenetic-navigation.js \
             /www/luci-static/resources/settings-freenetic.js \
             /www/luci-static/resources/view/network/freenetic-firewall.js \
             /www/luci-static/resources/view/network/freenetic-mynetworks.js \
             /www/luci-static/resources/view/network/freenetic-portforward.js \
             /www/luci-static/resources/view/network/freenetic-routing.js \
             /www/luci-static/resources/view/network/freenetic-wan.js \
             /www/luci-static/resources/view/status/freenetic-clients.js \
             /www/luci-static/resources/view/status/freenetic-dashboard.js \
             /www/luci-static/resources/view/status/freenetic-traffic.js \
             /www/luci-static/resources/view/status/freenetic-wifimonitor.js \
             /www/luci-static/resources/view/system/freenetic-apps.js \
             /www/luci-static/resources/view/system/freenetic-diagnostics.js \
             /www/luci-static/resources/view/system/freenetic-system.js \
             /www/cgi-bin/freenetic-events \
             /usr/share/luci/menu.d/zz-luci-freenetic.json \
             /usr/share/rpcd/acl.d/luci-theme-freenetic.json \
             /usr/share/rpcd/acl.d/luci-app-freenetic.json \
             /usr/libexec/freenetic-backup-call /usr/libexec/freenetic-clear-luci-cache \
             /usr/libexec/freenetic-diagnostics-call; do
        grep -qxF "$p" /etc/sysupgrade.conf || echo "$p" >> /etc/sysupgrade.conf
    done
'
echo "Deployed. Hard-refresh the LuCI page (Ctrl+Shift+R)."
