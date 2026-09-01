#ifndef FNC_CMD_CONFIG_H
#define FNC_CMD_CONFIG_H

#include <libubus.h>

/* Returns 1 if network.<name> exists and is a uci "interface" section. */
int fnc_interface_exists(const char *name);

/* Sets network.<name>.ipaddr = cidr (e.g. "192.168.1.1/24") and reloads
 * netifd via ubus so it takes effect. Returns 0 on success. */
int fnc_set_ip_address(struct ubus_context *ctx, const char *ifname,
			const char *cidr);

/* Sets network.<name>.proto = dhcp and reloads. Does not clear a
 * previously-set static ipaddr (harmless: the dhcp proto handler
 * ignores it), just switches the interface into client mode. */
int fnc_set_dhcp_client(struct ubus_context *ctx, const char *ifname);

/* network.interface.<name> up/down via ubus (netifd brings the logical
 * interface up/down — does not touch uci config). */
int fnc_interface_up(struct ubus_context *ctx, const char *ifname);
int fnc_interface_down(struct ubus_context *ctx, const char *ifname);

#endif
