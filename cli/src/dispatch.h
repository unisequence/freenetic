#ifndef FNC_DISPATCH_H
#define FNC_DISPATCH_H

#include <libubus.h>

/* argv[0] is the first command word (e.g. "show"), not a program name —
 * shared between one-shot CLI invocation and the interactive REPL.
 * Prints its own usage/error message on a bad command. Returns 0 on
 * success, 1 on a handled error, -1 if argv was empty. */
int fnc_dispatch(struct ubus_context *ctx, int argc, char **argv);

/* Runs a subcommand already inside an interface's context (argv holds
 * only the tokens after the interface name, e.g. {"ip","address","..."})
 * — used both by one-shot "interface <name> ..." and the REPL's nested
 * interface-config prompt. */
int fnc_dispatch_interface_cmd(struct ubus_context *ctx, const char *ifname,
				int argc, char **argv);

#endif
