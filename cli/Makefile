# Кросс-сборка fnc против либ таргета из openwrt-upstream buildroot
# (target=mediatek/filogic, aarch64_cortex-a53_musl) — те же libubus/
# libuci/libubox/libblobmsg_json, что уже стоят на роутере, никаких
# новых рантайм-зависимостей.

ifndef OPENWRT_DIR
$(error OPENWRT_DIR is not set — point it at your OpenWrt buildroot, e.g. make OPENWRT_DIR=/path/to/openwrt)
endif
TOOLCHAIN   ?= $(OPENWRT_DIR)/staging_dir/toolchain-aarch64_cortex-a53_gcc-14.4.0_musl
SYSROOT     ?= $(OPENWRT_DIR)/staging_dir/target-aarch64_cortex-a53_musl

CC      = $(TOOLCHAIN)/bin/aarch64-openwrt-linux-gcc
CFLAGS  = -Wall -Wextra -O2 -std=gnu11 --sysroot=$(SYSROOT) -I$(SYSROOT)/usr/include
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
