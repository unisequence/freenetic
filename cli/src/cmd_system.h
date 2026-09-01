#ifndef FNC_CMD_SYSTEM_H
#define FNC_CMD_SYSTEM_H

#include <libubus.h>

int fnc_system_reboot(struct ubus_context *ctx);

/* OpenWrt applies uci-config changes immediately (each fnc write-command
 * already commits+reloads) — there is no separate "save to nvram" step
 * like KeeneticOS has. Kept for muscle memory: just fsyncs. */
int fnc_system_configuration_save(void);

#endif
