#
# Copyright (C) 2026 Freenetic contributors
#
# Freenetic packaging for the official Zapret2 OpenWrt embedded runtime.
# The runtime remains disabled after installation; configuration and service
# activation are deliberately kept separate from package installation rather
# than delegated to an interactive upstream installer.
#

include $(TOPDIR)/rules.mk

PKG_NAME:=freenetic-zapret2
PKG_VERSION:=1.0.5.2
PKG_RELEASE:=5

PKG_SOURCE:=zapret2-v$(PKG_VERSION).tar.gz
PKG_SOURCE_URL:=https://github.com/bol-van/zapret2/releases/download/v$(PKG_VERSION)
PKG_HASH:=fb3bcf69e7d86b9fa2d60bd53c956ac06d9dcc3adf9392afd84865f1d94b1158
PKG_BUILD_DIR:=$(BUILD_DIR)/zapret2-v$(PKG_VERSION)

PKG_MAINTAINER:=Freenetic contributors
PKG_LICENSE:=MIT
PKG_LICENSE_FILES:=docs/LICENSE.txt

include $(INCLUDE_DIR)/package.mk

ZAPRET2_BIN_ARCH_aarch64:=linux-arm64
ZAPRET2_BIN_ARCH_arm:=linux-arm
ZAPRET2_BIN_ARCH_mipsel:=linux-mipsel
ZAPRET2_BIN_ARCH_mips:=linux-mips
ZAPRET2_BIN_ARCH_x86_64:=linux-x86_64
ZAPRET2_BIN_ARCH_i386:=linux-x86
ZAPRET2_BIN_ARCH_i486:=linux-x86
ZAPRET2_BIN_ARCH_i586:=linux-x86
ZAPRET2_BIN_ARCH_i686:=linux-x86
ZAPRET2_BIN_ARCH_powerpc:=linux-ppc
ZAPRET2_BIN_ARCH_riscv64:=linux-riscv64
ZAPRET2_BIN_ARCH:=$(ZAPRET2_BIN_ARCH_$(ARCH))

define Package/freenetic-zapret2
	SECTION:=net
	CATEGORY:=Network
	SUBMENU:=Web Servers/Proxies
	TITLE:=Zapret2 (NFQWS2) runtime for Freenetic
	URL:=https://github.com/bol-van/zapret2
	DEPENDS:=+firewall4 +nftables +kmod-nfnetlink-queue +kmod-nft-nat \
		+kmod-nft-offload +kmod-nft-queue +rpcd +ucode +curl
	PROVIDES:=nfqws2
	CONFLICTS:=zapret2
endef

define Package/freenetic-zapret2/description
 Official Zapret2 programmable DPI-bypass engine with an MIT-licensed native
 OpenWrt control plane adapted for Freenetic. The runtime is installed disabled
 and does not change firewall rules until explicitly enabled.
endef

define Build/Compile
endef

define Package/freenetic-zapret2/conffiles
/opt/zapret2/config
/opt/zapret2/ipset/zapret-hosts-user.txt
/opt/zapret2/ipset/zapret-hosts-user-exclude.txt
/opt/zapret2/ipset/zapret-hosts-user-ipban.txt
/etc/config/zapret2
endef

define Package/freenetic-zapret2/postinst
#!/bin/sh
mkdir -p "$${IPKG_INSTROOT}/etc/zapret2/lists" "$${IPKG_INSTROOT}/etc/zapret2/autohostlists" "$${IPKG_INSTROOT}/etc/zapret2/legacy"
chown 0:1 "$${IPKG_INSTROOT}/etc/zapret2/lists" "$${IPKG_INSTROOT}/etc/zapret2/autohostlists"
chmod 0750 "$${IPKG_INSTROOT}/etc/zapret2/lists" "$${IPKG_INSTROOT}/etc/zapret2/autohostlists"
chmod 0700 "$${IPKG_INSTROOT}/etc/zapret2/legacy"
[ -n "$${IPKG_INSTROOT}" ] || {
	[ "$$(uci -q get zapret2.main.schema_version)" = 2 ] || /usr/libexec/zapret2-init
	# v0.4.0 stored a Freenetic marker in the strict Zapret2 schema and
	# selected marked interception without any include mark. Either setting
	# prevents the freshly installed service from starting. Migrate only
	# configurations carrying that old marker; preserve custom marked rules.
	if [ "$$(uci -q get zapret2.main.freenetic_managed)" = 1 ]; then
		uci -q delete zapret2.main.freenetic_managed || exit 1
		if [ "$$(uci -q get zapret2.main.intercept_mode)" = marked ] && \
		   [ -z "$$(uci -q get zapret2.main.include_mark)" ]; then
			uci -q set zapret2.main.intercept_mode=all || exit 1
		fi
		uci -q commit zapret2 || exit 1
	fi
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
}
endef

define Package/freenetic-zapret2/install
	test -n "$(ZAPRET2_BIN_ARCH)" || { echo "Unsupported Zapret2 architecture: $(ARCH)" >&2; exit 1; }
	test -x "$(PKG_BUILD_DIR)/binaries/$(ZAPRET2_BIN_ARCH)/nfqws2"
	grep -qx 'NFQWS2_ENABLE=0' "$(PKG_BUILD_DIR)/config.default"

	$(INSTALL_DIR) $(1)/opt/zapret2
	$(CP) $(PKG_BUILD_DIR)/common $(1)/opt/zapret2/
	$(CP) $(PKG_BUILD_DIR)/ipset $(1)/opt/zapret2/
	$(CP) $(PKG_BUILD_DIR)/blockcheck2.d $(1)/opt/zapret2/
	$(CP) $(PKG_BUILD_DIR)/lua $(1)/opt/zapret2/
	$(INSTALL_DIR) $(1)/opt/zapret2/files
	$(CP) $(PKG_BUILD_DIR)/files/fake $(1)/opt/zapret2/files/
	$(INSTALL_DIR) $(1)/opt/zapret2/init.d
	$(CP) $(PKG_BUILD_DIR)/init.d/openwrt $(1)/opt/zapret2/init.d/
	$(CP) $(PKG_BUILD_DIR)/init.d/custom.d.examples.linux $(1)/opt/zapret2/init.d/

	$(INSTALL_BIN) $(PKG_BUILD_DIR)/blockcheck2.sh $(1)/opt/zapret2/blockcheck2.sh
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/config.default $(1)/opt/zapret2/config.default
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/config.default $(1)/opt/zapret2/config

	$(INSTALL_DIR) $(1)/opt/zapret2/nfq2 $(1)/opt/zapret2/ip2net $(1)/opt/zapret2/mdig
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/binaries/$(ZAPRET2_BIN_ARCH)/nfqws2 $(1)/opt/zapret2/nfq2/nfqws2
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/binaries/$(ZAPRET2_BIN_ARCH)/ip2net $(1)/opt/zapret2/ip2net/ip2net
	$(INSTALL_BIN) $(PKG_BUILD_DIR)/binaries/$(ZAPRET2_BIN_ARCH)/mdig $(1)/opt/zapret2/mdig/mdig

	$(INSTALL_DIR) $(1)/opt/zapret2/docs $(1)/opt/zapret2/tmp
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/docs/LICENSE.txt $(1)/opt/zapret2/docs/LICENSE.txt
	cp $(PKG_BUILD_DIR)/ipset/zapret-hosts-user-exclude.txt.default \
		$(1)/opt/zapret2/ipset/zapret-hosts-user-exclude.txt
	printf '%s\n' 'nonexistent.domain' >$(1)/opt/zapret2/ipset/zapret-hosts-user.txt
	: >$(1)/opt/zapret2/ipset/zapret-hosts-user-ipban.txt

	$(INSTALL_DIR) $(1)/usr/sbin $(1)/usr/share/zapret2/lua \
		$(1)/etc/config $(1)/etc/init.d $(1)/usr/libexec/zapret2 \
		$(1)/lib/upgrade/keep.d $(1)/usr/share/rpcd/ucode \
		$(1)/usr/share/rpcd/acl.d $(1)/usr/share/licenses/freenetic-zapret2
	$(LN) /opt/zapret2/nfq2/nfqws2 $(1)/usr/sbin/nfqws2
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/lua/zapret-lib.lua $(1)/usr/share/zapret2/lua/
	$(INSTALL_DATA) $(PKG_BUILD_DIR)/lua/zapret-antidpi.lua $(1)/usr/share/zapret2/lua/
	$(INSTALL_DATA) ./files/etc/config/zapret2 $(1)/usr/share/zapret2/zapret2-v2-default
	$(INSTALL_CONF) ./files/etc/config/zapret2 $(1)/etc/config/zapret2
	$(INSTALL_BIN) ./files/etc/init.d/zapret2 $(1)/etc/init.d/zapret2
	$(INSTALL_BIN) ./files/usr/libexec/zapret2/compiler.sh $(1)/usr/libexec/zapret2/compiler.sh
	$(INSTALL_BIN) ./files/usr/libexec/zapret2/backend.uc $(1)/usr/libexec/zapret2/backend.uc
	$(INSTALL_BIN) ./files/usr/libexec/zapret2-init $(1)/usr/libexec/zapret2-init
	$(INSTALL_BIN) ./files/usr/libexec/zapret2-list $(1)/usr/libexec/zapret2-list
	$(INSTALL_DATA) ./files/usr/share/rpcd/ucode/zapret2.uc $(1)/usr/share/rpcd/ucode/zapret2.uc
	$(INSTALL_DATA) ./files/usr/share/rpcd/acl.d/zapret2.json $(1)/usr/share/rpcd/acl.d/zapret2.json
	$(INSTALL_DATA) ./files/lib/upgrade/keep.d/zapret2 $(1)/lib/upgrade/keep.d/zapret2
	$(INSTALL_DATA) ./files/usr/share/licenses/freenetic-zapret2/openwrt-integration.LICENSE \
		$(1)/usr/share/licenses/freenetic-zapret2/openwrt-integration.LICENSE
	$(INSTALL_DATA) ./files/usr/share/licenses/freenetic-zapret2/NOTICE \
		$(1)/usr/share/licenses/freenetic-zapret2/NOTICE
endef

$(eval $(call BuildPackage,freenetic-zapret2))
