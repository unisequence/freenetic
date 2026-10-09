#include <stdio.h>
#include <string.h>

#include <uci.h>

#include "uci_util.h"

int fnc_uci_section_type(const char *package, const char *section,
			  char *out, size_t outsz)
{
	struct uci_context *ctx;
	struct uci_ptr ptr;
	char expr[256];
	int ret = -1;

	ctx = uci_alloc_context();
	if (!ctx)
		return -1;

	if (snprintf(expr, sizeof(expr), "%s.%s", package, section) < 0 ||
	    strlen(expr) >= sizeof(expr) - 1) {
		fprintf(stderr, "fnc: uci: выражение слишком длинное\n");
		goto out;
	}
	if (uci_lookup_ptr(ctx, &ptr, expr, true) == UCI_OK &&
	    (ptr.flags & UCI_LOOKUP_COMPLETE) && ptr.s && !ptr.o) {
		strncpy(out, ptr.s->type, outsz - 1);
		out[outsz - 1] = '\0';
		ret = 0;
	}

out:
	uci_free_context(ctx);
	return ret;
}
