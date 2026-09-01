#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <termios.h>
#include <unistd.h>

#include "cmd_config.h"
#include "dispatch.h"
#include "repl.h"

#define LINE_MAX 512
#define HIST_MAX 200
#define MAX_ARGS 32

static struct termios orig_termios;

static void restore_terminal(void)
{
	tcsetattr(STDIN_FILENO, TCSAFLUSH, &orig_termios);
}

static int enable_raw_mode(void)
{
	struct termios raw;

	if (tcgetattr(STDIN_FILENO, &orig_termios) == -1)
		return -1;
	atexit(restore_terminal);

	raw = orig_termios;
	raw.c_iflag &= ~(unsigned)(BRKINT | ICRNL | INPCK | ISTRIP | IXON);
	/* OPOST/ONLCR stay on: our own output uses plain "\n", not "\r\n" */
	raw.c_cflag |= CS8;
	raw.c_lflag &= ~(unsigned)(ECHO | ICANON | IEXTEN | ISIG);
	raw.c_cc[VMIN] = 1;
	raw.c_cc[VTIME] = 0;

	return tcsetattr(STDIN_FILENO, TCSAFLUSH, &raw);
}

static void refresh_line(const char *prompt, const char *buf, int len, int pos)
{
	printf("\r%s%s\x1b[K", prompt, buf);
	if (len - pos > 0)
		printf("\x1b[%dD", len - pos);
	fflush(stdout);
}

/* Reads one line with basic editing (left/right/backspace/delete) and
 * history (up/down). Returns line length, or -1 on Ctrl-D with an empty
 * buffer (EOF). */
static int read_line(const char *prompt, char *buf, int bufsz,
		      char **history, int hist_count)
{
	int len = 0, pos = 0, hist_idx = hist_count;
	char saved[LINE_MAX] = { 0 };
	unsigned char c;

	buf[0] = '\0';
	printf("%s", prompt);
	fflush(stdout);

	for (;;) {
		if (read(STDIN_FILENO, &c, 1) != 1)
			return len == 0 ? -1 : len;

		if (c == '\r' || c == '\n') {
			printf("\r\n");
			return len;
		} else if (c == 127 || c == 8) { /* backspace */
			if (pos > 0) {
				memmove(buf + pos - 1, buf + pos, len - pos);
				pos--;
				len--;
				buf[len] = '\0';
				refresh_line(prompt, buf, len, pos);
			}
		} else if (c == 3) { /* Ctrl-C */
			printf("^C\r\n");
			buf[0] = '\0';
			return 0;
		} else if (c == 4) { /* Ctrl-D */
			if (len == 0)
				return -1;
		} else if (c == 27) { /* ESC sequence */
			unsigned char seq[2];

			if (read(STDIN_FILENO, &seq[0], 1) != 1)
				continue;
			if (seq[0] != '[' && seq[0] != 'O')
				continue;
			if (read(STDIN_FILENO, &seq[1], 1) != 1)
				continue;

			if (seq[1] == '3') { /* Delete: ESC [ 3 ~ */
				unsigned char tilde;

				if (read(STDIN_FILENO, &tilde, 1) != 1)
					continue;
				if (pos < len) {
					memmove(buf + pos, buf + pos + 1,
						len - pos - 1);
					len--;
					buf[len] = '\0';
					refresh_line(prompt, buf, len, pos);
				}
				continue;
			}

			switch (seq[1]) {
			case 'A': /* up */
				if (hist_idx > 0) {
					if (hist_idx == hist_count)
						strncpy(saved, buf, sizeof(saved) - 1);
					hist_idx--;
					strncpy(buf, history[hist_idx], bufsz - 1);
					buf[bufsz - 1] = '\0';
					len = pos = (int)strlen(buf);
					refresh_line(prompt, buf, len, pos);
				}
				break;
			case 'B': /* down */
				if (hist_idx < hist_count) {
					hist_idx++;
					if (hist_idx == hist_count) {
						strncpy(buf, saved, bufsz - 1);
					} else {
						strncpy(buf, history[hist_idx], bufsz - 1);
					}
					buf[bufsz - 1] = '\0';
					len = pos = (int)strlen(buf);
					refresh_line(prompt, buf, len, pos);
				}
				break;
			case 'C': /* right */
				if (pos < len) {
					pos++;
					refresh_line(prompt, buf, len, pos);
				}
				break;
			case 'D': /* left */
				if (pos > 0) {
					pos--;
					refresh_line(prompt, buf, len, pos);
				}
				break;
			default:
				break;
			}
		} else if (c >= 32 && c < 127) {
			if (len >= bufsz - 1)
				continue;
			memmove(buf + pos + 1, buf + pos, len - pos);
			buf[pos] = (char)c;
			pos++;
			len++;
			buf[len] = '\0';
			refresh_line(prompt, buf, len, pos);
		}
	}
}

static int tokenize(char *line, char **argv, int max_args)
{
	int argc = 0;
	char *tok = strtok(line, " \t");

	while (tok && argc < max_args) {
		argv[argc++] = tok;
		tok = strtok(NULL, " \t");
	}
	return argc;
}

int fnc_repl(struct ubus_context *ctx)
{
	char line[LINE_MAX];
	char *history[HIST_MAX];
	int hist_count = 0;
	char cur_if[64] = "";
	char prompt[96];

	if (!isatty(STDIN_FILENO)) {
		fprintf(stderr, "fnc: интерактивный режим требует tty\n");
		return 1;
	}
	if (enable_raw_mode() == -1) {
		fprintf(stderr, "fnc: не удалось включить raw-режим терминала\n");
		return 1;
	}

	for (;;) {
		char *argv[MAX_ARGS];
		int argc, n;

		if (cur_if[0])
			snprintf(prompt, sizeof(prompt), "fnc-cfg (%s)> ", cur_if);
		else
			snprintf(prompt, sizeof(prompt), "fnc-cfg> ");

		n = read_line(prompt, line, sizeof(line), history, hist_count);
		if (n < 0) {
			printf("\r\n");
			break;
		}
		if (n == 0)
			continue;

		if (hist_count == 0 || strcmp(history[hist_count - 1], line) != 0) {
			if (hist_count == HIST_MAX) {
				free(history[0]);
				memmove(history, history + 1,
					sizeof(char *) * (HIST_MAX - 1));
				hist_count--;
			}
			history[hist_count++] = strdup(line);
		}

		argc = tokenize(line, argv, MAX_ARGS);
		if (argc == 0)
			continue;

		if (strcmp(argv[0], "exit") == 0 || strcmp(argv[0], "quit") == 0) {
			if (cur_if[0])
				cur_if[0] = '\0';
			else
				break;
			continue;
		}

		if (!cur_if[0] && strcmp(argv[0], "interface") == 0 && argc == 2) {
			if (fnc_interface_exists(argv[1])) {
				strncpy(cur_if, argv[1], sizeof(cur_if) - 1);
			} else {
				fprintf(stderr, "fnc: network.%s: нет такого интерфейса\n", argv[1]);
			}
			continue;
		}

		if (cur_if[0] && strcmp(argv[0], "show") != 0)
			fnc_dispatch_interface_cmd(ctx, cur_if, argc, argv);
		else
			fnc_dispatch(ctx, argc, argv);
	}

	for (int i = 0; i < hist_count; i++)
		free(history[i]);

	return 0;
}
