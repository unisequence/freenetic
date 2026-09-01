#include <stdio.h>
#include <string.h>

#include "cmd_config.h"
#include "cmd_diag.h"
#include "cmd_help.h"
#include "cmd_route.h"
#include "cmd_show.h"
#include "cmd_system.h"
#include "dispatch.h"

static int dispatch_show(struct ubus_context *ctx, int argc, char **argv)
{
	if (argc < 2) {
		fnc_help("show");
		return 1;
	}
	if (strcmp(argv[1], "version") == 0)
		return fnc_show_version(ctx) ? 1 : 0;
	if (strcmp(argv[1], "system") == 0)
		return fnc_show_system(ctx) ? 1 : 0;
	if (strcmp(argv[1], "interface") == 0)
		return fnc_show_interface(ctx, argc > 2 ? argv[2] : NULL) ? 1 : 0;
	if (strcmp(argv[1], "ip") == 0 && argc > 2 && strcmp(argv[2], "route") == 0)
		return fnc_show_ip_route() ? 1 : 0;
	if (strcmp(argv[1], "ip") == 0 && argc > 2 && strcmp(argv[2], "arp") == 0)
		return fnc_show_arp() ? 1 : 0;
	if (strcmp(argv[1], "ip") == 0)
		return fnc_show_ip(ctx, argc > 2 ? argv[2] : NULL) ? 1 : 0;
	if (strcmp(argv[1], "running-config") == 0)
		return fnc_show_running_config() ? 1 : 0;
	if (strcmp(argv[1], "mac-table") == 0)
		return fnc_show_mac_table() ? 1 : 0;

	fnc_help("show");
	return 1;
}

/* ip route <net>/<n> <gw> [metric <N>] */
static int dispatch_ip(struct ubus_context *ctx, int argc, char **argv)
{
	if (argc >= 4 && strcmp(argv[1], "route") == 0) {
		const char *metric = NULL;

		if (argc == 6 && strcmp(argv[4], "metric") == 0)
			metric = argv[5];
		else if (argc != 4)
			goto bad;
		return fnc_ip_route_add(ctx, argv[2], argv[3], metric) ? 1 : 0;
	}
bad:
	fnc_help("route");
	return 1;
}

/* no ip route <net>/<n> <gw> */
static int dispatch_no(struct ubus_context *ctx, int argc, char **argv)
{
	if (argc == 5 && strcmp(argv[1], "ip") == 0 && strcmp(argv[2], "route") == 0)
		return fnc_ip_route_del(ctx, argv[3], argv[4]) ? 1 : 0;

	fnc_help("route");
	return 1;
}

int fnc_dispatch_interface_cmd(struct ubus_context *ctx, const char *ifname,
				int argc, char **argv)
{
	if (argc == 3 && strcmp(argv[0], "ip") == 0 &&
	    strcmp(argv[1], "address") == 0)
		return fnc_set_ip_address(ctx, ifname, argv[2]) ? 1 : 0;
	if (argc == 3 && strcmp(argv[0], "ip") == 0 &&
	    strcmp(argv[1], "dhcp") == 0 && strcmp(argv[2], "client") == 0)
		return fnc_set_dhcp_client(ctx, ifname) ? 1 : 0;
	if (argc == 1 && strcmp(argv[0], "up") == 0)
		return fnc_interface_up(ctx, ifname) ? 1 : 0;
	if (argc == 1 && strcmp(argv[0], "down") == 0)
		return fnc_interface_down(ctx, ifname) ? 1 : 0;

	fnc_help("interface");
	return 1;
}

static int dispatch_interface(struct ubus_context *ctx, int argc, char **argv)
{
	const char *ifname;

	if (argc < 2) {
		fprintf(stderr, "fnc: interface <name> <команда> — имя интерфейса обязательно\n");
		return 1;
	}
	ifname = argv[1];
	if (!fnc_interface_exists(ifname)) {
		fprintf(stderr, "fnc: network.%s: нет такого интерфейса\n", ifname);
		return 1;
	}
	if (argc == 2) {
		fprintf(stderr, "fnc: interface %s: нужна команда (например: ip address A.B.C.D/N)\n", ifname);
		return 1;
	}
	return fnc_dispatch_interface_cmd(ctx, ifname, argc - 2, argv + 2);
}

static int dispatch_system(struct ubus_context *ctx, int argc, char **argv)
{
	if (argc == 2 && strcmp(argv[1], "reboot") == 0)
		return fnc_system_reboot(ctx) ? 1 : 0;
	if (argc == 3 && strcmp(argv[1], "configuration") == 0 &&
	    strcmp(argv[2], "save") == 0)
		return fnc_system_configuration_save() ? 1 : 0;

	fnc_help("system");
	return 1;
}

int fnc_dispatch(struct ubus_context *ctx, int argc, char **argv)
{
	if (argc < 1)
		return -1;

	if (strcmp(argv[0], "show") == 0)
		return dispatch_show(ctx, argc, argv);
	if (strcmp(argv[0], "interface") == 0)
		return dispatch_interface(ctx, argc, argv);
	if (strcmp(argv[0], "system") == 0)
		return dispatch_system(ctx, argc, argv);
	if (strcmp(argv[0], "ip") == 0)
		return dispatch_ip(ctx, argc, argv);
	if (strcmp(argv[0], "no") == 0)
		return dispatch_no(ctx, argc, argv);
	if (strcmp(argv[0], "ping") == 0)
		return argc > 1 ? (fnc_ping(argv[1]) ? 1 : 0) : (fnc_help("diag"), 1);
	if (strcmp(argv[0], "traceroute") == 0)
		return argc > 1 ? (fnc_traceroute(argv[1]) ? 1 : 0) : (fnc_help("diag"), 1);
	if (strcmp(argv[0], "help") == 0)
		return fnc_help(argc > 1 ? argv[1] : NULL);

	fnc_help(NULL);
	return 1;
}
