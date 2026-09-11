#!/bin/sh
# Freenetic one-shot installer for supported apk-based OpenWrt routers.
#
# Usage:
#   sh <(wget -qO - 'https://raw.githubusercontent.com/unisequence/freenetic/main/install.sh')
#
# The release and checksums are deliberately pinned. Do not install a
# partially downloaded or silently replaced package.
set -eu

RELEASE_TAG="v0.2.0"
# GitHub normalizes the '~' in the OpenWrt-derived package version to '.'.
ASSET_VERSION="26.254.60793.faf18d0"
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

cleanup() {
	[ -z "${FNC_STAGED:-}" ] || rm -f "$FNC_STAGED"
	[ -z "${FNC_STAGED_DIR:-}" ] || rm -rf "$FNC_STAGED_DIR"
	[ -z "${TMP_DIR:-}" ] || rm -rf "$TMP_DIR"
}

trap cleanup EXIT INT TERM

for command_name in apk awk df grep jsonfilter sha256sum ubus uname wget; do
	command -v "$command_name" >/dev/null 2>&1 ||
		fail "required command is missing: $command_name"
done

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
		fnc_sha256="ff0d203cf7cdbe92077372601bd6cca8ff290db83d16319ebb70234b67bbb831"
		fnc_ubus_lib="libubus.so.20260628"
		fnc_ubox_lib="libubox.so.20260721"
		fnc_blobmsg_lib="libblobmsg_json.so.20260721"
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
		fnc_sha256="a3071f864f6d04f0a8558f53bfb35f7dda5b3a2aec9ad99f7bd2fd5f7e77d4b8"
		fnc_ubus_lib="libubus.so.20251202"
		fnc_ubox_lib="libubox.so.20260213"
		fnc_blobmsg_lib="libblobmsg_json.so.20260213"
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

THEME_APK="luci-theme-freenetic-${ASSET_VERSION}-${target_suffix}.apk"
APP_APK="luci-app-freenetic-${ASSET_VERSION}-${target_suffix}.apk"
THEME_RU_APK="luci-i18n-theme-freenetic-ru-${ASSET_VERSION}-${target_suffix}.apk"
APP_RU_APK="luci-i18n-freenetic-ru-${ASSET_VERSION}-${target_suffix}.apk"
FNC_BIN="fnc-${ASSET_VERSION}-${target_suffix}"

download_checked() {
	asset_name="$1"
	expected_sha256="$2"
	destination="$TMP_DIR/$asset_name"

	info "downloading $asset_name"
	wget -qO "$destination" "$RELEASE_BASE_URL/$asset_name" ||
		fail "download failed: $asset_name"
	[ -s "$destination" ] || fail "downloaded asset is empty: $asset_name"

	actual_sha256="$(sha256sum "$destination" | awk '{ print $1 }')"
	[ "$actual_sha256" = "$expected_sha256" ] ||
		fail "SHA-256 mismatch for $asset_name"
}

# APKs are noarch, but each target feed has its own GitHub asset name so the
# installer can select the same target path as apk's package index.
download_checked "$THEME_APK" "b8e3df85135f5d35945b1e506251fb67dafabf22a9ba3c08b1c8a051d7985012"
download_checked "$APP_APK" "f086828b94f4e395747d4b8b0e52b57eecac73afab1df3b2176fe98256c59e85"
download_checked "$THEME_RU_APK" "bc7b8723141fe88806b4b4243b1f72e56e17263b1b3f0827ba4aa331f5de994d"
download_checked "$APP_RU_APK" "629f911fe181cb5460fcc185903fc9f45119dd6a005d5b5cc74d7c5544b662a9"
download_checked "$FNC_BIN" "$fnc_sha256"

info "installing LuCI packages"
# v0.2.0 APKs are built without a device-side signing key. Their embedded
# checksums above protect the download; allow apk to accept these local files.
apk add --allow-untrusted \
	"$TMP_DIR/$THEME_APK" \
	"$TMP_DIR/$APP_APK" \
	"$TMP_DIR/$THEME_RU_APK" \
	"$TMP_DIR/$APP_RU_APK" ||
	fail "apk package installation failed"

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

if ! /usr/bin/fnc show version >/dev/null 2>&1; then
	fail "fnc was installed but could not start with the router's runtime libraries"
fi

info "installed Freenetic $RELEASE_TAG for $target"
info "fnc is available as /usr/bin/fnc (binary: /usr/lib/freenetic/fnc.bin)"
info "Russian translations are installed; select Русский in LuCI if needed"
