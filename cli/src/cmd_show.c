#include <stdio.h>
#include <string.h>
#include <time.h>

#include <libubox/blobmsg.h>
#include <libubox/blobmsg_json.h>

#include "cmd_show.h"
#include "exec_util.h"
#include "ubus_util.h"

static unsigned long long attr_u64(struct blob_attr *a)
{
	if (!a)
		return 0;
	switch (blobmsg_type(a)) {
	case BLOBMSG_TYPE_INT64:
		return blobmsg_get_u64(a);
	case BLOBMSG_TYPE_INT32:
		return blobmsg_get_u32(a);
	case BLOBMSG_TYPE_INT16:
		return blobmsg_get_u16(a);
	case BLOBMSG_TYPE_INT8:
		return blobmsg_get_u8(a);
	default:
		return 0;
	}
}

static const char *attr_str(struct blob_attr *a, const char *fallback)
{
	return a ? blobmsg_get_string(a) : fallback;
}

/* ---- show version : ubus call system board -------------------------- */

enum {
	BOARD_KERNEL,
	BOARD_HOSTNAME,
	BOARD_MODEL,
	BOARD_BOARD_NAME,
	BOARD_RELEASE,
	__BOARD_MAX,
};

static const struct blobmsg_policy board_policy[__BOARD_MAX] = {
	[BOARD_KERNEL]     = { "kernel", BLOBMSG_TYPE_STRING },
	[BOARD_HOSTNAME]   = { "hostname", BLOBMSG_TYPE_STRING },
	[BOARD_MODEL]      = { "model", BLOBMSG_TYPE_STRING },
	[BOARD_BOARD_NAME] = { "board_name", BLOBMSG_TYPE_STRING },
	[BOARD_RELEASE]    = { "release", BLOBMSG_TYPE_TABLE },
};

enum {
	RELEASE_DISTRIBUTION,
	RELEASE_VERSION,
	RELEASE_REVISION,
	RELEASE_TARGET,
	RELEASE_DESCRIPTION,
	__RELEASE_MAX,
};

static const struct blobmsg_policy release_policy[__RELEASE_MAX] = {
	[RELEASE_DISTRIBUTION] = { "distribution", BLOBMSG_TYPE_STRING },
	[RELEASE_VERSION]      = { "version", BLOBMSG_TYPE_STRING },
	[RELEASE_REVISION]     = { "revision", BLOBMSG_TYPE_STRING },
	[RELEASE_TARGET]       = { "target", BLOBMSG_TYPE_STRING },
	[RELEASE_DESCRIPTION]  = { "description", BLOBMSG_TYPE_STRING },
};

static void print_board(struct blob_attr *msg, int with_version)
{
	struct blob_attr *tb[__BOARD_MAX];
	struct blob_attr *rel[__RELEASE_MAX];

	blobmsg_parse(board_policy, __BOARD_MAX, tb, blobmsg_data(msg),
		      blobmsg_data_len(msg));

	printf("hostname:    %s\n", attr_str(tb[BOARD_HOSTNAME], "-"));
	printf("model:       %s\n", attr_str(tb[BOARD_MODEL], "-"));
	printf("board:       %s\n", attr_str(tb[BOARD_BOARD_NAME], "-"));

	if (!with_version)
		return;

	if (tb[BOARD_RELEASE]) {
		blobmsg_parse(release_policy, __RELEASE_MAX, rel,
			      blobmsg_data(tb[BOARD_RELEASE]),
			      blobmsg_data_len(tb[BOARD_RELEASE]));
		printf("firmware:    %s\n",
		       attr_str(rel[RELEASE_DESCRIPTION], "-"));
		printf("target:      %s\n",
		       attr_str(rel[RELEASE_TARGET], "-"));
		printf("revision:    %s\n",
		       attr_str(rel[RELEASE_REVISION], "-"));
	}
	printf("kernel:      %s\n", attr_str(tb[BOARD_KERNEL], "-"));
}

static void version_cb(struct ubus_request *req, int type, struct blob_attr *msg)
{
	(void)req;
	(void)type;
	if (msg)
		print_board(msg, 1);
}

int fnc_show_version(struct ubus_context *ctx)
{
	return fnc_ubus_call(ctx, "system", "board", NULL, version_cb, NULL);
}

/* ---- show system : ubus call system board + system info ------------- */

enum {
	INFO_UPTIME,
	INFO_LOAD,
	INFO_MEMORY,
	__INFO_MAX,
};

static const struct blobmsg_policy info_policy[__INFO_MAX] = {
	[INFO_UPTIME] = { "uptime", BLOBMSG_TYPE_INT32 },
	[INFO_LOAD]   = { "load", BLOBMSG_TYPE_ARRAY },
	[INFO_MEMORY] = { "memory", BLOBMSG_TYPE_TABLE },
};

enum {
	MEM_TOTAL,
	MEM_FREE,
	MEM_AVAILABLE,
	__MEM_MAX,
};

static const struct blobmsg_policy mem_policy[__MEM_MAX] = {
	[MEM_TOTAL]     = { "total", BLOBMSG_TYPE_UNSPEC },
	[MEM_FREE]      = { "free", BLOBMSG_TYPE_UNSPEC },
	[MEM_AVAILABLE] = { "available", BLOBMSG_TYPE_UNSPEC },
};

static void print_uptime(unsigned long long secs)
{
	unsigned long long d = secs / 86400;
	unsigned long long h = (secs % 86400) / 3600;
	unsigned long long m = (secs % 3600) / 60;

	printf("uptime:      %llud %lluh %llum\n", d, h, m);
}

static void print_load(struct blob_attr *load)
{
	struct blob_attr *cur;
	double v[3] = { 0, 0, 0 };
	int rem, i = 0;

	if (!load)
		return;

	blobmsg_for_each_attr(cur, load, rem) {
		if (i >= 3)
			break;
		v[i++] = (double)attr_u64(cur) / 65536.0;
	}
	printf("load avg:    %.2f %.2f %.2f\n", v[0], v[1], v[2]);
}

static void print_memory(struct blob_attr *mem)
{
	struct blob_attr *tb[__MEM_MAX];

	if (!mem)
		return;
	blobmsg_parse(mem_policy, __MEM_MAX, tb, blobmsg_data(mem),
		      blobmsg_data_len(mem));
	printf("memory:      %llu MiB total, %llu MiB free, %llu MiB available\n",
	       attr_u64(tb[MEM_TOTAL]) / 1048576,
	       attr_u64(tb[MEM_FREE]) / 1048576,
	       attr_u64(tb[MEM_AVAILABLE]) / 1048576);
}

static void system_info_cb(struct ubus_request *req, int type, struct blob_attr *msg)
{
	struct blob_attr *tb[__INFO_MAX];

	(void)req;
	(void)type;
	if (!msg)
		return;
	blobmsg_parse(info_policy, __INFO_MAX, tb, blobmsg_data(msg),
		      blobmsg_data_len(msg));

	print_uptime(attr_u64(tb[INFO_UPTIME]));
	print_load(tb[INFO_LOAD]);
	print_memory(tb[INFO_MEMORY]);
}

static void system_board_cb(struct ubus_request *req, int type, struct blob_attr *msg)
{
	(void)req;
	(void)type;
	if (msg)
		print_board(msg, 0);
}

int fnc_show_system(struct ubus_context *ctx)
{
	int ret = fnc_ubus_call(ctx, "system", "board", NULL,
				 system_board_cb, NULL);
	ret |= fnc_ubus_call(ctx, "system", "info", NULL,
			      system_info_cb, NULL);
	return ret;
}

/* ---- show interface / show ip : ubus call network.interface dump ---- */

enum {
	DUMP_INTERFACE,
	__DUMP_MAX,
};

static const struct blobmsg_policy dump_policy[__DUMP_MAX] = {
	[DUMP_INTERFACE] = { "interface", BLOBMSG_TYPE_ARRAY },
};

enum {
	IF_INTERFACE,
	IF_UP,
	IF_DEVICE,
	IF_L3_DEVICE,
	IF_PROTO,
	IF_IPV4,
	IF_IPV6,
	__IF_MAX,
};

static const struct blobmsg_policy if_policy[__IF_MAX] = {
	[IF_INTERFACE] = { "interface", BLOBMSG_TYPE_STRING },
	[IF_UP]        = { "up", BLOBMSG_TYPE_BOOL },
	[IF_DEVICE]    = { "device", BLOBMSG_TYPE_STRING },
	[IF_L3_DEVICE] = { "l3_device", BLOBMSG_TYPE_STRING },
	[IF_PROTO]     = { "proto", BLOBMSG_TYPE_STRING },
	[IF_IPV4]      = { "ipv4-address", BLOBMSG_TYPE_ARRAY },
	[IF_IPV6]      = { "ipv6-address", BLOBMSG_TYPE_ARRAY },
};

enum {
	ADDR_ADDRESS,
	ADDR_MASK,
	__ADDR_MAX,
};

static const struct blobmsg_policy addr_policy[__ADDR_MAX] = {
	[ADDR_ADDRESS] = { "address", BLOBMSG_TYPE_STRING },
	[ADDR_MASK]    = { "mask", BLOBMSG_TYPE_INT32 },
};

static void print_addresses(struct blob_attr *arr, const char *label)
{
	struct blob_attr *cur;
	int rem;

	if (!arr)
		return;

	blobmsg_for_each_attr(cur, arr, rem) {
		struct blob_attr *tb[__ADDR_MAX];

		blobmsg_parse(addr_policy, __ADDR_MAX, tb,
			      blobmsg_data(cur), blobmsg_data_len(cur));
		if (!tb[ADDR_ADDRESS])
			continue;
		printf("  %s: %s/%llu\n", label,
		       blobmsg_get_string(tb[ADDR_ADDRESS]),
		       attr_u64(tb[ADDR_MASK]));
	}
}

struct dump_ctx {
	const char *filter;
	int ip_only;
};

static void dump_cb(struct ubus_request *req, int type, struct blob_attr *msg)
{
	struct dump_ctx *dctx = req->priv;
	struct blob_attr *tb[__DUMP_MAX];
	struct blob_attr *cur;
	int rem;

	(void)type;
	if (!msg)
		return;
	blobmsg_parse(dump_policy, __DUMP_MAX, tb, blobmsg_data(msg),
		      blobmsg_data_len(msg));
	if (!tb[DUMP_INTERFACE])
		return;

	blobmsg_for_each_attr(cur, tb[DUMP_INTERFACE], rem) {
		struct blob_attr *itb[__IF_MAX];
		const char *name;

		blobmsg_parse(if_policy, __IF_MAX, itb, blobmsg_data(cur),
			      blobmsg_data_len(cur));
		if (!itb[IF_INTERFACE])
			continue;
		name = blobmsg_get_string(itb[IF_INTERFACE]);
		if (dctx->filter && strcmp(dctx->filter, name) != 0)
			continue;

		if (dctx->ip_only) {
			printf("interface %s (%s):\n", name,
			       itb[IF_UP] && blobmsg_get_bool(itb[IF_UP]) ?
			       "up" : "down");
			print_addresses(itb[IF_IPV4], "ipv4");
			print_addresses(itb[IF_IPV6], "ipv6");
		} else {
			printf("interface:   %s\n", name);
			printf("  status:    %s\n",
			       itb[IF_UP] && blobmsg_get_bool(itb[IF_UP]) ?
			       "up" : "down");
			printf("  proto:     %s\n",
			       attr_str(itb[IF_PROTO], "-"));
			printf("  device:    %s\n",
			       attr_str(itb[IF_L3_DEVICE],
					attr_str(itb[IF_DEVICE], "-")));
			print_addresses(itb[IF_IPV4], "ipv4");
			print_addresses(itb[IF_IPV6], "ipv6");
		}
	}
}

static int show_dump(struct ubus_context *ctx, const char *filter, int ip_only)
{
	struct dump_ctx dctx = { .filter = filter, .ip_only = ip_only };
	uint32_t id;

	if (ubus_lookup_id(ctx, "network.interface", &id)) {
		fprintf(stderr, "fnc: объект ubus 'network.interface' не найден\n");
		return -1;
	}
	if (ubus_invoke(ctx, id, "dump", NULL, dump_cb, &dctx, 3000)) {
		fprintf(stderr, "fnc: network.interface->dump не удался\n");
		return -1;
	}
	return 0;
}

int fnc_show_interface(struct ubus_context *ctx, const char *filter)
{
	return show_dump(ctx, filter, 0);
}

int fnc_show_ip(struct ubus_context *ctx, const char *filter)
{
	return show_dump(ctx, filter, 1);
}

int fnc_show_running_config(void)
{
	char *argv[] = { "uci", "export", NULL };

	return fnc_run(argv);
}

int fnc_show_arp(void)
{
	char *argv[] = { "ip", "neigh", "show", NULL };

	return fnc_run(argv);
}

int fnc_show_mac_table(void)
{
	char *argv[] = { "bridge", "fdb", "show", NULL };

	return fnc_run(argv);
}
