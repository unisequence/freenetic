# fnc — Freenetic CLI

Keenetic-style CLI поверх чистого OpenWrt. Написана на C, линкуется
напрямую против `libubus`/`libuci`/`libubox`/`libblobmsg_json` — тех же
библиотек, на которых стоят штатные `ubus`/`uci` и `netifd`, так что на
устройстве бинарь ничего нового с собой не тащит.

## Сборка

Кросс-компилируется тулчейном из `openwrt-upstream` buildroot (тот же
таргет, что и устройство — `mediatek/filogic`, `ramips/mt7621` или
`x86/64`; соответственно `aarch64_cortex-a53_musl`, `mipsel_24kc_musl`
или `x86_64_musl`):

```sh
make OPENWRT_DIR=/path/to/openwrt-upstream
```

Результат — `fnc`, динамически линкованный под выбранный target/musl (нужны стоящие на
устройстве `libubus`/`libuci`/`libubox`/`libblobmsg_json`, других
зависимостей нет). Релизный installer умеет подхватить совместимые версии
этих библиотек с другими SONAME-дейтами через приватные alias’ы; системные
библиотеки роутера он не заменяет.

## Синтаксис

Команды в духе KeeneticOS CLI транслируются в UCI/ubus и штатные утилиты
OpenWrt (`ip`, `bridge`, `ping`, `traceroute`). Реализовано:

```
fnc show version
fnc show system
fnc show wan
fnc show multiwan
fnc show dns
fnc show applications [имя-пакета]
fnc show interface [имя]
fnc show ip [имя]
fnc show ip route
fnc show ip arp
fnc show running-config
fnc show mac-table
fnc interface <имя> ip address A.B.C.D/N
fnc interface <имя> ip dhcp client
fnc interface <имя> up|down
fnc ip route <сеть>/<маска> <шлюз> [metric <N>]
fnc no ip route <сеть>/<маска> <шлюз>
fnc ping <узел>
fnc traceroute <узел>
fnc system reboot
fnc system configuration save
fnc help [section]
fnc --version
```

Запуск без аргументов открывает интерактивный REPL с историей и контекстом
`interface <имя>`.

`show version` показывает версию OpenWrt, `--version` — идентификатор
сборки самого `fnc`.
`show running-config` выводит весь UCI-конфиг, в том числе пароли и ключи:
не публикуйте его вывод без проверки. Изменения интерфейсов и маршрутов
сохраняются и применяются сразу. Для статического маршрута шлюз должен
попадать в подсеть существующего интерфейса; иначе `fnc` откажет в записи.

## Дальнейшее развитие

`show wan` берёт текущее состояние интерфейсов из netifd; `show multiwan`
показывает режим и каналы из контроллера Freenetic. `show dns` перечисляет
DNS-серверы интерфейсов и настройки dnsmasq — это диагностический снимок,
а не проверка прохождения DNS-запросов. `show applications` показывает
краткий список пакетов, а с именем пакета проверяет любой конкретный пакет
через тот же помощник, что использует веб-интерфейс.

Команды настройки стоит расширять после того, как для них будет
общий с веб-интерфейсом механизм применения и отката: потеря доступа к
роутеру при изменении LAN из терминала пока возможна.

## Структура

- `src/main.c` — разбор argv, диспетчеризация команд.
- `src/ubus_util.[ch]` — тонкая обёртка над `libubus` (connect/invoke).
- `src/dispatch.[ch]` — маршрутизация команд и контекстов.
- `src/repl.[ch]` — интерактивная строка, история и interface-контекст.
- `src/cmd_show.[ch]` — реализация `show`-команд (парсинг blobmsg-ответов
  `system board`/`system info`/`network.interface dump`).
- `src/cmd_config.[ch]`, `src/cmd_route.[ch]` — изменение интерфейсов и
  статических маршрутов через UCI с последующим `network reload`.
