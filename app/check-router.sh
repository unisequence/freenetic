#!/bin/sh
# Verify that a router meets Freenetic's supported hardware profile.
#
# This is intentionally a host-side wrapper.  It sends the read-only checks
# over SSH before deploy.sh changes anything on the router.  The package
# preinst checks in app/freenetic-preflight.mk repeat the important gate for
# direct apk installs.
set -eu

usage() {
    echo "Usage: $0 [root@router]" >&2
    echo "Environment: FREENETIC_ROUTER, FREENETIC_SSH_CMD, FREENETIC_MIN_RAM_MIB," >&2
    echo "             FREENETIC_MIN_CPU_CORES, FREENETIC_MIN_OVERLAY_MIB_FILOGIC," >&2
    echo "             FREENETIC_MIN_OVERLAY_MIB_MT7621" >&2
}

if [ "$#" -gt 1 ]; then
    usage
    exit 2
fi

ROUTER="${1:-${FREENETIC_ROUTER:-root@192.168.1.1}}"
SSH_CMD="${FREENETIC_SSH_CMD:-ssh}"
MIN_RAM_MIB="${FREENETIC_MIN_RAM_MIB:-128}"
MIN_CPU_CORES="${FREENETIC_MIN_CPU_CORES:-2}"
MIN_OVERLAY_MIB_FILOGIC="${FREENETIC_MIN_OVERLAY_MIB_FILOGIC:-32}"
MIN_OVERLAY_MIB_MT7621="${FREENETIC_MIN_OVERLAY_MIB_MT7621:-16}"

valid_uint() {
    case "$1" in
        ''|*[!0-9]*) return 1 ;;
    esac
}

for value in "$MIN_RAM_MIB" "$MIN_CPU_CORES" \
    "$MIN_OVERLAY_MIB_FILOGIC" "$MIN_OVERLAY_MIB_MT7621"; do
    valid_uint "$value" || {
        echo "Freenetic preflight: thresholds must be non-negative integers." >&2
        exit 2
    }
done

# Keep the remote script POSIX-sh compatible: it runs on the router's busybox
# shell and only uses base OpenWrt utilities.
$SSH_CMD "$ROUTER" sh -s -- \
    "$MIN_RAM_MIB" "$MIN_CPU_CORES" \
    "$MIN_OVERLAY_MIB_FILOGIC" "$MIN_OVERLAY_MIB_MT7621" <<'REMOTE'
set -eu

min_ram_mib="$1"
min_cpu_cores="$2"
min_overlay_mib_filogic="$3"
min_overlay_mib_mt7621="$4"

fail() {
    echo "Freenetic preflight: FAIL: $*" >&2
    exit 1
}

command -v ubus >/dev/null 2>&1 || fail "ubus is not installed"
command -v jsonfilter >/dev/null 2>&1 || fail "jsonfilter is not installed"
command -v apk >/dev/null 2>&1 || fail "apk is not installed; this release targets apk-based OpenWrt"

board_json="$(ubus call system board 2>/dev/null)" || fail "cannot read system board information"
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
        min_overlay_mib="$min_overlay_mib_filogic"
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
        min_overlay_mib="$min_overlay_mib_mt7621"
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
[ "$ram_mib" -ge "$min_ram_mib" ] || \
    fail "$model has ${ram_mib} MiB RAM; minimum is ${min_ram_mib} MiB"

cpu_cores="$(grep -c '^processor' /proc/cpuinfo 2>/dev/null || true)"
case "$cpu_cores" in
    ''|*[!0-9]*) fail "cannot count CPU cores" ;;
esac
[ "$cpu_cores" -ge "$min_cpu_cores" ] || \
    fail "$model has ${cpu_cores} CPU cores; minimum is ${min_cpu_cores}"

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
[ "$overlay_mib" -ge "$min_overlay_mib" ] || \
    fail "$model has ${overlay_mib} MiB free on ${overlay_path}; minimum is ${min_overlay_mib} MiB"

echo "Freenetic router preflight: PASS"
echo "  model: $model"
echo "  target: $target"
echo "  architecture: ${release_arch:-$machine}"
echo "  CPU cores: $cpu_cores (minimum $min_cpu_cores)"
echo "  RAM: $ram_mib MiB (minimum $min_ram_mib MiB)"
echo "  free $overlay_path: $overlay_mib MiB (minimum $min_overlay_mib MiB)"
REMOTE
