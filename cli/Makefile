# Кросс-сборка fnc против либ таргета из openwrt-upstream buildroot
# (target=mediatek/filogic или ramips/mt7621) — те же libubus/libuci/
# libubox/libblobmsg_json, что уже стоят на роутере, никаких новых
# рантайм-зависимостей.

ifndef OPENWRT_DIR
$(error OPENWRT_DIR is not set — point it at your OpenWrt buildroot, e.g. make OPENWRT_DIR=/path/to/openwrt)
endif
# The web packages are architecture-independent, but fnc links to OpenWrt's
# target libraries. Keep both supported hardware profiles buildable.
FREENETIC_TARGET ?= filogic
ifeq ($(FREENETIC_TARGET),filogic)
TOOLCHAIN_ARCH := aarch64_cortex-a53
TARGET_TRIPLE  := aarch64-openwrt-linux
else ifeq ($(FREENETIC_TARGET),mt7621)
TOOLCHAIN_ARCH := mipsel_24kc
TARGET_TRIPLE  := mipsel-openwrt-linux
else
$(error unsupported FREENETIC_TARGET '$(FREENETIC_TARGET)' — use filogic or mt7621)
endif

TOOLCHAIN   ?= $(shell find "$(OPENWRT_DIR)/staging_dir" -maxdepth 1 -type d \
	-name 'toolchain-$(TOOLCHAIN_ARCH)_gcc-*_musl' -print 2>/dev/null | \
	sort -V | tail -n 1)
SYSROOT     ?= $(OPENWRT_DIR)/staging_dir/target-$(TOOLCHAIN_ARCH)_musl

ifeq ($(TOOLCHAIN),)
$(error no $(TOOLCHAIN_ARCH) musl toolchain found under $(OPENWRT_DIR)/staging_dir)
endif

export STAGING_DIR := $(SYSROOT)

CC      = $(TOOLCHAIN)/bin/$(TARGET_TRIPLE)-gcc
CFLAGS  = -Wall -Wextra -O2 -std=gnu11 --sysroot=$(SYSROOT)
LDFLAGS = --sysroot=$(SYSROOT) -L$(SYSROOT)/usr/lib
LIBS    = -lubus -lubox -lblobmsg_json -ljson-c -luci

SRCS = src/main.c src/ubus_util.c src/uci_util.c src/exec_util.c src/cmd_show.c src/cmd_config.c src/cmd_help.c src/cmd_diag.c src/cmd_system.c src/cmd_route.c src/dispatch.c src/repl.c
OBJS = $(SRCS:.c=.o)
BIN  = fnc

.PHONY: all clean
all: $(BIN)

$(BIN): $(OBJS)
	$(CC) $(LDFLAGS) -o $@ $(OBJS) $(LIBS)

%.o: %.c
	$(CC) $(CFLAGS) -c -o $@ $<

clean:
	rm -f $(OBJS) $(BIN)
