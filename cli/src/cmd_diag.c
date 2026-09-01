#include <stddef.h>

#include "cmd_diag.h"
#include "exec_util.h"

/* Ограничиваем ping четырьмя пакетами (-c 4) вместо бесконечного —
 * так его не нужно прерывать по Ctrl-C, которое в raw-режиме REPL не
 * доходит до дочернего процесса как сигнал. */
int fnc_ping(const char *host)
{
	char *argv[] = { "ping", "-c", "4", (char *)host, NULL };

	return fnc_run(argv);
}

int fnc_traceroute(const char *host)
{
	char *argv[] = { "traceroute", (char *)host, NULL };

	return fnc_run(argv);
}
