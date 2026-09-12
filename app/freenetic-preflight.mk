# Shared package pre-install gate. Keep this independent of files shipped by
# the package itself: the package manager runs preinst before those files exist
# on a fresh install.
define FREENETIC_PACKAGE_PREINST
#!/bin/sh
[ -n "$${IPKG_INSTROOT}" ] && exit 0

freenetic_fail() {
	echo "Freenetic: refusing installation: $$*" >&2
	exit 1
}

command -v ubus >/dev/null 2>&1 || freenetic_fail "ubus is not installed"
command -v jsonfilter >/dev/null 2>&1 || freenetic_fail "jsonfilter is not installed"
command -v apk >/dev/null 2>&1 || command -v opkg >/dev/null 2>&1 || \
	freenetic_fail "neither apk nor opkg is installed"

board_json="$$(ubus call system board 2>/dev/null)" || freenetic_fail "cannot read system board information"
target="$$(printf '%s\n' "$$board_json" | jsonfilter -e '@.release.target' 2>/dev/null || true)"
model="$$(printf '%s\n' "$$board_json" | jsonfilter -e '@.model' 2>/dev/null || true)"
[ -n "$$model" ] || model="unknown"

release_arch=""
if [ -r /etc/openwrt_release ]; then
	. /etc/openwrt_release
	release_arch="$${DISTRIB_ARCH:-}"
fi
machine="$$(uname -m 2>/dev/null || true)"

case "$$target" in
	mediatek/filogic)
		min_overlay_kib=32768
		[ "$$machine" = aarch64 ] || freenetic_fail "$$model requires aarch64, got $$machine"
		case "$$release_arch" in ''|aarch64*) ;; *) freenetic_fail "$$model reports incompatible architecture $$release_arch" ;; esac
		;;
	ramips/mt7621)
		min_overlay_kib=16384
		case "$$machine" in mips|mipsel) ;; *) freenetic_fail "$$model requires mips/mipsel, got $$machine" ;; esac
		case "$$release_arch" in ''|mipsel*) ;; *) freenetic_fail "$$model reports incompatible architecture $$release_arch" ;; esac
		;;
	*)
		freenetic_fail "$$model uses unsupported OpenWrt target $${target:-unknown}; supported targets are mediatek/filogic and ramips/mt7621"
		;;
esac

mem_kib="$$(awk '$$1 == "MemTotal:" { print $$2; exit }' /proc/meminfo)"
case "$$mem_kib" in ''|*[!0-9]*) freenetic_fail "cannot read total RAM" ;; esac
[ "$$((mem_kib / 1024))" -ge 128 ] || freenetic_fail "at least 128 MiB RAM is required"

cpu_cores="$$(grep -c '^processor' /proc/cpuinfo 2>/dev/null || true)"
case "$$cpu_cores" in ''|*[!0-9]*) freenetic_fail "cannot count CPU cores" ;; esac
[ "$$cpu_cores" -ge 2 ] || freenetic_fail "at least 2 CPU cores are required"

overlay_free_kib="$$(df -Pk /overlay 2>/dev/null | awk 'NR == 2 { print $$4; exit }' || true)"
[ -n "$$overlay_free_kib" ] || overlay_free_kib="$$(df -Pk / 2>/dev/null | awk 'NR == 2 { print $$4; exit }' || true)"
case "$$overlay_free_kib" in ''|*[!0-9]*) freenetic_fail "cannot read free overlay space" ;; esac
[ "$$overlay_free_kib" -ge "$$min_overlay_kib" ] || freenetic_fail "at least $$((min_overlay_kib / 1024)) MiB free overlay space is required"

exit 0
endef
