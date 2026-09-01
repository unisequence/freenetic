#include <stdio.h>
#include <unistd.h>

#include "cmd_system.h"
#include "ubus_util.h"

int fnc_system_reboot(struct ubus_context *ctx)
{
	printf("Перезагрузка...\n");
	fflush(stdout);
	return fnc_ubus_call(ctx, "system", "reboot", NULL, NULL, NULL);
}

int fnc_system_configuration_save(void)
{
	sync();
	printf("OpenWrt применяет и сохраняет конфигурацию сразу при каждой "
	       "команде (uci commit) — отдельный шаг не нужен, сделал sync()\n");
	return 0;
}
