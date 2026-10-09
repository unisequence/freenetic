#ifndef FNC_UCI_UTIL_H
#define FNC_UCI_UTIL_H

#include <stddef.h>

/* Looks up the type of package.section into out. */
int fnc_uci_section_type(const char *package, const char *section,
			  char *out, size_t outsz);

#endif
