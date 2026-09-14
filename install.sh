#!/bin/sh
# Freenetic one-shot installer for supported OpenWrt routers.
#
# Usage:
#   wget -qO- 'https://github.com/unisequence/freenetic/releases/download/v0.2.6/install.sh' | sh
#
# The release and checksums are deliberately pinned. Do not install a
# partially downloaded or silently replaced package.
set -eu

RELEASE_TAG="v0.2.6"
# GitHub normalizes the '~' in the OpenWrt-derived package version to '.'.
ASSET_VERSION="26.257.59466.50b41ff"
RELEASE_BASE_URL="${FREENETIC_RELEASE_BASE_URL:-https://github.com/unisequence/freenetic/releases/download/$RELEASE_TAG}"

MIN_RAM_MIB=128
MIN_CPU_CORES=2
MIN_OVERLAY_MIB_FILOGIC=32
MIN_OVERLAY_MIB_MT7621=16

fail() {
	echo "Freenetic installer: FAIL: $*" >&2
	exit 1
}

info() {
	echo "Freenetic installer: $*"
}

stage() {
	info "stage: $1"
}

cleanup() {
	[ -z "${FNC_STAGED:-}" ] || rm -f "$FNC_STAGED"
	[ -z "${FNC_STAGED_DIR:-}" ] || rm -rf "$FNC_STAGED_DIR"
	[ -z "${TMP_DIR:-}" ] || rm -rf "$TMP_DIR"
}

trap cleanup EXIT INT TERM

stage preflight
for command_name in awk df grep jsonfilter sha256sum ubus uci uname wget; do
	command -v "$command_name" >/dev/null 2>&1 ||
		fail "required command is missing: $command_name"
done

if command -v apk >/dev/null 2>&1; then
	package_manager=apk
elif command -v opkg >/dev/null 2>&1; then
	package_manager=opkg
else
	fail "neither apk nor opkg is installed"
fi

TMP_DIR="${TMPDIR:-/tmp}/freenetic-install.$$"
mkdir "$TMP_DIR" 2>/dev/null || fail "cannot create temporary directory"

board_json="$(ubus call system board 2>/dev/null)" ||
	fail "cannot read system board information"
target="$(printf '%s\n' "$board_json" | jsonfilter -e '@.release.target' 2>/dev/null || true)"
model="$(printf '%s\n' "$board_json" | jsonfilter -e '@.model' 2>/dev/null || true)"
[ -n "$model" ] || model="unknown"

release_arch=""
if [ -r /etc/openwrt_release ]; then
	# shellcheck disable=SC1091
	. /etc/openwrt_release
	release_arch="${DISTRIB_ARCH:-}"
fi
machine="$(uname -m 2>/dev/null || true)"

case "$target" in
	mediatek/filogic)
		target_suffix="aarch64_cortex-a53"
		min_overlay_mib="$MIN_OVERLAY_MIB_FILOGIC"
		fnc_sha256_apk="569c07f3523193f646f182f2a09459feda5946c5bc0d9fecf3432a0361481ddb"
		fnc_sha256_ipk="fc22251fdeb9f4d725e87919ca6b3eb06947b28e735a966a3a10459b77a57106"
		fnc_ubus_lib_apk="libubus.so.20251202"
		fnc_ubox_lib_apk="libubox.so.20260213"
		fnc_blobmsg_lib_apk="libblobmsg_json.so.20260213"
		fnc_ubus_lib_ipk="libubus.so.20250102"
		fnc_ubox_lib_ipk="libubox.so.20240329"
		fnc_blobmsg_lib_ipk="libblobmsg_json.so.20240329"
		fnc_uci_lib="libuci.so.20250120"
		fnc_jsonc_lib="libjson-c.so.5"
		case "$machine" in
			aarch64) ;;
			*) fail "$model reports $target but uname -m is $machine, expected aarch64" ;;
		esac
		case "$release_arch" in
			''|aarch64*) ;;
			*) fail "$model reports $target but DISTRIB_ARCH is $release_arch" ;;
		esac
		;;
	ramips/mt7621)
		target_suffix="mipsel_24kc"
		min_overlay_mib="$MIN_OVERLAY_MIB_MT7621"
		fnc_sha256_apk="9ec794c35c078ec56346492e7c7a51aff0ef654c52324fd24a5919773894c515"
		fnc_sha256_ipk="694db49b76061c2cca0a8c4b9ff3d9fc638bfea4ee1d5a48c9f29e06936a1470"
		fnc_ubus_lib_apk="libubus.so.20251202"
		fnc_ubox_lib_apk="libubox.so.20260213"
		fnc_blobmsg_lib_apk="libblobmsg_json.so.20260213"
		fnc_ubus_lib_ipk="libubus.so.20250102"
		fnc_ubox_lib_ipk="libubox.so.20240329"
		fnc_blobmsg_lib_ipk="libblobmsg_json.so.20240329"
		fnc_uci_lib="libuci.so.20250120"
		fnc_jsonc_lib="libjson-c.so.5"
		case "$machine" in
			mips|mipsel) ;;
			*) fail "$model reports $target but uname -m is $machine, expected mips/mipsel" ;;
		esac
		case "$release_arch" in
			''|mipsel*) ;;
			*) fail "$model reports $target but DISTRIB_ARCH is $release_arch" ;;
		esac
		;;
	*)
		fail "$model uses unsupported OpenWrt target ${target:-unknown}; supported targets are mediatek/filogic and ramips/mt7621"
		;;
esac

mem_kib="$(awk '$1 == "MemTotal:" { print $2; exit }' /proc/meminfo)"
case "$mem_kib" in
	''|*[!0-9]*) fail "cannot read total RAM" ;;
esac
ram_mib=$((mem_kib / 1024))
[ "$ram_mib" -ge "$MIN_RAM_MIB" ] ||
	fail "$model has ${ram_mib} MiB RAM; minimum is ${MIN_RAM_MIB} MiB"

cpu_cores="$(grep -c '^processor' /proc/cpuinfo 2>/dev/null || true)"
case "$cpu_cores" in
	''|*[!0-9]*) fail "cannot count CPU cores" ;;
esac
[ "$cpu_cores" -ge "$MIN_CPU_CORES" ] ||
	fail "$model has ${cpu_cores} CPU cores; minimum is ${MIN_CPU_CORES}"

overlay_path=/overlay
overlay_free_kib="$(df -Pk "$overlay_path" 2>/dev/null | awk 'NR == 2 { print $4; exit }' || true)"
if [ -z "$overlay_free_kib" ]; then
	overlay_path=/
	overlay_free_kib="$(df -Pk "$overlay_path" 2>/dev/null | awk 'NR == 2 { print $4; exit }' || true)"
fi
case "$overlay_free_kib" in
	''|*[!0-9]*) fail "cannot read free space on $overlay_path" ;;
esac
overlay_mib=$((overlay_free_kib / 1024))
[ "$overlay_mib" -ge "$min_overlay_mib" ] ||
	fail "$model has ${overlay_mib} MiB free on ${overlay_path}; minimum is ${min_overlay_mib} MiB"

info "preflight passed: $model, $target, ${release_arch:-$machine}, ${cpu_cores} cores, ${ram_mib} MiB RAM, ${overlay_mib} MiB free"

case "$package_manager" in
	apk)
		THEME_PACKAGE="luci-theme-freenetic-${ASSET_VERSION}-${target_suffix}.apk"
		APP_PACKAGE="luci-app-freenetic-${ASSET_VERSION}-${target_suffix}.apk"
		THEME_RU_PACKAGE="luci-i18n-theme-freenetic-ru-${ASSET_VERSION}-${target_suffix}.apk"
		APP_RU_PACKAGE="luci-i18n-freenetic-ru-${ASSET_VERSION}-${target_suffix}.apk"
		theme_sha256="331377c8865549a0c259025c8b0f7aa1913d3763e6707c67e58cfa6e9f95ecc0"
		app_sha256="24f13d0da73458e5029787e75dd36c6d7e3e220e14b87c57c61418a531bac53b"
		theme_ru_sha256="9fedb33b6f620b4ccdcc3e0ef6ef749d09b5c4841c1d6e11656a0ce515bb3c26"
		app_ru_sha256="8a1f81ff221f973e564225b35132aa214babe8115da6fb9779b6e9a5e41943f9"
		;;
	opkg)
		THEME_PACKAGE="luci-theme-freenetic-${ASSET_VERSION}-all.ipk"
		APP_PACKAGE="luci-app-freenetic-${ASSET_VERSION}-all.ipk"
		THEME_RU_PACKAGE="luci-i18n-theme-freenetic-ru-${ASSET_VERSION}-all.ipk"
		APP_RU_PACKAGE="luci-i18n-freenetic-ru-${ASSET_VERSION}-all.ipk"
		theme_sha256="93b5db053a00c8167659630f60c31928dd556048d7500ddc1db7efbcba805fd4"
		app_sha256="4ba40fbc78d68511750fd63f6e3b466103f7c80a7d3327dcfc1796819806db05"
		theme_ru_sha256="6704da887bf59b47b2d4958a103ec871619c24c74a340d33e98b69e07abaac7a"
		app_ru_sha256="578307ff146c2a8b5f734b22f9e1fb18cb428773aa4fa57c984071b4a66a752d"
		;;
esac

case "$package_manager" in
	apk)
		fnc_variant=apk
		fnc_sha256="$fnc_sha256_apk"
		fnc_ubus_lib="$fnc_ubus_lib_apk"
		fnc_ubox_lib="$fnc_ubox_lib_apk"
		fnc_blobmsg_lib="$fnc_blobmsg_lib_apk"
		;;
	opkg)
		fnc_variant=ipk
		fnc_sha256="$fnc_sha256_ipk"
		fnc_ubus_lib="$fnc_ubus_lib_ipk"
		fnc_ubox_lib="$fnc_ubox_lib_ipk"
		fnc_blobmsg_lib="$fnc_blobmsg_lib_ipk"
		;;
esac
FNC_BIN="fnc-${ASSET_VERSION}-${target_suffix}-${fnc_variant}"

download_checked() {
	asset_name="$1"
	expected_sha256="$2"
	destination="$TMP_DIR/$asset_name"

	info "downloading $asset_name"
	wget -qO "$destination" "$RELEASE_BASE_URL/$asset_name" ||
		fail "download failed: $asset_name"
	[ -s "$destination" ] || fail "downloaded asset is empty: $asset_name"

	stage package_verification
	actual_sha256="$(sha256sum "$destination" | awk '{ print $1 }')"
	[ "$actual_sha256" = "$expected_sha256" ] ||
		fail "SHA-256 mismatch for $asset_name"
}

# APKs are mirrored under each target feed name, while opkg uses the common
# all-architecture IPK built and tested on the OpenWrt 24.10.x line.
stage download
download_checked "$THEME_PACKAGE" "$theme_sha256"
download_checked "$APP_PACKAGE" "$app_sha256"
download_checked "$THEME_RU_PACKAGE" "$theme_ru_sha256"
download_checked "$APP_RU_PACKAGE" "$app_ru_sha256"
download_checked "$FNC_BIN" "$fnc_sha256"

stage package_install
info "installing LuCI packages"
if [ "$package_manager" = apk ]; then
	# Release APKs are built without a device-side signing key. Their embedded
	# checksums above protect the download; allow apk to accept the local files.
	apk add --allow-untrusted \
		"$TMP_DIR/$THEME_PACKAGE" \
		"$TMP_DIR/$APP_PACKAGE" \
		"$TMP_DIR/$THEME_RU_PACKAGE" \
		"$TMP_DIR/$APP_RU_PACKAGE" ||
		fail "apk package installation failed"
else
	opkg install \
		"$TMP_DIR/$THEME_PACKAGE" \
		"$TMP_DIR/$APP_PACKAGE" \
		"$TMP_DIR/$THEME_RU_PACKAGE" \
		"$TMP_DIR/$APP_RU_PACKAGE" ||
		fail "opkg package installation failed"
fi

# LuCI caches the resolved menu tree, including depends.uci results. An APK
# upgrade can leave a previous tree in /tmp, making only the ungated groups
# visible until the cache is removed.
stage post_install
if [ -x /usr/libexec/freenetic-clear-luci-cache ]; then
	/usr/libexec/freenetic-clear-luci-cache || fail "cannot clear LuCI cache"
else
	rm -f /tmp/luci-indexcache*
	rm -rf /tmp/luci-modulecache
fi
if [ -x /etc/init.d/rpcd ]; then
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
fi

FNC_HOME=/usr/lib/freenetic
FNC_STAGED_DIR="$TMP_DIR/fnc-stage"
mkdir -p "$FNC_STAGED_DIR" "$FNC_HOME" || fail "cannot create fnc directory"
cp "$TMP_DIR/$FNC_BIN" "$FNC_HOME/fnc.bin" || fail "cannot copy fnc binary"
chmod 0755 "$FNC_HOME/fnc.bin" || fail "cannot make fnc executable"

# OpenWrt encodes library ABI dates in SONAMEs. A binary built on a newer
# snapshot may need libubus.so.20260628 while an older, otherwise compatible
# router has libubus.so.20231128. Keep aliases in Freenetic's private
# directory instead of changing the router's system libraries.
link_runtime_library() {
	required_library="$1"
	if [ -e "/lib/$required_library" ] || [ -e "/usr/lib/$required_library" ]; then
		return 0
	fi

	case "$required_library" in
		*.so.*) library_prefix="${required_library%%.so.*}.so." ;;
		*) fail "cannot determine ABI family for $required_library" ;;
	esac

	for candidate in /lib/${library_prefix}* /usr/lib/${library_prefix}*; do
		[ -e "$candidate" ] || continue
		ln -sf "$candidate" "$FNC_HOME/$required_library" ||
			fail "cannot create private alias for $required_library"
		info "fnc: using $candidate for $required_library"
		return 0
	done

	fail "fnc runtime library is missing: $required_library"
}

for runtime_library in "$fnc_ubus_lib" "$fnc_ubox_lib" \
	"$fnc_blobmsg_lib" "$fnc_uci_lib" "$fnc_jsonc_lib"; do
	link_runtime_library "$runtime_library"
done

# Keep /usr/bin/fnc as a stable command while the real binary and any
# compatibility aliases stay in a private directory.
FNC_STAGED=/tmp/.fnc.freenetic.$$
cat > "$FNC_STAGED" <<'FREENETIC_FNC_WRAPPER'
#!/bin/sh
LD_LIBRARY_PATH="/usr/lib/freenetic:/lib:/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
export LD_LIBRARY_PATH
exec /usr/lib/freenetic/fnc.bin "$@"
FREENETIC_FNC_WRAPPER
chmod 0755 "$FNC_STAGED" || fail "cannot make fnc launcher executable"
mv -f "$FNC_STAGED" /usr/bin/fnc || fail "cannot activate /usr/bin/fnc"
FNC_STAGED=""

stage smoke_test
if ! /usr/bin/fnc show version >/dev/null 2>&1; then
	fail "fnc was installed but could not start with the router's runtime libraries"
fi

# Keep one-shot installs and dashboard-triggered updates consistent. The
# dashboard uses this tag for the friendly release label; package revisions
# remain the authoritative signal for refreshed assets under the same tag.
stage state_commit
uci -q set freenetic.updates=freenetic || fail "cannot initialize update state"
uci -q set "freenetic.updates.installed_release=$RELEASE_TAG" ||
	fail "cannot record the installed release"
uci -q commit freenetic || fail "cannot save the installed release"

stage complete
info "installed Freenetic $RELEASE_TAG for $target using $package_manager"
info "fnc is available as /usr/bin/fnc (binary: /usr/lib/freenetic/fnc.bin)"
info "Russian translations are installed; select Русский in LuCI if needed"
