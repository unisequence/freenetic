#include <stdio.h>
#include <string.h>

#include "cmd_help.h"

struct help_entry {
	const char *section;
	const char *usage;
	const char *desc;
};

/* Единая таблица команд — по мере переноса синтаксиса KeeneticOS новые
 * команды просто дописываются сюда одной строкой. */
static const struct help_entry help_table[] = {
	{ "general", "help [section]", "список команд (весь или по разделу)" },
	{ "general", "exit / quit", "выйти из контекста или из оболочки" },
	{ "show", "show version", "модель, версия прошивки, ревизия" },
	{ "show", "show system", "аптайм, load average, память" },
	{ "show", "show interface [name]", "статус/proto/устройство интерфейсов" },
	{ "show", "show ip [name]", "IPv4/IPv6-адреса интерфейсов" },
	{ "show", "show running-config", "вся текущая конфигурация (uci export)" },
	{ "show", "show ip arp", "ARP/ND-таблица" },
	{ "show", "show mac-table", "MAC-таблица свитча (нужен пакет ip-bridge)" },
	{ "interface", "interface <name>", "войти в контекст интерфейса" },
	{ "interface", "  ip address A.B.C.D/N", "задать статический IP-адрес" },
	{ "interface", "  ip dhcp client", "перевести интерфейс на DHCP" },
	{ "interface", "  up / down", "включить / выключить интерфейс" },
	{ "interface", "  exit", "выйти из контекста интерфейса" },
	{ "system", "system reboot", "перезагрузить устройство" },
	{ "system", "system configuration save", "форсировать sync (uci и так применяет сразу)" },
	{ "diag", "ping <host>", "4 ICMP-пакета до узла" },
	{ "diag", "traceroute <host>", "трассировка маршрута" },
	{ "route", "show ip route", "таблица маршрутизации ядра" },
	{ "route", "ip route A.B.C.D/N GW [metric N]", "добавить статический маршрут" },
	{ "route", "no ip route A.B.C.D/N GW", "удалить статический маршрут" },
};

#define HELP_COUNT (sizeof(help_table) / sizeof(help_table[0]))

/* Разделы, под которыми пользователь может искать команду, даже если
 * внутри они хранятся под другим именем (Keenetic называет раздел с
 * настройками WAN/интерфейсов "Интернет" в веб-морде). */
static const char *resolve_alias(const char *topic)
{
	if (strcasecmp(topic, "internet") == 0 || strcasecmp(topic, "wan") == 0)
		return "interface";
	return topic;
}

static void print_sections(void)
{
	fprintf(stderr, "Разделы: general, show, interface (алиасы: internet, wan), system, diag, route\n");
	fprintf(stderr, "         help <раздел> — подробнее по разделу\n");
}

int fnc_help(const char *topic)
{
	const char *section = topic ? resolve_alias(topic) : NULL;
	int found = 0;

	if (section) {
		for (size_t i = 0; i < HELP_COUNT; i++) {
			if (strcasecmp(help_table[i].section, section) == 0) {
				if (!found)
					printf("%s:\n", help_table[i].section);
				printf("  %-28s %s\n", help_table[i].usage, help_table[i].desc);
				found = 1;
			}
		}
		if (!found) {
			fprintf(stderr, "fnc: неизвестный раздел '%s'\n", topic);
			print_sections();
		}
		return 0;
	}

	{
		const char *last_section = "";

		for (size_t i = 0; i < HELP_COUNT; i++) {
			if (strcmp(last_section, help_table[i].section) != 0) {
				printf("%s:\n", help_table[i].section);
				last_section = help_table[i].section;
			}
			printf("  %-28s %s\n", help_table[i].usage, help_table[i].desc);
		}
	}
	return 0;
}
