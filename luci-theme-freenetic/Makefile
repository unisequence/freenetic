#
# Copyright (C) 2026 Freenetic contributors
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=Freenetic Theme
LUCI_DEPENDS:=+luci-base +luci-app-package-manager

PKG_LICENSE:=Apache-2.0

# csstidy predates CSS Cascade Layers (@layer) and silently strips them
LUCI_MINIFY_CSS:=0
LUCI_MINIFY_JS:=0

define Package/luci-theme-freenetic/postrm
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] || {
	uci -q delete luci.themes.Freenetic
	uci commit luci
}
endef

include $(TOPDIR)/feeds/luci/luci.mk

# call BuildPackage - OpenWrt buildroot signature
