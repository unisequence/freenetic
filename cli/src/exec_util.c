#include <stdio.h>
#include <sys/wait.h>
#include <unistd.h>

#include "exec_util.h"

int fnc_run(char *const argv[])
{
	pid_t pid;
	int status;

	pid = fork();
	if (pid < 0) {
		perror("fnc: fork");
		return -1;
	}
	if (pid == 0) {
		execvp(argv[0], argv);
		fprintf(stderr, "fnc: %s: команда не найдена\n", argv[0]);
		_exit(127);
	}
	if (waitpid(pid, &status, 0) < 0)
		return -1;
	return WIFEXITED(status) ? WEXITSTATUS(status) : -1;
}
