#include <arpa/inet.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include "cmd_config.h"
#include "safe_apply.h"
#include "uci_util.h"

int fnc_interface_exists(const char *name)
{
	char type[32];

	if (fnc_uci_section_type("network", name, type, sizeof(type)) != 0)
		return 0;
	return strcmp(type, "interface") == 0;
}

/* "192.168.1.1/24" -> validates the address and a 0-32 prefix length. */
static int valid_ipv4_cidr(const char *cidr)
{
	char addr[INET_ADDRSTRLEN + 1];
	struct in_addr in;
	const char *slash = strchr(cidr, '/');
	size_t addrlen;
	long prefix;
	char *end;

	if (!slash || slash == cidr)
		return 0;
	addrlen = (size_t)(slash - cidr);
	if (addrlen >= sizeof(addr))
		return 0;
	memcpy(addr, cidr, addrlen);
	addr[addrlen] = '\0';
	if (inet_pton(AF_INET, addr, &in) != 1)
		return 0;
	for (const char *p = slash + 1; *p; p++)
		if (*p < '0' || *p > '9')
			return 0;

	prefix = strtol(slash + 1, &end, 10);
	if (end == slash + 1 || *end != '\0' || prefix < 0 || prefix > 32)
		return 0;
	return 1;
}

int fnc_set_ip_address(struct ubus_context *ctx, const char *ifname,
			const char *cidr)
{
	if (!valid_ipv4_cidr(cidr)) {
		fprintf(stderr, "fnc: неверный формат адреса, ожидается A.B.C.D/N\n");
		return -1;
	}
	return fnc_safe_apply(ctx, FNC_CHANGE_ADDRESS, ifname, cidr, NULL, NULL);
}

int fnc_set_dhcp_client(struct ubus_context *ctx, const char *ifname)
{
	return fnc_safe_apply(ctx, FNC_CHANGE_DHCP, ifname, NULL, NULL, NULL);
}

int fnc_interface_up(struct ubus_context *ctx, const char *ifname)
{
	return fnc_safe_apply(ctx, FNC_CHANGE_UP, ifname, NULL, NULL, NULL);
}

int fnc_interface_down(struct ubus_context *ctx, const char *ifname)
{
	return fnc_safe_apply(ctx, FNC_CHANGE_DOWN, ifname, NULL, NULL, NULL);
}
