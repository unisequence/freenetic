#
# Copyright (C) 2026 Freenetic contributors
#
# This is free software, licensed under the Apache License, Version 2.0 .
#

include $(TOPDIR)/rules.mk

LUCI_TITLE:=Freenetic Web Interface
LUCI_DESCRIPTION:=Freenetic dashboard and router management views
LUCI_DEPENDS:=+luci-base +luci-theme-freenetic +luci-app-package-manager

PKG_LICENSE:=Apache-2.0

# Include both the package and application web sources when deriving the
# version. The legacy path keeps development builds versioned before the
# directory split is committed.
FREENETIC_ROOT:=$(abspath $(CURDIR)/../..)
PKG_SRC_VERSION:=$(if $(DUMP),x,$(strip $(shell \
	set -- $$(git -C "$(FREENETIC_ROOT)" log -1 --format="%ct %h" -- app/luci-app-freenetic web/application luci-theme-freenetic 2>/dev/null); \
	if [ -n "$$1" ]; then \
		secs="$$(($$1 % 86400))"; \
		yday="$$(date --utc --date="@$$1" "+%y.%j")"; \
		printf '%s.%05d~%s' "$$yday" "$$secs" "$$2"; \
	else \
		echo 0; \
	fi)))

# Keep browser sources readable and preserve CSS cascade layers.
LUCI_MINIFY_CSS:=0
LUCI_MINIFY_JS:=0

include $(TOPDIR)/feeds/luci/luci.mk

# htdocs is an intentional link to web/application.
# call BuildPackage - OpenWrt buildroot scanner signature
