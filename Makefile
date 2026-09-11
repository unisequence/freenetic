OPENWRT_DIR ?= $(abspath ../openwrt-upstream)
DL_DIR ?= $(OPENWRT_DIR)/dl
APP_DIR := app
WEB_DIR := web
THEME_PACKAGE_DIR := $(APP_DIR)/luci-theme-freenetic
APPLICATION_PACKAGE_DIR := $(APP_DIR)/luci-app-freenetic
THEME_WEB_DIR := $(WEB_DIR)/theme
APPLICATION_WEB_DIR := $(WEB_DIR)/application
FREENETIC_PRIMARY_PACKAGE_ARCH ?= $(shell sed -n 's/^CONFIG_TARGET_ARCH_PACKAGES="\([^"]*\)"/\1/p' "$(OPENWRT_DIR)/.config")
FREENETIC_MT7621_PACKAGE_ARCH := mipsel_24kc
FREENETIC_PRIMARY_PACKAGE_DIR := $(OPENWRT_DIR)/bin/packages/$(FREENETIC_PRIMARY_PACKAGE_ARCH)/base
FREENETIC_MT7621_PACKAGE_DIR := $(OPENWRT_DIR)/bin/packages/$(FREENETIC_MT7621_PACKAGE_ARCH)/base
FREENETIC_RELEASE_PACKAGES := luci-theme-freenetic luci-app-freenetic luci-i18n-theme-freenetic-ru luci-i18n-freenetic-ru
FREENETIC_APK_SIGN_ARG := $(if $(wildcard $(OPENWRT_DIR)/private-key.pem),--sign $(OPENWRT_DIR)/private-key.pem,)

.PHONY: check check-static check-layout check-js check-shell check-json check-tests check-cli check-cli-mt7621 check-package check-release-tree check-package-index stage-mt7621-packages release

check: check-static check-cli check-cli-mt7621

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

check-cli-mt7621:
	@if test -n "$$(find "$(OPENWRT_DIR)/staging_dir" -maxdepth 1 -type d -name 'toolchain-mipsel_24kc_gcc-*_musl' -print -quit 2>/dev/null)" && test -d "$(OPENWRT_DIR)/staging_dir/target-mipsel_24kc_musl"; then \
		$(MAKE) -C cli OPENWRT_DIR="$(OPENWRT_DIR)" FREENETIC_TARGET=mt7621 -B; \
	else \
		echo "MT7621 CLI cross-check: skipped (mipsel toolchain is not present)"; \
	fi

check-package:
	@test -f "$(OPENWRT_DIR)/rules.mk" || { \
		echo "OPENWRT_DIR does not point to an OpenWrt buildroot: $(OPENWRT_DIR)" >&2; \
		exit 1; \
	}
	@$(MAKE) -C "$(OPENWRT_DIR)" DL_DIR="$(DL_DIR)" \
		CONFIG_PACKAGE_luci-theme-freenetic=m CONFIG_PACKAGE_luci-app-freenetic=m \
		CONFIG_PACKAGE_luci-i18n-theme-freenetic-ru=m CONFIG_PACKAGE_luci-i18n-freenetic-ru=m \
		package/luci-theme-freenetic/compile package/luci-app-freenetic/compile

# The LuCI packages are noarch, but OpenWrt keeps repository indexes under the
# target ABI directory. Mirror the four Freenetic APKs into the MT7621 feed so
# a mipsel router can use its normal package repository path as well.
stage-mt7621-packages:
	@test -n "$(FREENETIC_PRIMARY_PACKAGE_ARCH)" || { \
		echo "Cannot determine the primary OpenWrt package architecture." >&2; \
		exit 1; \
	}
	@test -x "$(OPENWRT_DIR)/staging_dir/host/bin/apk" || { \
		echo "OpenWrt host apk tool is missing: $(OPENWRT_DIR)/staging_dir/host/bin/apk" >&2; \
		exit 1; \
	}
	@mkdir -p "$(FREENETIC_MT7621_PACKAGE_DIR)"
	@for package in $(FREENETIC_RELEASE_PACKAGES); do \
		find "$(FREENETIC_MT7621_PACKAGE_DIR)" -maxdepth 1 -type f -name "$$package-*.apk" -delete; \
		archive="$$(find "$(FREENETIC_PRIMARY_PACKAGE_DIR)" -maxdepth 1 -type f -name "$$package-*.apk" -print 2>/dev/null | sort -V | tail -n 1)"; \
		test -n "$$archive" || { echo "Missing primary APK for $$package" >&2; exit 1; }; \
		cp -f "$$archive" "$(FREENETIC_MT7621_PACKAGE_DIR)/"; \
	done
	@cd "$(FREENETIC_MT7621_PACKAGE_DIR)" && \
		"$(OPENWRT_DIR)/staging_dir/host/bin/apk" mkndx \
			--root "$(OPENWRT_DIR)" --keys-dir "$(OPENWRT_DIR)" --allow-untrusted \
			$(FREENETIC_APK_SIGN_ARG) --output packages.adb *.apk && \
		"$(OPENWRT_DIR)/staging_dir/host/bin/apk" adbdump --format json packages.adb | \
		"$(OPENWRT_DIR)/scripts/make-index-json.py" -f apk -a "$(FREENETIC_MT7621_PACKAGE_ARCH)" - > index.json
	@echo "MT7621 package index: $(FREENETIC_MT7621_PACKAGE_DIR)/index.json"

# Releasing a locally compiled APK from an uncommitted tree produces an APK
# whose version points at an older commit. Refuse that ambiguous state before
# a package index is regenerated or published.
check-release-tree:
	@if test -n "$$(git status --porcelain --untracked-files=all)"; then \
		echo "Release check failed: Git worktree is not clean." >&2; \
		git status --short >&2; \
		exit 1; \
	fi
	@echo "Release worktree: clean"

# Check that every Freenetic entry advertised by every local APK index still
# has its matching archive next to that index. This catches stale index.json
# files after a package rebuild or cleanup.
check-package-index:
	@node "$(APP_DIR)/check-release.js" "$(OPENWRT_DIR)/bin"

# This deliberately builds the package index only after the source tree has
# passed the clean-tree gate. It stays local; publishing remains explicit.
release: check-release-tree check-package
	@$(MAKE) -C "$(OPENWRT_DIR)" DL_DIR="$(DL_DIR)" package/index
	@$(MAKE) stage-mt7621-packages OPENWRT_DIR="$(OPENWRT_DIR)" DL_DIR="$(DL_DIR)"
	@$(MAKE) check-package-index OPENWRT_DIR="$(OPENWRT_DIR)" DL_DIR="$(DL_DIR)"
