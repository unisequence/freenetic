#
# Copyright (C) 2026 Freenetic contributors
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

LUCI_NAME:=luci-theme-freenetic
LUCI_BASENAME:=theme-freenetic
LUCI_TITLE:=Freenetic Theme
LUCI_DESCRIPTION:=Freenetic visual shell for LuCI
LUCI_DEPENDS:=+luci-base

PKG_LICENSE:=Apache-2.0

# Include the package, shared preflight and theme web sources when deriving
# the version.
FREENETIC_ROOT:=$(abspath $(CURDIR)/../..)
include $(FREENETIC_ROOT)/app/freenetic-preflight.mk
PKG_SRC_VERSION:=$(if $(DUMP),x,$(strip $(shell \
	set -- $$(git -C "$(FREENETIC_ROOT)" log -1 --format="%ct %h" -- app/luci-theme-freenetic app/freenetic-preflight.mk web/theme luci-theme-freenetic 2>/dev/null); \
	if [ -n "$$1" ]; then \
		secs="$$(($$1 % 86400))"; \
		yday="$$(date --utc --date="@$$1" "+%y.%j")"; \
		printf '%s.%05d~%s' "$$yday" "$$secs" "$$2"; \
	else \
		echo 0; \
	fi)))

# Keep the translation APK on the same revision as the theme APK.  LuCI's
# default PO revision only changes when a catalog is edited, which would let a
# release contain two different asset versions after a CSS-only fix.
PKG_PO_VERSION:=$(PKG_SRC_VERSION)

# csstidy predates CSS Cascade Layers (@layer) and silently strips them
LUCI_MINIFY_CSS:=0
LUCI_MINIFY_JS:=0

define Package/luci-theme-freenetic/preinst
$(FREENETIC_PACKAGE_PREINST)
endef

define Package/luci-theme-freenetic/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	uci -q delete luci.themes.Freenetic
	uci commit luci
}
endef

include $(TOPDIR)/feeds/luci/luci.mk

# htdocs and ucode are intentional links to web/theme. This lets the stock
# LuCI packaging logic assemble a theme-only luci-theme-freenetic APK.
# call BuildPackage - OpenWrt buildroot scanner signature
