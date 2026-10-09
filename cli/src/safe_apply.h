#ifndef FNC_SAFE_APPLY_H
#define FNC_SAFE_APPLY_H

#include <libubus.h>

enum fnc_change_kind {
	FNC_CHANGE_ADDRESS,
	FNC_CHANGE_DHCP,
	FNC_CHANGE_UP,
	FNC_CHANGE_DOWN,
	FNC_CHANGE_ROUTE_ADD,
	FNC_CHANGE_ROUTE_DEL,
};

int fnc_safe_apply(struct ubus_context *ctx, enum fnc_change_kind kind,
		   const char *arg1, const char *arg2, const char *arg3,
		   const char *arg4);
int fnc_safe_confirm(struct ubus_context *ctx);
int fnc_safe_rollback(struct ubus_context *ctx);
int fnc_safe_pending(struct ubus_context *ctx);
int fnc_safe_has_pending(struct ubus_context *ctx);

#endif
