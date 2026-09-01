#ifndef FNC_CMD_ROUTE_H
#define FNC_CMD_ROUTE_H

#include <libubus.h>

/* "ip route show" — активная таблица маршрутизации ядра (не только то,
 * что задано в uci, но и connected/dhcp-маршруты). */
int fnc_show_ip_route(void);

/* Добавляет статический маршрут (network.route в uci) и делает
 * network reload. metric может быть NULL. */
int fnc_ip_route_add(struct ubus_context *ctx, const char *target_cidr,
		      const char *gateway, const char *metric);

/* Удаляет ранее добавленный статический маршрут по target+gateway. */
int fnc_ip_route_del(struct ubus_context *ctx, const char *target_cidr,
		      const char *gateway);

#endif
