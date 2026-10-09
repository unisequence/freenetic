#ifndef FNC_UCI_UTIL_H
#define FNC_UCI_UTIL_H

#include <stddef.h>

/* Change both protocol and address in one UCI commit. Callers reload network. */
int fnc_uci_set_interface_address(const char *section, const char *cidr);
int fnc_uci_set_interface_dhcp(const char *section);

/* Looks up the type of package.section (e.g. uci show network.lan ->
 * "interface") into out. Returns 0 on success, -1 if not found. */
int fnc_uci_section_type(const char *package, const char *section,
			  char *out, size_t outsz);

/* Adds a new network.route section (target/gateway/optional metric,
 * optional owning interface — netifd ignores a route with none).
 * Returns 0 on success. */
int fnc_uci_add_route(const char *target_cidr, const char *gateway,
		       const char *metric, const char *interface);

/* Removes the first network.route section matching target+gateway.
 * Returns 0 if removed, 1 if none matched, -1 on error. */
int fnc_uci_del_route(const char *target_cidr, const char *gateway);

#endif
