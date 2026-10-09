#ifndef FNC_CMD_FREENETIC_H
#define FNC_CMD_FREENETIC_H

#include <libubus.h>

int fnc_show_wan(struct ubus_context *ctx);
int fnc_show_dns(struct ubus_context *ctx);
int fnc_show_multiwan(void);
int fnc_show_applications(const char *package);

#endif
