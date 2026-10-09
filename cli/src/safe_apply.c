#include <errno.h>
#include <fcntl.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

#include <libubox/blobmsg.h>
#include <uci.h>

#include "safe_apply.h"

#define FNC_STATE_PATH "/var/run/fnc-apply"
#define FNC_APPLY_TIMEOUT 90
#define FNC_SESSION_TIMEOUT 180

struct pending_state {
	char sid[33];
	long long deadline;
};

static long long monotonic_seconds(void)
{
	struct timespec now;

	return clock_gettime(CLOCK_MONOTONIC, &now) == 0 ? now.tv_sec : -1;
}

static int call(struct ubus_context *ctx, const char *object,
		const char *method, struct blob_attr *msg,
		ubus_data_handler_t cb, void *priv)
{
	uint32_t id;
	int ret;

	ret = ubus_lookup_id(ctx, object, &id);
	if (!ret)
		ret = ubus_invoke(ctx, id, method, msg, cb, priv, 30000);
	if (ret && !(ret == UBUS_STATUS_NO_DATA && strcmp(object, "uci") == 0 &&
		     (strcmp(method, "confirm") == 0 ||
		      strcmp(method, "rollback") == 0)))
		fprintf(stderr, "fnc: %s->%s: %s\n", object, method,
			ubus_strerror(ret));
	return ret;
}

static int call_session(struct ubus_context *ctx, const char *object,
			const char *method, const char *sid)
{
	struct blob_buf buf = { 0 };
	int ret;

	blob_buf_init(&buf, 0);
	blobmsg_add_string(&buf, "ubus_rpc_session", sid);
	ret = call(ctx, object, method, buf.head, NULL, NULL);
	blob_buf_free(&buf);
	return ret;
}

static void session_cb(struct ubus_request *req, int type, struct blob_attr *msg)
{
	static const struct blobmsg_policy policy[] = {
		{ "ubus_rpc_session", BLOBMSG_TYPE_STRING },
	};
	struct pending_state *state = req->priv;
	struct blob_attr *tb[1];
	const char *sid;

	(void)type;
	if (!msg)
		return;
	blobmsg_parse(policy, 1, tb, blobmsg_data(msg), blobmsg_data_len(msg));
	if (!tb[0])
		return;
	sid = blobmsg_get_string(tb[0]);
	if (strlen(sid) == 32)
		snprintf(state->sid, sizeof(state->sid), "%s", sid);
}

static int create_session(struct ubus_context *ctx, struct pending_state *state)
{
	struct blob_buf buf = { 0 };
	int ret;

	blob_buf_init(&buf, 0);
	blobmsg_add_u32(&buf, "timeout", FNC_SESSION_TIMEOUT);
	ret = call(ctx, "session", "create", buf.head, session_cb, state);
	blob_buf_free(&buf);
	if (!ret && !state->sid[0]) {
		fprintf(stderr, "fnc: session не вернула идентификатор\n");
		return -1;
	}
	return ret;
}

static int grant_network(struct ubus_context *ctx, const char *sid)
{
	struct blob_buf buf = { 0 };
	void *objects, *entry;
	int ret;

	blob_buf_init(&buf, 0);
	blobmsg_add_string(&buf, "ubus_rpc_session", sid);
	blobmsg_add_string(&buf, "scope", "uci");
	objects = blobmsg_open_array(&buf, "objects");
	entry = blobmsg_open_array(&buf, NULL);
	blobmsg_add_string(&buf, NULL, "network");
	blobmsg_add_string(&buf, NULL, "write");
	blobmsg_close_array(&buf, entry);
	blobmsg_close_array(&buf, objects);
	ret = call(ctx, "session", "grant", buf.head, NULL, NULL);
	blob_buf_free(&buf);
	return ret;
}

static int read_state(struct pending_state *state)
{
	char data[96];
	struct stat st;
	ssize_t n;
	int fd = open(FNC_STATE_PATH, O_RDONLY | O_NOFOLLOW | O_CLOEXEC);

	if (fd < 0)
		return -1;
	if (fstat(fd, &st) != 0 || !S_ISREG(st.st_mode) || st.st_uid != 0 ||
	    (st.st_mode & 077) != 0) {
		close(fd);
		return -1;
	}
	n = read(fd, data, sizeof(data) - 1);
	close(fd);
	if (n <= 0)
		return -1;
	data[n] = '\0';
	memset(state, 0, sizeof(*state));
	if (sscanf(data, "%32[0-9a-f] %lld", state->sid,
		   &state->deadline) != 2 || strlen(state->sid) != 32)
		return -1;
	return 0;
}

static int write_state(int fd, const struct pending_state *state)
{
	char data[96];
	int len = snprintf(data, sizeof(data), "%s %lld\n",
			   state->sid, state->deadline);

	return len > 0 && len < (int)sizeof(data) &&
	       write(fd, data, (size_t)len) == len ? 0 : -1;
}

static int reserve_state(struct ubus_context *ctx)
{
	struct pending_state previous;
	long long now;
	int fd, ret;

	for (int attempt = 0; attempt < 2; attempt++) {
		fd = open(FNC_STATE_PATH, O_WRONLY | O_CREAT | O_EXCL |
			  O_NOFOLLOW | O_CLOEXEC, 0600);
		if (fd >= 0)
			return fd;
		if (errno != EEXIST)
			break;
		now = monotonic_seconds();
		if (read_state(&previous) != 0 || now < 0 ||
		    now <= previous.deadline + 2) {
			fprintf(stderr, "fnc: уже есть неподтверждённое изменение; используйте 'fnc pending', 'fnc confirm' или 'fnc rollback'\n");
			return -1;
		}
		ret = call_session(ctx, "uci", "rollback", previous.sid);
		if (ret && ret != UBUS_STATUS_NO_DATA)
			return -1;
		call_session(ctx, "session", "destroy", previous.sid);
		unlink(FNC_STATE_PATH);
	}
	perror("fnc: не удалось создать состояние применения");
	return -1;
}

static int option_exists(const char *section, const char *option)
{
	struct uci_context *uci = uci_alloc_context();
	struct uci_package *pkg = NULL;
	struct uci_section *sec;
	int found = -1;

	if (!uci)
		return -1;
	if (uci_load(uci, "network", &pkg) == UCI_OK &&
	    (sec = uci_lookup_section(uci, pkg, section)))
		found = uci_lookup_option(uci, sec, option) != NULL;
	uci_free_context(uci);
	return found;
}

static int wireless_network(const char *name)
{
	struct uci_context *uci = uci_alloc_context();
	struct uci_package *pkg = NULL;
	struct uci_element *element;
	int found = 0;

	if (!uci)
		return 1;
	if (uci_load(uci, "wireless", &pkg) != UCI_OK) {
		found = access("/etc/config/wireless", F_OK) == 0;
		goto out;
	}
	uci_foreach_element(&pkg->sections, element) {
		struct uci_section *sec = uci_to_section(element);
		struct uci_option *network;

		if (strcmp(sec->type, "wifi-iface") != 0)
			continue;
		network = uci_lookup_option(uci, sec, "network");
		if (!network)
			continue;
		if (network->type == UCI_TYPE_LIST) {
			struct uci_element *entry;
			uci_foreach_element(&network->v.list, entry)
				if (strcmp(entry->name, name) == 0)
					found = 1;
		} else if (network->type == UCI_TYPE_STRING) {
			char *copy = strdup(network->v.string), *save = NULL, *token;
			if (!copy) {
				found = 1;
				break;
			}
			for (token = strtok_r(copy, " \t", &save); token;
			     token = strtok_r(NULL, " \t", &save))
				if (strcmp(token, name) == 0)
					found = 1;
			free(copy);
		}
		if (found)
			break;
	}
out:
	uci_free_context(uci);
	return found;
}

static int find_route(const char *target, const char *gateway,
		      char *name, size_t namesz)
{
	struct uci_context *uci = uci_alloc_context();
	struct uci_package *pkg = NULL;
	struct uci_element *element;
	int found = 0;

	if (!uci)
		return -1;
	if (uci_load(uci, "network", &pkg) != UCI_OK) {
		found = -1;
		goto out;
	}
	uci_foreach_element(&pkg->sections, element) {
		struct uci_section *sec = uci_to_section(element);
		const char *t, *g;

		if (strcmp(sec->type, "route") != 0)
			continue;
		t = uci_lookup_option_string(uci, sec, "target");
		g = uci_lookup_option_string(uci, sec, "gateway");
		if (t && g && strcmp(t, target) == 0 && strcmp(g, gateway) == 0) {
			if (strlen(sec->e.name) >= namesz)
				break;
			snprintf(name, namesz, "%s", sec->e.name);
			found = 1;
			break;
		}
	}
out:
	uci_free_context(uci);
	return found;
}

static int stage_set(struct ubus_context *ctx, const char *sid,
		     const char *section, const char *option,
		     const char *value, const char *second_option,
		     const char *second_value)
{
	struct blob_buf buf = { 0 };
	void *values;
	int ret;

	blob_buf_init(&buf, 0);
	blobmsg_add_string(&buf, "ubus_rpc_session", sid);
	blobmsg_add_string(&buf, "config", "network");
	blobmsg_add_string(&buf, "section", section);
	values = blobmsg_open_table(&buf, "values");
	blobmsg_add_string(&buf, option, value);
	if (second_option)
		blobmsg_add_string(&buf, second_option, second_value);
	blobmsg_close_table(&buf, values);
	ret = call(ctx, "uci", "set", buf.head, NULL, NULL);
	blob_buf_free(&buf);
	return ret;
}

static int stage_delete(struct ubus_context *ctx, const char *sid,
			const char *section, const char *option)
{
	struct blob_buf buf = { 0 };
	int ret;

	blob_buf_init(&buf, 0);
	blobmsg_add_string(&buf, "ubus_rpc_session", sid);
	blobmsg_add_string(&buf, "config", "network");
	blobmsg_add_string(&buf, "section", section);
	if (option)
		blobmsg_add_string(&buf, "option", option);
	ret = call(ctx, "uci", "delete", buf.head, NULL, NULL);
	blob_buf_free(&buf);
	return ret;
}

static int stage_route_add(struct ubus_context *ctx, const char *sid,
			   const char *target, const char *gateway,
			   const char *metric, const char *interface)
{
	struct blob_buf buf = { 0 };
	void *values;
	int ret;

	blob_buf_init(&buf, 0);
	blobmsg_add_string(&buf, "ubus_rpc_session", sid);
	blobmsg_add_string(&buf, "config", "network");
	blobmsg_add_string(&buf, "type", "route");
	values = blobmsg_open_table(&buf, "values");
	blobmsg_add_string(&buf, "target", target);
	blobmsg_add_string(&buf, "gateway", gateway);
	blobmsg_add_string(&buf, "interface", interface);
	if (metric)
		blobmsg_add_string(&buf, "metric", metric);
	blobmsg_close_table(&buf, values);
	ret = call(ctx, "uci", "add", buf.head, NULL, NULL);
	blob_buf_free(&buf);
	return ret;
}

static int stage_change(struct ubus_context *ctx, const char *sid,
			enum fnc_change_kind kind, const char *arg1,
			const char *arg2, const char *arg3, const char *arg4)
{
	char route_name[64];
	int found, ret;

	switch (kind) {
	case FNC_CHANGE_ADDRESS:
		return stage_set(ctx, sid, arg1, "proto", "static", "ipaddr", arg2);
	case FNC_CHANGE_DHCP:
		ret = stage_set(ctx, sid, arg1, "proto", "dhcp", NULL, NULL);
		if (ret)
			return ret;
		found = option_exists(arg1, "ipaddr");
		if (found < 0)
			return -1;
		if (!found)
			return 0;
		return stage_delete(ctx, sid, arg1, "ipaddr");
	case FNC_CHANGE_UP:
	case FNC_CHANGE_DOWN:
		return stage_set(ctx, sid, arg1, "disabled",
				 kind == FNC_CHANGE_UP ? "0" : "1", NULL, NULL);
	case FNC_CHANGE_ROUTE_ADD:
		return stage_route_add(ctx, sid, arg1, arg2, arg3, arg4);
	case FNC_CHANGE_ROUTE_DEL:
		found = find_route(arg1, arg2, route_name, sizeof(route_name));
		if (found <= 0) {
			fprintf(stderr, "fnc: маршрут %s via %s не найден\n", arg1, arg2);
			return -1;
		}
		return stage_delete(ctx, sid, route_name, NULL);
	}
	return -1;
}

int fnc_safe_apply(struct ubus_context *ctx, enum fnc_change_kind kind,
		   const char *arg1, const char *arg2, const char *arg3,
		   const char *arg4)
{
	struct pending_state state = { 0 };
	struct blob_buf buf = { 0 };
	int fd, ret = -1;

	if ((kind == FNC_CHANGE_UP || kind == FNC_CHANGE_DOWN) &&
	    wireless_network(arg1)) {
		fprintf(stderr, "fnc: interface %s связан с Wi-Fi; up/down через fnc недоступен, используйте настройки Wi-Fi\n",
			arg1);
		return -1;
	}
	fd = reserve_state(ctx);

	if (fd < 0)
		return -1;
	if (create_session(ctx, &state) != 0 ||
	    grant_network(ctx, state.sid) != 0)
		goto fail;
	state.deadline = monotonic_seconds() + FNC_APPLY_TIMEOUT;
	if (state.deadline < FNC_APPLY_TIMEOUT || write_state(fd, &state) != 0)
		goto fail;
	close(fd);
	fd = -1;
	if (stage_change(ctx, state.sid, kind, arg1, arg2, arg3, arg4) != 0)
		goto fail;
	blob_buf_init(&buf, 0);
	blobmsg_add_string(&buf, "ubus_rpc_session", state.sid);
	blobmsg_add_u8(&buf, "rollback", 1);
	blobmsg_add_u32(&buf, "timeout", FNC_APPLY_TIMEOUT);
	ret = call(ctx, "uci", "apply", buf.head, NULL, NULL);
	blob_buf_free(&buf);
	if (ret != 0)
		goto fail;
	printf("Изменение применено на %d секунд. Подтвердите: fnc confirm; отмените: fnc rollback\n",
	       FNC_APPLY_TIMEOUT);
	return 0;
fail:
	if (fd >= 0)
		close(fd);
	if (state.sid[0]) {
		struct blob_buf revert = { 0 };
		blob_buf_init(&revert, 0);
		blobmsg_add_string(&revert, "ubus_rpc_session", state.sid);
		blobmsg_add_string(&revert, "config", "network");
		call_session(ctx, "uci", "rollback", state.sid);
		call(ctx, "uci", "revert", revert.head, NULL, NULL);
		blob_buf_free(&revert);
		call_session(ctx, "session", "destroy", state.sid);
	}
	unlink(FNC_STATE_PATH);
	return -1;
}

static int finish(struct ubus_context *ctx, int confirm)
{
	struct pending_state state;
	long long now = monotonic_seconds();
	int ret;

	if (read_state(&state) != 0) {
		fprintf(stderr, "fnc: нет ожидающего изменения сети\n");
		return -1;
	}
	if (now < 0)
		return -1;
	if (now > state.deadline && confirm) {
		ret = call_session(ctx, "uci", "rollback", state.sid);
		if (ret && ret != UBUS_STATUS_NO_DATA)
			return -1;
		call_session(ctx, "session", "destroy", state.sid);
		unlink(FNC_STATE_PATH);
		fprintf(stderr, "fnc: время подтверждения истекло, изменение отменено\n");
		return -1;
	}
	ret = call_session(ctx, "uci", confirm ? "confirm" : "rollback", state.sid);
	if (ret && ret != UBUS_STATUS_NO_DATA)
		return -1;
	call_session(ctx, "session", "destroy", state.sid);
	unlink(FNC_STATE_PATH);
	if (confirm && ret) {
		fprintf(stderr, "fnc: изменение уже отменено по таймеру\n");
		return -1;
	}
	puts(confirm ? "Изменение сети подтверждено." : "Изменение сети отменено.");
	return 0;
}

int fnc_safe_confirm(struct ubus_context *ctx)
{
	return finish(ctx, 1);
}

int fnc_safe_rollback(struct ubus_context *ctx)
{
	return finish(ctx, 0);
}

int fnc_safe_pending(struct ubus_context *ctx)
{
	struct pending_state state;
	long long now = monotonic_seconds();

	if (read_state(&state) != 0) {
		puts("Нет ожидающего изменения сети.");
		return 0;
	}
	if (now < 0)
		return -1;
	if (now > state.deadline) {
		if (fnc_safe_rollback(ctx) != 0)
			return -1;
		puts("Время подтверждения истекло.");
		return 0;
	}
	printf("Ожидает подтверждения: %lld сек. Команды: fnc confirm / fnc rollback\n",
	       state.deadline - now);
	return 0;
}

int fnc_safe_has_pending(struct ubus_context *ctx)
{
	struct pending_state state;
	long long now = monotonic_seconds();

	if (access(FNC_STATE_PATH, F_OK) != 0)
		return 0;
	if (read_state(&state) != 0 || now < 0)
		return 1;
	if (now > state.deadline)
		return fnc_safe_rollback(ctx) == 0 ? 0 : 1;
	return 1;
}
