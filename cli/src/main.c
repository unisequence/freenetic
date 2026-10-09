#include <stdio.h>
#include <string.h>

#include "cmd_help.h"
#include "dispatch.h"
#include "repl.h"
#include "ubus_util.h"

#ifndef FNC_BUILD_ID
#define FNC_BUILD_ID "unknown"
#endif

int main(int argc, char **argv)
{
	struct ubus_context *ctx;
	int ret;

	if (argc > 1 && strcmp(argv[1], "--version") == 0) {
		if (argc != 2)
			return 1;
		printf("fnc %s\n", FNC_BUILD_ID);
		return 0;
	}
	if (argc > 1 &&
	    (strcmp(argv[1], "--help") == 0 || strcmp(argv[1], "-h") == 0))
		return argc == 2 ? fnc_help(NULL) : 1;
	if (argc > 1 && strcmp(argv[1], "help") == 0)
		return argc <= 3 ? fnc_help(argc == 3 ? argv[2] : NULL) : 1;

	ctx = fnc_ubus_connect();

	if (argc < 2)
		ret = fnc_repl(ctx);
	else
		ret = fnc_dispatch(ctx, argc - 1, argv + 1);

	ubus_free(ctx);
	return ret < 0 ? 1 : ret;
}
