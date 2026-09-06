OPENWRT_DIR ?= $(abspath ../openwrt-upstream)
DL_DIR ?= $(OPENWRT_DIR)/dl
APP_DIR := app
WEB_DIR := web
THEME_PACKAGE_DIR := $(APP_DIR)/luci-theme-freenetic
APPLICATION_PACKAGE_DIR := $(APP_DIR)/luci-app-freenetic
THEME_WEB_DIR := $(WEB_DIR)/theme
APPLICATION_WEB_DIR := $(WEB_DIR)/application

.PHONY: check check-static check-layout check-js check-shell check-json check-tests check-cli check-package

check: check-static check-cli

check-static: check-layout check-js check-shell check-json check-tests

check-layout:
	@test -d "$(THEME_PACKAGE_DIR)/root" -a -d "$(THEME_WEB_DIR)/htdocs" -a -d "$(THEME_WEB_DIR)/ucode"
	@test -d "$(APPLICATION_PACKAGE_DIR)/root" -a -d "$(APPLICATION_WEB_DIR)/htdocs"
	@test "$$(readlink "$(THEME_PACKAGE_DIR)/htdocs")" = "../../web/theme/htdocs"
	@test "$$(readlink "$(THEME_PACKAGE_DIR)/ucode")" = "../../web/theme/ucode"
	@test "$$(readlink "$(APPLICATION_PACKAGE_DIR)/htdocs")" = "../../web/application/htdocs"
	@echo "Component layout: ok"

check-js:
	@find "$(THEME_WEB_DIR)/htdocs" "$(APPLICATION_WEB_DIR)/htdocs" -type f -name '*.js' -print0 | \
		xargs -0 -r -n1 node --check
	@echo "JavaScript syntax: ok"

check-shell:
	@find "$(APP_DIR)" -type f \
		\( -name '*.sh' -o -path '*/root/etc/uci-defaults/*' -o -path '*/root/usr/libexec/*' \) \
		-print0 | xargs -0 -r -n1 sh -n
	@echo "Shell syntax: ok"

check-json:
	@find "$(APP_DIR)" "$(WEB_DIR)" -type f -name '*.json' -print0 | \
		xargs -0 -r -n1 jq -e . >/dev/null
	@echo "JSON syntax: ok"

check-tests:
	@find "$(APP_DIR)/tests" "$(APPLICATION_WEB_DIR)/tests" -type f -name '*.test.js' -print0 | \
		sort -z | xargs -0 -r -n1 node

check-cli:
	@test -f "$(OPENWRT_DIR)/rules.mk" || { \
		echo "OPENWRT_DIR does not point to an OpenWrt buildroot: $(OPENWRT_DIR)" >&2; \
		exit 1; \
	}
	@$(MAKE) -C cli OPENWRT_DIR="$(OPENWRT_DIR)" -B

check-package:
	@test -f "$(OPENWRT_DIR)/rules.mk" || { \
		echo "OPENWRT_DIR does not point to an OpenWrt buildroot: $(OPENWRT_DIR)" >&2; \
		exit 1; \
	}
	@$(MAKE) -C "$(OPENWRT_DIR)" DL_DIR="$(DL_DIR)" \
		CONFIG_PACKAGE_luci-theme-freenetic=m CONFIG_PACKAGE_luci-app-freenetic=m \
		package/luci-theme-freenetic/compile package/luci-app-freenetic/compile
