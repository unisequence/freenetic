#!/usr/bin/env ucode

'use strict';

import { mkstemp, open, popen, readfile, unlink } from 'fs';
import { connect } from 'ubus';
import { cursor } from 'uci';

const API_VERSION = 1;
const MAX_INPUT = 1024 * 1024;
const HOME = '/etc/mihomo';
const CONFIG = `${HOME}/config.yaml`;
const PROVIDERS = `${HOME}/providers`;
const LOCAL_PROVIDER = `${PROVIDERS}/freenetic.txt`;
const INIT = '/etc/init.d/mihomo';
const BINARY = '/usr/bin/mihomo';
const HTTPS_DNS_CONFIG = '/etc/config/https-dns-proxy';
const HTTPS_DNS_INIT = '/etc/init.d/https-dns-proxy';
const TUN_DEVICE = '/dev/net/tun';
const HTTPS_DNS_PORT = 5053;
const CONFIG_BACKUP = `${HOME}/.config.yaml.previous`;
const PROVIDER_BACKUP = `${PROVIDERS}/.freenetic.txt.previous`;
const ubus = connect();

function envelope(data) {
	return { api_version: API_VERSION, ok: true, data: data || {} };
}

function failure(code, message) {
	return { api_version: API_VERSION, ok: false, error: { code: code, message: message || 'Mihomo operation failed.' } };
}

function checked(request) {
	if (request?.args?.api_version != API_VERSION)
		return failure('unsupported_api_version', 'api_version=1 is required.');
	return null;
}

function run_capture(command, limit) {
	const out = mkstemp(), err = mkstemp();
	const rc = system(`${command} >&${out.fileno()} 2>&${err.fileno()}`);
	out.seek(0); err.seek(0);
	const output = out.read(limit || 65536) || '';
	const error = err.read(32768) || '';
	out.close(); err.close();
	return { rc: rc, output: output, error: error };
}

function command_output(command, limit) {
	const fd = popen(command, 'r');
	if (!fd) return '';
	const output = fd.read(limit || 65536) || '';
	fd.close();
	return output;
}

function write_file(path, content, mode) {
	const fd = open(path, 'w', mode || 0600);
	if (!fd) return false;
	fd.write(content);
	fd.close();
	return true;
}

function read_text(path, limit) {
	return readfile(path, limit || 131072) || '';
}

function bool_value(value, fallback) {
	if (value === true || value == '1' || value == 1) return true;
	if (value === false || value == '0' || value == 0) return false;
	return fallback;
}

function installed() {
	return system(`[ -x ${BINARY} ] && [ -f /etc/config/mihomo ] && [ -x ${INIT} ]`) == 0;
}

function running() {
	const pid = trim(command_output('pidof mihomo 2>/dev/null | awk \'{print $1}\'', 64));
	return pid ? int(pid) : 0;
}

function version() {
	if (system(`[ -x ${BINARY} ]`) != 0) return '';
	const output = command_output(`${BINARY} -v 2>/dev/null`, 512);
	const found = match(output, /Mihomo Meta ([^ ]+)/);
	return found ? found[1] : '';
}

function config_value(text, name, fallback) {
	const prefix = `${name}:`;
	for (let line in split(text, '\n')) {
		line = trim(line);
		if (index(line, prefix) == 0)
			return trim(substr(line, length(prefix)));
	}
	return fallback;
}

function path_exists(path) {
	return system(`[ -e ${path} ]`) == 0;
}

function executable(path) {
	return system(`[ -x ${path} ]`) == 0;
}

function block_values(args) {
	args = args || {};
	const policy = args.dns_policy == 'split' ? 'split' : 'default';
	return {
		secure_dns: bool_value(args.secure_dns, false),
		tun: bool_value(args.tun, false),
		dns_policy: policy
	};
}

function blocks_from_config(text) {
	const dns = !!match(text || '', /(^|\n)dns:\s*($|\n)/);
	const tun = !!match(text || '', /(^|\n)tun:\s*\n[ \t]+enable:\s+true/);
	return {
		secure_dns: dns && !!match(text || '', /127\.0\.0\.1:5053/),
		tun: tun,
		dns_policy: !!match(text || '', /(^|\n)[ \t]+nameserver-policy:\s*($|\n)/) ? 'split' : 'default'
	};
}

function block_status(text) {
	const blocks = blocks_from_config(text);
	blocks.https_dns_proxy_installed = path_exists(HTTPS_DNS_CONFIG) && executable(HTTPS_DNS_INIT);
	blocks.tun_available = system(`[ -c ${TUN_DEVICE} ]`) == 0;
	blocks.https_dns_port = HTTPS_DNS_PORT;
	return blocks;
}

function block_error(blocks) {
	if (blocks.secure_dns && !path_exists(HTTPS_DNS_CONFIG))
		return failure('dependency_missing', 'Установите пакет https-dns-proxy в разделе «Приложения».');
	if (blocks.secure_dns && !executable(HTTPS_DNS_INIT))
		return failure('dependency_missing', 'Служба https-dns-proxy недоступна на этом образе OpenWrt.');
	if (blocks.tun && system(`[ -c ${TUN_DEVICE} ]`) != 0)
		return failure('dependency_missing', 'Для TUN-режима нужен загруженный /dev/net/tun (пакет kmod-tun).');
	return null;
}

function https_dns_stage(enabled, port) {
	if (!path_exists(HTTPS_DNS_CONFIG) || !executable(HTTPS_DNS_INIT))
		return { changed: false };
	try {
		const config = cursor();
		const current_proxy = config.get('https-dns-proxy', 'config', 'proxy_server') || '';
		const current_listen = config.get('https-dns-proxy', 'config', 'listen_addr') || '';
		const managed = config.get('mihomo', 'main', 'freenetic_dns_proxy_managed') == '1';
		const previous_proxy = managed ? (config.get('mihomo', 'main', 'freenetic_dns_proxy_previous') || '') : current_proxy;
		const previous_listen = managed ? (config.get('mihomo', 'main', 'freenetic_dns_listen_previous') || '') : current_listen;
		if (enabled) {
			config.set('https-dns-proxy', 'config', 'proxy_server', `http://127.0.0.1:${port}`);
			config.set('https-dns-proxy', 'config', 'listen_addr', '127.0.0.1');
			config.set('mihomo', 'main', 'freenetic_dns_proxy_managed', '1');
			config.set('mihomo', 'main', 'freenetic_dns_proxy_previous', previous_proxy);
			config.set('mihomo', 'main', 'freenetic_dns_listen_previous', previous_listen);
		}
		else if (managed) {
			config.set('https-dns-proxy', 'config', 'proxy_server', previous_proxy);
			config.set('https-dns-proxy', 'config', 'listen_addr', previous_listen);
			config.set('mihomo', 'main', 'freenetic_dns_proxy_managed', '0');
		}
		else {
			return { changed: false };
		}
		config.commit('https-dns-proxy');
		config.commit('mihomo');
		return {
			changed: true,
			proxy: current_proxy,
			listen: current_listen,
			managed: managed,
			stored_proxy: config.get('mihomo', 'main', 'freenetic_dns_proxy_previous') || '',
			stored_listen: config.get('mihomo', 'main', 'freenetic_dns_listen_previous') || ''
		};
	}
	catch (error) {
		return failure('write_failed', error?.message || 'Не удалось настроить https-dns-proxy.');
	}
}

function https_dns_rollback(stage) {
	if (!stage || !stage.changed)
		return;
	try {
		const config = cursor();
		config.set('https-dns-proxy', 'config', 'proxy_server', stage.proxy || '');
		config.set('https-dns-proxy', 'config', 'listen_addr', stage.listen || '');
		config.set('mihomo', 'main', 'freenetic_dns_proxy_managed', stage.managed ? '1' : '0');
		config.set('mihomo', 'main', 'freenetic_dns_proxy_previous', stage.stored_proxy || '');
		config.set('mihomo', 'main', 'freenetic_dns_listen_previous', stage.stored_listen || '');
		config.commit('https-dns-proxy');
		config.commit('mihomo');
	}
	catch (error) {}
}

function https_dns_restart() {
	if (!path_exists(HTTPS_DNS_CONFIG) || !executable(HTTPS_DNS_INIT))
		return { rc: 0 };
	return run_capture(`${HTTPS_DNS_INIT} restart`, 8192);
}

function subscription_values(text) {
	const values = [];
	for (let line in split(text, '\n')) {
		line = trim(line);
		if (index(line, 'url:') != 0) continue;
		let value = trim(substr(line, 4));
		if (length(value) >= 2 && substr(value, 0, 1) == '"' && substr(value, length(value) - 1, 1) == '"') {
			value = substr(value, 1, length(value) - 2);
			value = replace(value, /\\"/g, '"');
			value = replace(value, /\\\\/g, '\\');
		}
		if (match(value, /^https?:\/\/[^[:space:]]+$/i)) push(values, value);
	}
	return join('\n', values);
}

function status_data() {
	const pid = running();
	const provider_input = read_text(LOCAL_PROVIDER, MAX_INPUT);
	const config = read_text(CONFIG, 32768);
	const subscription_input = subscription_values(config);
	const blocks = block_status(config);
	return {
		installed: installed(),
		running: !!pid,
		pid: pid || null,
		version: version(),
		config: config ? 'configured' : 'empty',
		provider_input: provider_input || subscription_input,
		source_mode: provider_input ? 'links' : (subscription_input ? 'subscriptions' : 'links'),
		mixed_port: int(config_value(config, 'mixed-port', '7890')),
		allow_lan: config_value(config, 'allow-lan', 'false') == 'true',
		web_ui: !!match(config, /external-ui:\s+/),
		config_path: CONFIG,
		provider_path: LOCAL_PROVIDER,
		controller: '127.0.0.1:9090',
		blocks: blocks
	};
}

function config_data() {
	if (!installed()) return failure('not_installed', 'Mihomo не установлен.');
	return envelope({ text: read_text(CONFIG, MAX_INPUT), path: CONFIG });
}

function yaml_quote(value) {
	let text = `${value ?? ''}`;
	text = replace(text, /\\/g, '\\\\');
	text = replace(text, /"/g, '\\"');
	text = replace(text, /\r/g, '');
	text = replace(text, /\n/g, '\\n');
	return `"${text}"`;
}

function input_lines(raw, mode) {
	if (type(raw) != 'string' || !trim(raw)) return { error: 'Введите хотя бы одну ссылку или подписку.' };
	if (length(raw) > MAX_INPUT) return { error: 'Размер входных данных не должен превышать 1 МБ.' };
	const values = [];
	for (let item in split(replace(raw, /\r/g, ''), '\n')) {
		const line = trim(item);
		if (!line) continue;
		if (match(line, /[[:cntrl:]]/)) return { error: 'Вход содержит недопустимые управляющие символы.' };
		if (mode == 'subscriptions') {
			if (!match(line, /^https?:\/\/[^[:space:]]+$/i)) return { error: 'Каждая строка должна быть HTTP(S)-ссылкой на подписку.' };
		} else if (!match(line, /^[A-Za-z][A-Za-z0-9+.-]*:\/\/[^[:space:]]+$/)) {
			return { error: 'Строка не похожа на ссылку прокси.' };
		}
		push(values, line);
	}
	return length(values) ? { values: values } : { error: 'Введите хотя бы одну ссылку или подписку.' };
}

function provider_override_text() {
	/* Xray Reality v26.9.8+ requires X25519MLKEM768 in the ClientHello.
	 * Mihomo keeps that extension disabled by default for old Reality
	 * servers, and its bundled Firefox fingerprint does not advertise it.
	 * Apply the compatibility pair only to XHTTP Reality nodes so ordinary
	 * Reality/TCP and non-Reality providers keep their imported settings. */
	return '    override:\n' +
		'      override-expr:\n' +
		'        - \'(select(.["reality-opts"] != null and .network == "xhttp") | .["reality-opts"]["support-x25519mlkem768"]) = true\'\n' +
		'        - \'(select(.["reality-opts"] != null and .network == "xhttp" and .["client-fingerprint"] != "chrome") | .["client-fingerprint"]) = "chrome"\'\n';
}

function blocks_text(blocks) {
	const dns_enabled = blocks.secure_dns || blocks.dns_policy == 'split' || blocks.tun;
	let text = '';
	if (dns_enabled) {
		text += 'dns:\n';
		text += '  enable: true\n';
		text += '  enhanced-mode: fake-ip\n';
		text += '  fake-ip-filter:\n';
		text += '    - "*.lan"\n';
		text += '    - "*.local"\n';
		text += '    - "localhost"\n';
		text += '  nameserver:\n';
		text += blocks.secure_dns ? '    - 127.0.0.1:5053\n' : '    - 127.0.0.1:53\n';
		text += '  proxy-server-nameserver:\n';
		text += '    - 1.1.1.1\n';
		if (blocks.dns_policy == 'split') {
			text += '  nameserver-policy:\n';
			text += '    "geosite:private": 127.0.0.1:53\n';
			text += '    "geosite:cn": 127.0.0.1:53\n';
		}
	}
	if (blocks.tun) {
		text += 'tun:\n';
		text += '  enable: true\n';
		text += '  stack: mixed\n';
		text += '  auto-route: true\n';
		text += '  auto-redirect: true\n';
		text += '  auto-detect-interface: true\n';
		text += '  device: mitun0\n';
		text += '  dns-hijack:\n';
		text += '    - any:53\n';
		text += '  route-exclude-address:\n';
		text += '    - 10.0.0.0/8\n';
		text += '    - 172.16.0.0/12\n';
		text += '    - 192.168.0.0/16\n';
		text += '    - 127.0.0.0/8\n';
		text += '    - 169.254.0.0/16\n';
		text += '    - fc00::/7\n';
	}
	return text;
}

function config_text(values, mode, port, allow_lan, web_ui, blocks) {
	let text = '';
	text += `mixed-port: ${port}\n`;
	text += `allow-lan: ${allow_lan ? 'true' : 'false'}\n`;
	text += 'mode: rule\n';
	text += 'log-level: info\n';
	text += 'external-controller: 127.0.0.1:9090\n';
	if (web_ui) {
		text += 'external-ui: ui\n';
		text += 'external-ui-url: https://github.com/MetaCubeX/metacubexd/releases/latest/download/compressed-dist.tgz\n';
	}
	text += blocks_text(blocks || { secure_dns: false, tun: false, dns_policy: 'default' });
	text += 'proxy-providers:\n';
	const provider_names = [];
	if (mode == 'links') {
		text += '  local:\n';
		text += '    type: file\n';
		text += '    path: ./providers/freenetic.txt\n';
		text += '    format: uri\n';
		text += '    interval: 3600\n';
		text += provider_override_text();
		push(provider_names, 'local');
	} else {
		for (let index, url in values) {
			const name = `subscription_${index + 1}`;
			text += `  ${name}:\n`;
			text += '    type: http\n';
			text += `    url: ${yaml_quote(url)}\n`;
			text += `    path: ./providers/${name}.yaml\n`;
			text += '    format: uri\n';
			text += '    interval: 3600\n';
			text += provider_override_text();
			push(provider_names, name);
		}
	}
	text += 'proxy-groups:\n';
	text += '  - name: PROXY\n';
	text += '    type: select\n';
	text += '    use:\n';
	for (let name in provider_names) text += `      - ${name}\n`;
	/* Do not put DIRECT first here. Mihomo selects the first available
	 * member in a select group on startup; keeping DIRECT in this group
	 * made a newly applied proxy configuration silently bypass every
	 * provider until somebody manually changed the selection in the
	 * controller. MATCH,PROXY must use the configured provider by default. */
	text += 'rules:\n';
	text += '  - MATCH,PROXY\n';
	return text;
}

function cleanup_stage() {
	unlink(CONFIG_BACKUP);
	unlink(PROVIDER_BACKUP);
}

function rollback_stage(previous) {
	if (previous && previous.config)
		system(`mv ${CONFIG_BACKUP} ${CONFIG}`);
	else
		unlink(CONFIG);
	if (previous && previous.provider)
		system(`mv ${PROVIDER_BACKUP} ${LOCAL_PROVIDER}`);
	else
		unlink(LOCAL_PROVIDER);
	cleanup_stage();
}

function stage_and_replace(values, mode, port, allow_lan, web_ui, blocks) {
	if (system(`mkdir -m 0700 -p ${HOME} ${PROVIDERS}`) != 0)
		return failure('storage_unavailable', 'Не удалось подготовить каталог Mihomo.');
	const previous = {
		config: system(`[ -f ${CONFIG} ]`) == 0,
		provider: system(`[ -f ${LOCAL_PROVIDER} ]`) == 0
	};
	cleanup_stage();
	if (previous.config && system(`cp -a ${CONFIG} ${CONFIG_BACKUP}`) != 0)
		return failure('write_failed', 'Не удалось сохранить предыдущую конфигурацию Mihomo.');
	if (previous.provider && system(`cp -a ${LOCAL_PROVIDER} ${PROVIDER_BACKUP}`) != 0) {
		cleanup_stage();
		return failure('write_failed', 'Не удалось сохранить предыдущий список прокси.');
	}
	const config_tmp = `${HOME}/.config.yaml.new`;
	const provider_tmp = `${HOME}/providers/.freenetic.txt.new`;
	const text = config_text(values, mode, port, allow_lan, web_ui, blocks);
	if (!write_file(config_tmp, text, 0600)) {
		cleanup_stage();
		return failure('write_failed', 'Не удалось записать конфигурацию Mihomo.');
	}
	if (mode == 'links' && !write_file(provider_tmp, join('\n', values) + '\n', 0600)) {
		unlink(config_tmp);
		cleanup_stage();
		return failure('write_failed', 'Не удалось записать локальный список прокси.');
	}
	if (system(`mv ${config_tmp} ${CONFIG}`) != 0) {
		unlink(config_tmp); unlink(provider_tmp);
		cleanup_stage();
		return failure('write_failed', 'Не удалось заменить конфигурацию Mihomo.');
	}
	if (mode == 'links' && system(`mv ${provider_tmp} ${LOCAL_PROVIDER}`) != 0) {
		/* Do not leave a new config pointing at a provider which was not
		 * committed. The previous provider is intentionally preserved by mv. */
		rollback_stage(previous);
		return failure('write_failed', 'Не удалось заменить локальный список прокси.');
	}
	if (mode == 'subscriptions') unlink(LOCAL_PROVIDER);
	try {
		const config = cursor();
		config.set('mihomo', 'main', 'enabled', '1');
		config.commit('mihomo');
	}
	catch (error) {
		rollback_stage(previous);
		return failure('write_failed', error?.message || 'Не удалось сохранить настройки службы Mihomo.');
	}
	const dns_stage = https_dns_stage(blocks && blocks.secure_dns, port);
	if (dns_stage && dns_stage.ok === false) {
		rollback_stage(previous);
		return dns_stage;
	}
	return { config: previous.config, provider: previous.provider, dns: dns_stage };
}

function apply_config(request) {
	if (!installed()) return failure('not_installed', 'Сначала установите Mihomo в разделе «Приложения».');
	const args = request.args || {};
	const mode = args.source_mode == 'subscriptions' ? 'subscriptions' : 'links';
	let parsed;
	try { parsed = input_lines(args.input, mode); }
	catch (error) { return failure('invalid_input', error?.message || `${error}`); }
	if (parsed.error) return failure('invalid_input', parsed.error);
	const port = int(args.mixed_port || 7890);
	if (!port || port < 1 || port > 65535) return failure('invalid_port', 'Порт должен быть от 1 до 65535.');
	const blocks = block_values(args);
	const dependency = block_error(blocks);
	if (dependency) return dependency;
	const stage = stage_and_replace(parsed.values, mode, port, bool_value(args.allow_lan, false), bool_value(args.web_ui, false), blocks);
	if (stage && stage.ok === false) return stage;
	const action = run_capture(`${INIT} restart`, 8192);
	if (action.rc != 0) {
		https_dns_rollback(stage && stage.dns);
		rollback_stage(stage);
		return failure('service_failed', trim(action.error || action.output || 'Не удалось перезапустить Mihomo.'));
	}
	const dns_action = https_dns_restart();
	if (dns_action.rc != 0) {
		https_dns_rollback(stage && stage.dns);
		rollback_stage(stage);
		run_capture(`${INIT} restart`, 8192);
		return failure('service_failed', trim(dns_action.error || dns_action.output || 'Не удалось перезапустить https-dns-proxy.'));
	}
	cleanup_stage();
	return envelope({ applied: true, source_mode: mode, count: length(parsed.values), blocks: blocks, status: status_data() });
}

function rollback_config_stage(previous) {
	if (previous)
		system(`mv ${CONFIG_BACKUP} ${CONFIG}`);
	else
		unlink(CONFIG);
	unlink(CONFIG_BACKUP);
}

function apply_raw_config(request) {
	if (!installed()) return failure('not_installed', 'Сначала установите Mihomo в разделе «Приложения».');
	const raw = request.args?.config;
	if (type(raw) != 'string' || !trim(raw))
		return failure('invalid_config', 'Введите конфигурацию Mihomo в формате YAML.');
	if (length(raw) > MAX_INPUT)
		return failure('invalid_config', 'Размер конфигурации не должен превышать 1 МБ.');

	const previous = system(`[ -f ${CONFIG} ]`) == 0;
	cleanup_stage();
	if (previous && system(`cp -a ${CONFIG} ${CONFIG_BACKUP}`) != 0)
		return failure('write_failed', 'Не удалось сохранить предыдущую конфигурацию Mihomo.');

	const config_tmp = `${HOME}/.config.yaml.manual.new`;
	if (!write_file(config_tmp, raw, 0600)) {
		cleanup_stage();
		return failure('write_failed', 'Не удалось записать конфигурацию Mihomo.');
	}
	const validation = run_capture(`${BINARY} -d ${HOME} -t -f ${config_tmp}`, 16384);
	if (validation.rc != 0) {
		unlink(config_tmp);
		cleanup_stage();
		return failure('invalid_config', trim(validation.error || validation.output || 'Конфигурация Mihomo не прошла проверку.'));
	}
	if (system(`mv ${config_tmp} ${CONFIG}`) != 0) {
		unlink(config_tmp);
		rollback_config_stage(previous);
		return failure('write_failed', 'Не удалось заменить конфигурацию Mihomo.');
	}
	try {
		const config = cursor();
		config.set('mihomo', 'main', 'enabled', '1');
		config.commit('mihomo');
	}
	catch (error) {
		rollback_config_stage(previous);
		return failure('write_failed', error?.message || 'Не удалось сохранить настройки службы Mihomo.');
	}
	const action = run_capture(`${INIT} restart`, 8192);
	if (action.rc != 0) {
		rollback_config_stage(previous);
		run_capture(`${INIT} restart`, 8192);
		return failure('service_failed', trim(action.error || action.output || 'Не удалось перезапустить Mihomo.'));
	}
	cleanup_stage();
	return envelope({ applied: true, mode: 'manual', status: status_data() });
}

function service_action(request) {
	if (!installed()) return failure('not_installed', 'Mihomo не установлен.');
	const action = request.args?.action;
	if (action != 'start' && action != 'stop' && action != 'restart' && action != 'reload')
		return failure('invalid_action', 'Недопустимое действие службы.');
	const result = run_capture(`${INIT} ${action}`, 8192);
	if (result.rc != 0) return failure('service_failed', trim(result.error || result.output || 'Действие службы завершилось ошибкой.'));
	return envelope({ status: status_data() });
}

function logs_data() {
	const result = run_capture('logread -e mihomo | tail -n 120', 32768);
	return envelope({ text: result.output || result.error || '' });
}

const methods = {
	status: { args: { api_version: 0 }, call: function(request) { const error = checked(request); return error || envelope(status_data()); } },
	config: { args: { api_version: 0 }, call: function(request) { const error = checked(request); return error || config_data(); } },
	apply: { args: { api_version: 0, input: '', source_mode: '', mixed_port: 0, allow_lan: false, web_ui: false, secure_dns: false, tun: false, dns_policy: '' }, call: function(request) {
		try { const error = checked(request); return error || apply_config(request); }
		catch (error) { return failure('internal_error', error?.message || `${error}`); }
	} },
	apply_raw: { args: { api_version: 0, config: '' }, call: function(request) {
		try { const error = checked(request); return error || apply_raw_config(request); }
		catch (error) { return failure('internal_error', error?.message || `${error}`); }
	} },
	service: { args: { api_version: 0, action: '' }, call: function(request) {
		try { const error = checked(request); return error || service_action(request); }
		catch (error) { return failure('internal_error', error?.message || `${error}`); }
	} },
	logs: { args: { api_version: 0 }, call: function(request) { const error = checked(request); return error || logs_data(); } }
};

return { 'mihomo': methods };
