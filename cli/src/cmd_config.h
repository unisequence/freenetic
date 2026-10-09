#ifndef FNC_CMD_CONFIG_H
#define FNC_CMD_CONFIG_H

#include <libubus.h>

/* Returns 1 if network.<name> exists and is a uci "interface" section. */
int fnc_interface_exists(const char *name);

/* Stages and applies a network change with rpcd timed rollback. */
int fnc_set_ip_address(struct ubus_context *ctx, const char *ifname,
			const char *cidr);

/* Switches to DHCP and removes the old static address, pending confirmation. */
int fnc_set_dhcp_client(struct ubus_context *ctx, const char *ifname);

/* Enables or disables the logical interface in UCI, pending confirmation. */
int fnc_interface_up(struct ubus_context *ctx, const char *ifname);
int fnc_interface_down(struct ubus_context *ctx, const char *ifname);

#endif
