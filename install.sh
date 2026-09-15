#!/bin/sh
# Freenetic one-shot installer for supported OpenWrt routers.
#
# Usage:
#   wget -qO- 'https://raw.githubusercontent.com/unisequence/freenetic/v0.2.5/install.sh' | sh
#
# The release and checksums are deliberately pinned. Do not install a
# partially downloaded or silently replaced package.
set -eu

RELEASE_TAG="v0.2.5"
# GitHub normalizes the '~' in the OpenWrt-derived package version to '.'.
ASSET_VERSION="26.257.51426.6a30103"
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
	if [ "${PERSISTENT_MUTATION_STARTED:-0}" = 1 ] && [ "${INSTALL_COMMITTED:-0}" != 1 ]; then
		info "rolling back native files and update state"
		if [ "${HAD_FNC_HOME:-0}" = 1 ]; then
			rm -rf /usr/lib/freenetic
			cp -a "$ROLLBACK_DIR/fnc-home" /usr/lib/freenetic 2>/dev/null || true
		else
			rm -rf /usr/lib/freenetic
		fi
		if [ "${HAD_FNC_LAUNCHER:-0}" = 1 ]; then
			rm -f /usr/bin/fnc
			cp -a "$ROLLBACK_DIR/fnc-launcher" /usr/bin/fnc 2>/dev/null || true
		else
			rm -f /usr/bin/fnc
		fi
		uci -q revert freenetic >/dev/null 2>&1 || true
		if [ "${HAD_FREENETIC_CONFIG:-0}" = 1 ]; then
			cp -a "$ROLLBACK_DIR/freenetic-config" /etc/config/freenetic 2>/dev/null || true
		else
			rm -f /etc/config/freenetic
		fi
	fi
	[ -z "${FNC_STAGED:-}" ] || rm -f "$FNC_STAGED"
	[ -z "${FNC_TARGET:-}" ] || rm -f "$FNC_TARGET"
	[ -z "${FNC_STAGED_DIR:-}" ] || rm -rf "$FNC_STAGED_DIR"
	[ -z "${TMP_DIR:-}" ] || rm -rf "$TMP_DIR"
}

trap cleanup EXIT INT TERM

stage preflight
for command_name in awk df grep jsonfilter mktemp readlink sha256sum ubus uci uname wget; do
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

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/freenetic-install.XXXXXX" 2>/dev/null)" ||
	fail "cannot create secure temporary directory"
ROLLBACK_DIR="$TMP_DIR/rollback"
PERSISTENT_MUTATION_STARTED=0
INSTALL_COMMITTED=0

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
		fnc_sha256_ipk="569c07f3523193f646f182f2a09459feda5946c5bc0d9fecf3432a0361481ddb"
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
		fnc_sha256_apk="694db49b76061c2cca0a8c4b9ff3d9fc638bfea4ee1d5a48c9f29e06936a1470"
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
		APK_RELEASE_KEY="freenetic-apk-release-key-${ASSET_VERSION}.pem"
		apk_key_sha256="0000000000000000000000000000000000000000000000000000000000000000"
		theme_sha256="60296213f9439bda8e20a823d1f2317d68bb6cb59bdd48e5f077485f19a7c27d"
		app_sha256="0874fe5621b7c6efa66db0edaf6b0ba56b7eb003b94118b18a70f2284e5fedd5"
		theme_ru_sha256="dcf582def7bfa9293e32ee295d72e7b6a9fbb3ecaa2573d53a50ddf855cc8826"
		app_ru_sha256="dce7641f7b274672c8821213c655f1c897f37d1b2435831934cb8adaa96e5bfb"
		;;
	opkg)
		THEME_PACKAGE="luci-theme-freenetic-${ASSET_VERSION}-all.ipk"
		APP_PACKAGE="luci-app-freenetic-${ASSET_VERSION}-all.ipk"
		THEME_RU_PACKAGE="luci-i18n-theme-freenetic-ru-${ASSET_VERSION}-all.ipk"
		APP_RU_PACKAGE="luci-i18n-freenetic-ru-${ASSET_VERSION}-all.ipk"
		theme_sha256="04f1599288dc0a14c9a61ce08528f057fc9ffc0e1a7e5081eba0e6946f5cd96f"
		app_sha256="397ad18344c4060f5935a2bed5e4e33bff18ea2397f4c498e84563ace5863430"
		theme_ru_sha256="1c833b1002e6f75db145ca41249b148baf3f132cf232238cc1ce6e27889927ef"
		app_ru_sha256="61e822d9ca8b0636aaa9a061ec85bbd756799d050dbd6dd9bcc25485fe033e79"
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

if [ "$package_manager" = apk ]; then
	download_checked "$APK_RELEASE_KEY" "$apk_key_sha256"
	APK_KEYS_DIR="$TMP_DIR/apk-keys"
	mkdir -m 0700 "$APK_KEYS_DIR" || fail "cannot create APK trust directory"
	for system_key in /etc/apk/keys/*.pem; do
		[ -f "$system_key" ] || continue
		cp "$system_key" "$APK_KEYS_DIR/" || fail "cannot stage system APK trust key"
	done
	cp "$TMP_DIR/$APK_RELEASE_KEY" "$APK_KEYS_DIR/freenetic-release.pem" ||
		fail "cannot stage Freenetic APK trust key"
fi

# Validate the target-specific binary and every runtime alias before the first
# package is changed. A late ABI mismatch must never leave LuCI upgraded while
# fnc is unusable.
stage fnc_preflight
FNC_STAGED_DIR="$TMP_DIR/fnc-stage"
mkdir -m 0700 "$FNC_STAGED_DIR" || fail "cannot create fnc staging directory"
cp "$TMP_DIR/$FNC_BIN" "$FNC_STAGED_DIR/fnc.bin" || fail "cannot stage fnc binary"
chmod 0755 "$FNC_STAGED_DIR/fnc.bin" || fail "cannot make staged fnc executable"

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
		ln -s "$candidate" "$FNC_STAGED_DIR/$required_library" ||
			fail "cannot stage private alias for $required_library"
		info "fnc: using $candidate for $required_library"
		return 0
	done

	fail "fnc runtime library is missing: $required_library"
}

for runtime_library in "$fnc_ubus_lib" "$fnc_ubox_lib" \
	"$fnc_blobmsg_lib" "$fnc_uci_lib" "$fnc_jsonc_lib"; do
	link_runtime_library "$runtime_library"
done

if ! LD_LIBRARY_PATH="$FNC_STAGED_DIR:/lib:/usr/lib${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
	"$FNC_STAGED_DIR/fnc.bin" show version >/dev/null 2>&1; then
	fail "fnc is incompatible with the router's runtime libraries"
fi

# Snapshot every non-package persistent object before changing it. These
# objects are activated and smoke-tested first; the batched package-manager
# invocation below is the final fatal commit. A failure before that commit
# restores this snapshot from cleanup().
stage native_snapshot
mkdir -m 0700 "$ROLLBACK_DIR" || fail "cannot create rollback directory"
HAD_FNC_HOME=0
HAD_FNC_LAUNCHER=0
HAD_FREENETIC_CONFIG=0
if [ -e /usr/lib/freenetic ]; then
	cp -a /usr/lib/freenetic "$ROLLBACK_DIR/fnc-home" || fail "cannot snapshot fnc directory"
	HAD_FNC_HOME=1
fi
if [ -e /usr/bin/fnc ] || [ -L /usr/bin/fnc ]; then
	cp -a /usr/bin/fnc "$ROLLBACK_DIR/fnc-launcher" || fail "cannot snapshot fnc launcher"
	HAD_FNC_LAUNCHER=1
fi
if [ -e /etc/config/freenetic ]; then
	cp -a /etc/config/freenetic "$ROLLBACK_DIR/freenetic-config" || fail "cannot snapshot update state"
	HAD_FREENETIC_CONFIG=1
fi
PERSISTENT_MUTATION_STARTED=1

stage native_activation
FNC_HOME=/usr/lib/freenetic
mkdir -p "$FNC_HOME" || fail "cannot create fnc directory"
FNC_TARGET="$(mktemp "$FNC_HOME/.fnc.bin.XXXXXX" 2>/dev/null)" || fail "cannot stage fnc activation"
cp "$FNC_STAGED_DIR/fnc.bin" "$FNC_TARGET" || fail "cannot copy fnc binary"
chmod 0755 "$FNC_TARGET" || fail "cannot make fnc executable"
for staged_alias in "$FNC_STAGED_DIR"/*.so.*; do
	[ -L "$staged_alias" ] || continue
	ln -sf "$(readlink "$staged_alias")" "$FNC_HOME/${staged_alias##*/}" ||
		fail "cannot activate private runtime alias"
done
mv -f "$FNC_TARGET" "$FNC_HOME/fnc.bin" || fail "cannot activate fnc binary"
FNC_TARGET=""

# Keep /usr/bin/fnc as a stable command while the real binary and any
# compatibility aliases stay in a private directory. Stage it on /usr/bin's
# filesystem so activation is one atomic rename.
FNC_STAGED="$(mktemp /usr/bin/.fnc.freenetic.XXXXXX 2>/dev/null)" || fail "cannot stage fnc launcher"
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

# Record the desired state before the package commit so a UCI failure remains
# rollback-safe. The snapshot above is restored if anything below fails.
stage state_commit
uci -q set freenetic.updates=freenetic || fail "cannot initialize update state"
uci -q set "freenetic.updates.installed_release=$RELEASE_TAG" ||
	fail "cannot record the installed release"
uci -q commit freenetic || fail "cannot save the installed release"

stage package_install
info "installing LuCI packages"
if [ "$package_manager" = apk ]; then
	# Verify Freenetic packages with the pinned release key while retaining the
	# router's system keys for dependencies fetched from the OpenWrt feeds.
	apk --keys-dir "$APK_KEYS_DIR" add \
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
INSTALL_COMMITTED=1

# LuCI caches the resolved menu tree, including depends.uci results. An APK
# upgrade can leave a previous tree in /tmp, making only the ungated groups
# visible until the cache is removed.
stage post_install
if [ -x /usr/libexec/freenetic-clear-luci-cache ]; then
	/usr/libexec/freenetic-clear-luci-cache || info "warning: LuCI cache could not be cleared; reload rpcd or reboot if menus look stale"
else
	rm -f /tmp/luci-indexcache* 2>/dev/null || true
	rm -rf /tmp/luci-modulecache 2>/dev/null || true
fi
if [ -x /etc/init.d/rpcd ]; then
	/etc/init.d/rpcd reload >/dev/null 2>&1 || true
fi

stage complete
info "installed Freenetic $RELEASE_TAG for $target using $package_manager"
info "fnc is available as /usr/bin/fnc (binary: /usr/lib/freenetic/fnc.bin)"
info "Russian translations are installed; select Русский in LuCI if needed"
