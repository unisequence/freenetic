#ifndef FNC_EXEC_UTIL_H
#define FNC_EXEC_UTIL_H

/* Runs argv[0] (NULL-terminated argv, found via $PATH) as a child,
 * inheriting our stdio, and waits for it. Returns the child's exit
 * code, or -1 on fork/exec failure. */
int fnc_run(char *const argv[]);

#endif
