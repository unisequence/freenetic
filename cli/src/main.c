#include "dispatch.h"
#include "repl.h"
#include "ubus_util.h"

int main(int argc, char **argv)
{
	struct ubus_context *ctx;
	int ret;

	ctx = fnc_ubus_connect();

	if (argc < 2)
		ret = fnc_repl(ctx);
	else
		ret = fnc_dispatch(ctx, argc - 1, argv + 1);

	ubus_free(ctx);
	return ret < 0 ? 1 : ret;
}
