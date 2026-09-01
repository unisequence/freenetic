#ifndef FNC_REPL_H
#define FNC_REPL_H

#include <libubus.h>

/* Runs the interactive shell (prompt, line editing, history) until the
 * user exits (Ctrl-D / "exit" / "quit"). Returns the exit code. */
int fnc_repl(struct ubus_context *ctx);

#endif
