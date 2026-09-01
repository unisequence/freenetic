#ifndef FNC_UBUS_UTIL_H
#define FNC_UBUS_UTIL_H

#include <libubus.h>
#include <libubox/blobmsg.h>

/* Connects to the system ubus socket. Exits the process with an error
 * message on failure — every subcommand needs ubus, there is nothing
 * useful to do without it. */
struct ubus_context *fnc_ubus_connect(void);

/* Invokes path/method (with optional msg args, may be NULL) and hands the
 * reply's raw blob_attr array to cb. Returns 0 on success, -1 if the
 * object/method could not be resolved or the call failed. */
int fnc_ubus_call(struct ubus_context *ctx, const char *path,
		   const char *method, struct blob_attr *msg,
		   ubus_data_handler_t cb, void *priv);

#endif
