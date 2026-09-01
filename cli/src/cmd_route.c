#include <arpa/inet.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

#include <libubox/blobmsg.h>

#include "cmd_route.h"
#include "exec_util.h"
#include "ubus_util.h"
#include "uci_util.h"

enum {
	IF_NAME,
	IF_IPV4,
	__IF_MAX,
};

static const struct blobmsg_policy if_policy[__IF_MAX] = {
	[IF_NAME] = { "interface", BLOBMSG_TYPE_STRING },
	[IF_IPV4] = { "ipv4-address", BLOBMSG_TYPE_ARRAY },
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

struct find_if_ctx {
	struct in_addr gw;
	char found[64];
};

static int addr_covers(const char *addr_str, int prefix, struct in_addr gw)
{
	struct in_addr net;
	uint32_t mask;

	if (inet_pton(AF_INET, addr_str, &net) != 1)
		return 0;
	mask = prefix == 0 ? 0 : htonl(~0u << (32 - prefix));
	return (net.s_addr & mask) == (gw.s_addr & mask);
}

static void find_if_cb(struct ubus_request *req, int type, struct blob_attr *msg)
{
	struct find_if_ctx *fctx = req->priv;
	struct blob_attr *dtb[2] = { NULL, NULL };
	struct blob_attr *cur;
	int rem;

	(void)type;
	if (!msg || fctx->found[0])
		return;

	/* msg here is the top-level {"interface":[...]} from network.interface dump */
	static const struct blobmsg_policy dump_policy[1] = {
		{ "interface", BLOBMSG_TYPE_ARRAY },
	};
	blobmsg_parse(dump_policy, 1, dtb, blobmsg_data(msg), blobmsg_data_len(msg));
	if (!dtb[0])
		return;

	blobmsg_for_each_attr(cur, dtb[0], rem) {
		struct blob_attr *itb[__IF_MAX];
		struct blob_attr *a;
		int r2;

		blobmsg_parse(if_policy, __IF_MAX, itb, blobmsg_data(cur),
			      blobmsg_data_len(cur));
		if (!itb[IF_NAME] || !itb[IF_IPV4])
			continue;

		blobmsg_for_each_attr(a, itb[IF_IPV4], r2) {
			struct blob_attr *atb[__ADDR_MAX];

			blobmsg_parse(addr_policy, __ADDR_MAX, atb,
				      blobmsg_data(a), blobmsg_data_len(a));
			if (!atb[ADDR_ADDRESS])
				continue;
			if (addr_covers(blobmsg_get_string(atb[ADDR_ADDRESS]),
					 atb[ADDR_MASK] ? blobmsg_get_u32(atb[ADDR_MASK]) : 32,
					 fctx->gw)) {
				strncpy(fctx->found, blobmsg_get_string(itb[IF_NAME]),
					sizeof(fctx->found) - 1);
				return;
			}
		}
	}
}

/* Finds which logical interface's subnet the gateway falls into, so
 * the uci route section can be tied to it (netifd silently ignores a
 * route with no "interface" option). Returns NULL if none matched. */
static const char *find_interface_for_gateway(struct ubus_context *ctx,
					       const char *gateway, char *buf,
					       size_t bufsz)
{
	struct find_if_ctx fctx = { .found = "" };
	uint32_t id;

	if (inet_pton(AF_INET, gateway, &fctx.gw) != 1)
		return NULL;
	if (ubus_lookup_id(ctx, "network.interface", &id))
		return NULL;
	ubus_invoke(ctx, id, "dump", NULL, find_if_cb, &fctx, 3000);
	if (!fctx.found[0])
		return NULL;
	strncpy(buf, fctx.found, bufsz - 1);
	buf[bufsz - 1] = '\0';
	return buf;
}

int fnc_show_ip_route(void)
{
	char *argv[] = { "ip", "route", "show", NULL };

	return fnc_run(argv);
}

static int valid_ipv4(const char *addr)
{
	struct in_addr in;

	return inet_pton(AF_INET, addr, &in) == 1;
}

/* "10.0.0.0/24" -> validates the network address and a 0-32 prefix. */
static int valid_ipv4_cidr(const char *cidr)
{
	char addr[INET_ADDRSTRLEN + 1];
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
	if (!valid_ipv4(addr))
		return 0;

	prefix = strtol(slash + 1, &end, 10);
	if (*end != '\0' || prefix < 0 || prefix > 32)
		return 0;
	return 1;
}

int fnc_ip_route_add(struct ubus_context *ctx, const char *target_cidr,
		      const char *gateway, const char *metric)
{
	char ifbuf[64];
	const char *ifname;

	if (!valid_ipv4_cidr(target_cidr)) {
		fprintf(stderr, "fnc: сеть должна быть в формате A.B.C.D/N\n");
		return -1;
	}
	if (!valid_ipv4(gateway)) {
		fprintf(stderr, "fnc: шлюз должен быть IPv4-адресом\n");
		return -1;
	}

	ifname = find_interface_for_gateway(ctx, gateway, ifbuf, sizeof(ifbuf));
	if (!ifname)
		fprintf(stderr, "fnc: не нашёл интерфейс с подсетью для шлюза %s "
				 "— маршрут добавлю, но netifd может его проигнорировать\n",
			gateway);

	if (fnc_uci_add_route(target_cidr, gateway, metric, ifname) != 0)
		return -1;

	printf("маршрут %s via %s сохранён, применяю (network reload)...\n",
	       target_cidr, gateway);
	fnc_ubus_call(ctx, "network", "reload", NULL, NULL, NULL);
	return 0;
}

int fnc_ip_route_del(struct ubus_context *ctx, const char *target_cidr,
		      const char *gateway)
{
	int ret = fnc_uci_del_route(target_cidr, gateway);

	if (ret < 0)
		return -1;
	if (ret == 1) {
		fprintf(stderr, "fnc: маршрут %s via %s не найден\n", target_cidr, gateway);
		return -1;
	}

	printf("маршрут %s via %s удалён, применяю (network reload)...\n",
	       target_cidr, gateway);
	fnc_ubus_call(ctx, "network", "reload", NULL, NULL, NULL);
	return 0;
}
