#ifndef FNC_CMD_SHOW_H
#define FNC_CMD_SHOW_H

#include <libubus.h>

int fnc_show_version(struct ubus_context *ctx);
int fnc_show_system(struct ubus_context *ctx);
int fnc_show_interface(struct ubus_context *ctx, const char *filter);
int fnc_show_ip(struct ubus_context *ctx, const char *filter);

/* "uci export" — вся текущая конфигурация в текстовом виде. */
int fnc_show_running_config(void);

/* "ip neigh show" — ARP/ND-таблица. */
int fnc_show_arp(void);

/* "bridge fdb show" — MAC-таблица встроенного свитча (br-lan). Нужен
 * пакет ip-bridge (apk add ip-bridge) — bridge-утилита не входит в
 * базовую систему. */
int fnc_show_mac_table(void);

#endif
