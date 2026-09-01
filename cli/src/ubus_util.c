#include <stdio.h>
#include <stdlib.h>

#include "ubus_util.h"

struct ubus_context *fnc_ubus_connect(void)
{
	struct ubus_context *ctx = ubus_connect(NULL);
	if (!ctx) {
		fprintf(stderr, "fnc: не удалось подключиться к ubus\n");
		exit(1);
	}
	return ctx;
}

int fnc_ubus_call(struct ubus_context *ctx, const char *path,
		   const char *method, struct blob_attr *msg,
		   ubus_data_handler_t cb, void *priv)
{
	uint32_t id;

	if (ubus_lookup_id(ctx, path, &id)) {
		fprintf(stderr, "fnc: объект ubus '%s' не найден\n", path);
		return -1;
	}
	if (ubus_invoke(ctx, id, method, msg, cb, priv, 3000)) {
		fprintf(stderr, "fnc: вызов %s->%s не удался\n", path, method);
		return -1;
	}
	return 0;
}
