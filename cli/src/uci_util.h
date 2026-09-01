#ifndef FNC_UCI_UTIL_H
#define FNC_UCI_UTIL_H

#include <stddef.h>

/* Sets package.section.option = value and commits it to disk (does not
 * apply it — callers reload the relevant service themselves, e.g. via
 * ubus). Returns 0 on success. */
int fnc_uci_set(const char *package, const char *section,
		 const char *option, const char *value);

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
