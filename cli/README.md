# fnc — Freenetic CLI

Keenetic-style CLI поверх чистого OpenWrt. Написана на C, линкуется
напрямую против `libubus`/`libuci`/`libubox`/`libblobmsg_json` — тех же
библиотек, на которых стоят штатные `ubus`/`uci` и `netifd`, так что на
устройстве бинарь ничего нового с собой не тащит.

## Сборка

Кросс-компилируется тулчейном из `openwrt-upstream` buildroot (тот же
таргет, что и устройство — `mediatek/filogic`,
`aarch64_cortex-a53_musl`):

```sh
make OPENWRT_DIR=/path/to/openwrt-upstream
```

Результат — `fnc`, ARM64/musl, динамически линкован (нужны стоящие на
устройстве `libubus`/`libuci`/`libubox`/`libblobmsg_json`, других
зависимостей нет).

## Синтаксис

Постепенно переносим сюда команды в духе KeeneticOS CLI, транслируя их
в UCI/ubus/`ip`/`tc`.

Пока реализовано (read-only):

```
fnc show version
fnc show system
fnc show interface [имя]
fnc show ip [имя]
```

## Структура

- `src/main.c` — разбор argv, диспетчеризация команд.
- `src/ubus_util.[ch]` — тонкая обёртка над `libubus` (connect/invoke).
- `src/cmd_show.[ch]` — реализация `show`-команд (парсинг blobmsg-ответов
  `system board`/`system info`/`network.interface dump`).
