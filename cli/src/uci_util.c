#include <stdio.h>
#include <string.h>

#include <uci.h>

#include "uci_util.h"

int fnc_uci_set(const char *package, const char *section,
		 const char *option, const char *value)
{
	struct uci_context *ctx;
	struct uci_ptr ptr;
	char expr[256];
	int ret = -1;

	ctx = uci_alloc_context();
	if (!ctx)
		return -1;

	snprintf(expr, sizeof(expr), "%s.%s.%s=%s", package, section,
		 option, value);
	if (uci_lookup_ptr(ctx, &ptr, expr, true) != UCI_OK) {
		fprintf(stderr, "fnc: uci: не удалось разобрать '%s'\n", expr);
		goto out;
	}
	if (uci_set(ctx, &ptr) != UCI_OK) {
		fprintf(stderr, "fnc: uci: set не удался\n");
		goto out;
	}
	if (uci_commit(ctx, &ptr.p, false) != UCI_OK) {
		fprintf(stderr, "fnc: uci: commit не удался\n");
		goto out;
	}
	ret = 0;
out:
	uci_free_context(ctx);
	return ret;
}

static int set_option(struct uci_context *ctx, struct uci_package *pkg,
		       struct uci_section *sec, const char *option,
		       const char *value)
{
	struct uci_ptr ptr = {
		.p = pkg,
		.s = sec,
		.option = option,
		.value = value,
	};

	return uci_set(ctx, &ptr) == UCI_OK ? 0 : -1;
}

int fnc_uci_add_route(const char *target_cidr, const char *gateway,
		       const char *metric, const char *interface)
{
	struct uci_context *ctx;
	struct uci_package *pkg = NULL;
	struct uci_section *sec = NULL;
	int ret = -1;

	ctx = uci_alloc_context();
	if (!ctx)
		return -1;

	if (uci_load(ctx, "network", &pkg) != UCI_OK) {
		fprintf(stderr, "fnc: uci: не удалось загрузить network\n");
		goto out;
	}
	if (uci_add_section(ctx, pkg, "route", &sec) != UCI_OK) {
		fprintf(stderr, "fnc: uci: add_section route не удался\n");
		goto out;
	}
	if (set_option(ctx, pkg, sec, "target", target_cidr) != 0 ||
	    set_option(ctx, pkg, sec, "gateway", gateway) != 0 ||
	    (metric && set_option(ctx, pkg, sec, "metric", metric) != 0) ||
	    (interface && set_option(ctx, pkg, sec, "interface", interface) != 0)) {
		fprintf(stderr, "fnc: uci: set не удался\n");
		goto out;
	}
	if (uci_commit(ctx, &pkg, false) != UCI_OK) {
		fprintf(stderr, "fnc: uci: commit не удался\n");
		goto out;
	}
	ret = 0;
out:
	uci_free_context(ctx);
	return ret;
}

/* Удаляет первую секцию network.route с совпадающими target+gateway.
 * Возвращает 0 если что-то удалено, 1 если не нашли, -1 при ошибке. */
int fnc_uci_del_route(const char *target_cidr, const char *gateway)
{
	struct uci_context *ctx;
	struct uci_package *pkg = NULL;
	struct uci_element *e, *tmp;
	struct uci_section *match = NULL;
	int ret = -1;

	ctx = uci_alloc_context();
	if (!ctx)
		return -1;

	if (uci_load(ctx, "network", &pkg) != UCI_OK) {
		fprintf(stderr, "fnc: uci: не удалось загрузить network\n");
		goto out;
	}

	uci_foreach_element_safe(&pkg->sections, tmp, e) {
		struct uci_section *s = uci_to_section(e);
		const char *t, *g;

		if (strcmp(s->type, "route") != 0)
			continue;
		t = uci_lookup_option_string(ctx, s, "target");
		g = uci_lookup_option_string(ctx, s, "gateway");
		if (t && g && strcmp(t, target_cidr) == 0 && strcmp(g, gateway) == 0) {
			match = s;
			break;
		}
	}

	if (!match) {
		ret = 1;
		goto out;
	}

	{
		struct uci_ptr ptr = { .p = pkg, .s = match };

		if (uci_delete(ctx, &ptr) != UCI_OK) {
			fprintf(stderr, "fnc: uci: delete не удался\n");
			goto out;
		}
	}
	if (uci_commit(ctx, &pkg, false) != UCI_OK) {
		fprintf(stderr, "fnc: uci: commit не удался\n");
		goto out;
	}
	ret = 0;
out:
	uci_free_context(ctx);
	return ret;
}

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

	snprintf(expr, sizeof(expr), "%s.%s", package, section);
	if (uci_lookup_ptr(ctx, &ptr, expr, true) == UCI_OK &&
	    (ptr.flags & UCI_LOOKUP_COMPLETE) && ptr.s) {
		strncpy(out, ptr.s->type, outsz - 1);
		out[outsz - 1] = '\0';
		ret = 0;
	}

	uci_free_context(ctx);
	return ret;
}
