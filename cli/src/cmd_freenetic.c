#include <errno.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/wait.h>
#include <unistd.h>

#include <json-c/json.h>
#include <libubox/blobmsg.h>
#include <uci.h>

#include "cmd_freenetic.h"
#include "ubus_util.h"

#define HELPER_OUTPUT_MAX 65536

static const char *json_string(struct json_object *obj, const char *key,
			       const char *fallback)
{
	struct json_object *value;

	return obj && json_object_object_get_ex(obj, key, &value) &&
	       json_object_is_type(value, json_type_string) ?
		json_object_get_string(value) : fallback;
}

static int json_field_bool(struct json_object *obj, const char *key)
{
	struct json_object *value;

	return obj && json_object_object_get_ex(obj, key, &value) &&
	       json_object_get_boolean(value);
}

/* Fixed executable path and argv: no shell, no command interpolation. */
static struct json_object *helper_json(const char *path, char *const argv[])
{
	char output[HELPER_OUTPUT_MAX + 1];
	struct json_object *result;
	int fds[2], status;
	size_t used = 0;
	ssize_t n;
	pid_t pid;
	int read_error = 0;

	if (pipe(fds) != 0) {
		perror("fnc: pipe");
		return NULL;
	}
	pid = fork();
	if (pid < 0) {
		perror("fnc: fork");
		close(fds[0]);
		close(fds[1]);
		return NULL;
	}
	if (pid == 0) {
		close(fds[0]);
		if (dup2(fds[1], STDOUT_FILENO) < 0)
			_exit(127);
		close(fds[1]);
		execv(path, argv);
		_exit(127);
	}
	close(fds[1]);
	while (used < HELPER_OUTPUT_MAX) {
		n = read(fds[0], output + used, HELPER_OUTPUT_MAX - used);
		if (n > 0)
			used += (size_t)n;
		else if (n == 0)
			break;
		else if (errno != EINTR) {
			read_error = 1;
			break;
		}
	}
	if (!read_error && used == HELPER_OUTPUT_MAX) {
		char extra;
		do {
			n = read(fds[0], &extra, 1);
		} while (n < 0 && errno == EINTR);
		if (n > 0)
			used = HELPER_OUTPUT_MAX + 1;
		else if (n < 0)
			read_error = 1;
	}
	close(fds[0]);
	do {
		n = waitpid(pid, &status, 0);
	} while (n < 0 && errno == EINTR);
	if (n < 0 || !WIFEXITED(status) || WEXITSTATUS(status) != 0 ||
	    used > HELPER_OUTPUT_MAX || read_error) {
		fprintf(stderr, "fnc: помощник %s не ответил\n", path);
		return NULL;
	}
	output[used] = '\0';
	result = json_tokener_parse(output);
	if (!result || !json_object_is_type(result, json_type_object)) {
		fprintf(stderr, "fnc: неверный ответ %s\n", path);
		json_object_put(result);
		return NULL;
	}
	if (!json_field_bool(result, "ok")) {
		fprintf(stderr, "fnc: %s: %s\n", path,
			json_string(result, "error", "операция недоступна"));
		json_object_put(result);
		return NULL;
	}
	return result;
}

int fnc_show_multiwan(void)
{
	const char *path = "/usr/libexec/freenetic-multiwan";
	char *const argv[] = { (char *)path, "status", NULL };
	struct json_object *result = helper_json(path, argv), *interfaces, *entry;
	int count;

	if (!result)
		return -1;
	printf("ready:      %s\n", json_field_bool(result, "ready") ? "yes" : "no");
	printf("mode:       %s\n", json_string(result, "mode", "-"));
	printf("policy:     %s\n", json_string(result, "policy", "-"));
	if (json_object_object_get_ex(result, "interfaces", &interfaces) &&
	    json_object_is_type(interfaces, json_type_array)) {
		count = json_object_array_length(interfaces);
		for (int i = 0; i < count; i++) {
			entry = json_object_array_get_idx(interfaces, i);
			printf("%-12s %-9s %-12s %s\n",
				json_string(entry, "name", "-"),
				json_string(entry, "state", "unknown"),
				json_string(entry, "device", "-"),
				json_string(entry, "label", ""));
		}
	}
	json_object_put(result);
	return 0;
}

static int valid_package(const char *name)
{
	if (!name || !*name || *name == '-' || strlen(name) > 100)
		return 0;
	for (const char *p = name; *p; p++)
		if (!((*p >= 'A' && *p <= 'Z') || (*p >= 'a' && *p <= 'z') ||
		      (*p >= '0' && *p <= '9') || strchr("+_.:@/-", *p)))
			return 0;
	return 1;
}

int fnc_show_applications(const char *package)
{
	const char *path = "/usr/libexec/freenetic-package-status";
	static const char *defaults[] = {
		"mwan3", "wireguard-tools", "openvpn-openssl", "tailscale",
		"https-dns-proxy", "adblock", "ddns-scripts", "miniupnpd-nftables",
		"luci-app-freenetic", NULL
	};
	char *argv[12] = { (char *)path };
	struct json_object *result, *packages, *state;
	int i = 1;

	if (package && !valid_package(package)) {
		fprintf(stderr, "fnc: неверное имя пакета\n");
		return -1;
	}
	if (package)
		argv[i++] = (char *)package;
	else
		for (int j = 0; defaults[j]; j++)
			argv[i++] = (char *)defaults[j];
	argv[i] = NULL;
	result = helper_json(path, argv);
	if (!result)
		return -1;
	if (!json_object_object_get_ex(result, "packages", &packages) ||
	    !json_object_is_type(packages, json_type_object)) {
		fprintf(stderr, "fnc: нет данных о пакетах\n");
		json_object_put(result);
		return -1;
	}
	for (int j = 1; j < i; j++) {
		if (!json_object_object_get_ex(packages, argv[j], &state))
			continue;
		printf("%-26s %-12s %s\n", argv[j],
			json_field_bool(state, "installed") ? "installed" : "not installed",
			json_field_bool(state, "available") ? "available" : "not in feed");
	}
	json_object_put(result);
	return 0;
}

enum { IF_NAME, IF_UP, IF_DEVICE, IF_IPV4, IF_IPV6, IF_DNS, IF_MAX };
static const struct blobmsg_policy iface_policy[IF_MAX] = {
	[IF_NAME] = { "interface", BLOBMSG_TYPE_STRING },
	[IF_UP] = { "up", BLOBMSG_TYPE_BOOL },
	[IF_DEVICE] = { "l3_device", BLOBMSG_TYPE_STRING },
	[IF_IPV4] = { "ipv4-address", BLOBMSG_TYPE_ARRAY },
	[IF_IPV6] = { "ipv6-address", BLOBMSG_TYPE_ARRAY },
	[IF_DNS] = { "dns-server", BLOBMSG_TYPE_ARRAY },
};

static void print_string_array(struct blob_attr *arr, const char *label)
{
	struct blob_attr *entry;
	int rem;

	if (!arr)
		return;
	blobmsg_for_each_attr(entry, arr, rem)
		if (blobmsg_type(entry) == BLOBMSG_TYPE_STRING)
			printf("  %s: %s\n", label, blobmsg_get_string(entry));
}

static void print_addresses(struct blob_attr *arr)
{
	static const struct blobmsg_policy policy[] = {
		{ "address", BLOBMSG_TYPE_STRING },
		{ "mask", BLOBMSG_TYPE_INT32 },
	};
	struct blob_attr *entry;
	int rem;

	if (!arr)
		return;
	blobmsg_for_each_attr(entry, arr, rem) {
		struct blob_attr *tb[2];
		blobmsg_parse(policy, 2, tb, blobmsg_data(entry), blobmsg_data_len(entry));
		if (tb[0])
			printf("  address: %s/%u\n", blobmsg_get_string(tb[0]),
			       tb[1] ? blobmsg_get_u32(tb[1]) : 0);
	}
}

struct network_view {
	int dns;
	int found;
	struct uci_context *uci;
	struct uci_package *mwan;
};

static int is_wan(struct network_view *view, const char *name)
{
	struct uci_section *section;

	if (strcmp(name, "wan") == 0 || strcmp(name, "wan6") == 0 ||
	    strcmp(name, "fnwwan") == 0)
		return 1;
	if (!view->uci || !view->mwan)
		return 0;
	section = uci_lookup_section(view->uci, view->mwan, name);
	return section && strcmp(section->type, "interface") == 0;
}

static void network_cb(struct ubus_request *req, int type, struct blob_attr *msg)
{
	static const struct blobmsg_policy policy[] = {
		{ "interface", BLOBMSG_TYPE_ARRAY },
	};
	struct network_view *view = req->priv;
	struct blob_attr *tb[1], *entry;
	int rem;

	(void)type;
	if (!msg)
		return;
	blobmsg_parse(policy, 1, tb, blobmsg_data(msg), blobmsg_data_len(msg));
	if (!tb[0])
		return;
	blobmsg_for_each_attr(entry, tb[0], rem) {
		struct blob_attr *itb[IF_MAX];
		const char *name;

		blobmsg_parse(iface_policy, IF_MAX, itb,
			      blobmsg_data(entry), blobmsg_data_len(entry));
		if (!itb[IF_NAME])
			continue;
		name = blobmsg_get_string(itb[IF_NAME]);
		if (view->dns) {
			if (!itb[IF_DNS] || blobmsg_data_len(itb[IF_DNS]) == 0)
				continue;
			printf("%s:\n", name);
			print_string_array(itb[IF_DNS], "resolver");
		} else {
			if (!is_wan(view, name))
				continue;
			printf("%s: %s (%s)\n", name,
				itb[IF_UP] && blobmsg_get_bool(itb[IF_UP]) ? "up" : "down",
				itb[IF_DEVICE] ? blobmsg_get_string(itb[IF_DEVICE]) : "-");
			print_addresses(itb[IF_IPV4]);
			print_addresses(itb[IF_IPV6]);
			print_string_array(itb[IF_DNS], "dns");
		}
		view->found = 1;
	}
}

static int network_dump(struct ubus_context *ctx, struct network_view *view)
{
	return fnc_ubus_call(ctx, "network.interface", "dump", NULL,
			     network_cb, view);
}

int fnc_show_wan(struct ubus_context *ctx)
{
	struct network_view view = { 0 };
	int ret;

	view.uci = uci_alloc_context();
	if (view.uci)
		uci_load(view.uci, "mwan3", &view.mwan);
	ret = network_dump(ctx, &view);
	if (view.uci)
		uci_free_context(view.uci);

	if (ret != 0)
		return -1;
	if (!view.found)
		puts("WAN interfaces: none");
	return 0;
}

int fnc_show_dns(struct ubus_context *ctx)
{
	struct network_view view = { .dns = 1 };
	struct uci_context *uci = uci_alloc_context();
	struct uci_package *pkg = NULL;
	struct uci_element *element;

	if (network_dump(ctx, &view) != 0) {
		if (uci)
			uci_free_context(uci);
		return -1;
	}
	if (!view.found)
		puts("Interface resolvers: none");
	if (uci && uci_load(uci, "dhcp", &pkg) == UCI_OK) {
		uci_foreach_element(&pkg->sections, element) {
			struct uci_section *section = uci_to_section(element);
			struct uci_option *servers;
			struct uci_element *server;
			const char *value;

			if (strcmp(section->type, "dnsmasq") != 0)
				continue;
			printf("dnsmasq %s:\n", section->e.name);
			value = uci_lookup_option_string(uci, section, "noresolv");
			printf("  use interface resolvers: %s\n",
			       value && strcmp(value, "1") == 0 ? "no" : "yes");
			value = uci_lookup_option_string(uci, section, "resolvfile");
			if (value)
				printf("  resolvfile: %s\n", value);
			servers = uci_lookup_option(uci, section, "server");
			if (servers && servers->type == UCI_TYPE_STRING)
				printf("  forwarder: %s\n", servers->v.string);
			if (servers && servers->type == UCI_TYPE_LIST)
				uci_foreach_element(&servers->v.list, server)
					printf("  forwarder: %s\n", server->name);
		}
	}
	if (uci)
		uci_free_context(uci);
	return 0;
}
