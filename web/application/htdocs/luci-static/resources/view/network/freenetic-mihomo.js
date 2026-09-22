'use strict';
'require view';
'require fs';
'require ui';
'require freenetic-rpc as rpc';
'require freenetic-ui as uiHelper';

const PACKAGE_HELPER = '/usr/libexec/freenetic-mihomo-package';
const notify = uiHelper.notify;

function applicationsUrl(focus) {
	return L.url('admin/system/applications') + '?focus=' + (focus || 'mihomo');
}

function apiCall(method, args) {
	return rpc.call('mihomo', method, Object.assign({ api_version: 1 }, args || {})).then(reply => {
		if (!reply || reply.ok !== true)
			throw new Error(reply && reply.error && reply.error.message || _('Mihomo operation failed.'));
		return reply.data || {};
	});
}

function statusPill(status) {
	const running = status && status.running;
	return E('span', { class: 'fn-status-pill ' + (running ? 'fn-status-ok' : 'fn-status-off') },
		running ? _('Running') : _('Stopped'));
}

function inputField(label, control, hint) {
	const children = [ E('label', {}, label), control ];
	if (hint)
		children.push(E('small', { class: 'fn-field-hint' }, hint));
	return E('div', { class: 'fn-settings-field' }, children);
}

function checkbox(label, checked) {
	const input = E('input', { type: 'checkbox' });
	input.checked = !!checked;
	return E('label', { class: 'fn-mihomo-check' }, [ input, E('span', {}, label) ]);
}

function yamlScalar(value) {
	if (value === true || value === false)
		return value ? 'true' : 'false';
	if (typeof value === 'number' && isFinite(value))
		return String(value);
	return JSON.stringify(String(value == null ? '' : value));
}

function emitYamlMapping(lines, value, indent) {
	for (const key of Object.keys(value || {})) {
		const item = value[key];
		if (item === undefined || item === null || item === '')
			continue;
		if (Array.isArray(item)) {
			lines.push(indent + key + ':');
			item.forEach(entry => lines.push(indent + '  - ' + yamlScalar(entry)));
		}
		else if (typeof item === 'object') {
			lines.push(indent + key + ':');
			emitYamlMapping(lines, item, indent + '  ');
		}
		else {
			lines.push(indent + key + ': ' + yamlScalar(item));
		}
	}
}

function emitYamlProxy(lines, proxy) {
	lines.push('  - name: ' + yamlScalar(proxy.name));
	const fields = Object.assign({}, proxy);
	delete fields.name;
	emitYamlMapping(lines, fields, '    ');
}

function decodePart(value) {
	try { return decodeURIComponent(value || ''); }
	catch (error) { return value || ''; }
}

function fragmentName(raw, fallback) {
	const marker = String(raw || '').indexOf('#');
	if (marker < 0)
		return fallback;
	const name = decodePart(String(raw).slice(marker + 1));
	return name || fallback;
}

function queryValue(url, name, fallback) {
	const value = url && url.searchParams ? url.searchParams.get(name) : null;
	return value === null || value === '' ? fallback : value;
}

function boolValue(value) {
	return /^(?:1|true|yes)$/i.test(String(value || ''));
}

function numberValue(value, fallback) {
	const number = Number(value);
	return isFinite(number) && number > 0 ? number : fallback;
}

function base64Text(value) {
	try {
		let encoded = String(value || '').replace(/[\r\n\s]/g, '').replace(/-/g, '+').replace(/_/g, '/');
		while (encoded.length % 4)
			encoded += '=';
		const binary = atob(encoded);
		const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
		if (typeof TextDecoder === 'function')
			return new TextDecoder().decode(bytes);
		return decodeURIComponent(Array.from(bytes).map(byte => '%' + byte.toString(16).padStart(2, '0')).join(''));
	}
	catch (error) {
		return '';
	}
}

function extraValue(query, key) {
	const raw = queryValue(query, 'extra', '');
	if (!raw)
		return '';
	try {
		const extra = JSON.parse(raw);
		return extra && extra[key] || '';
	}
	catch (error) {
		return '';
	}
}

function applyTlsFields(proxy, url) {
	const security = String(queryValue(url, 'security', '') || '').toLowerCase();
	if (security === 'tls' || security === 'reality' || url.protocol === 'https:')
		proxy.tls = true;
	const servername = queryValue(url, 'sni', '') || queryValue(url, 'servername', '') || queryValue(url, 'peer', '');
	if (servername)
		proxy.servername = servername;
	if (boolValue(queryValue(url, 'insecure', '') || queryValue(url, 'allowInsecure', '')))
		proxy['skip-cert-verify'] = true;
	const alpn = queryValue(url, 'alpn', '');
	if (alpn)
		proxy.alpn = alpn.split(',').map(item => item.trim()).filter(Boolean);
}

function applyTransportFields(proxy, url, forceNetwork) {
	const network = String(forceNetwork || queryValue(url, 'type', '') || queryValue(url, 'network', '') || '').toLowerCase();
	if (!network || network === 'tcp') {
		if (network === 'tcp') proxy.network = 'tcp';
		return;
	}
	proxy.network = network;
	const host = queryValue(url, 'host', '') || queryValue(url, 'hostname', '');
	const path = queryValue(url, 'path', '') || queryValue(url, 'p', '');
	if (network === 'ws') {
		proxy['ws-opts'] = {};
		if (path) proxy['ws-opts'].path = path;
		if (host) proxy['ws-opts'].headers = { Host: host };
	}
	else if (network === 'grpc') {
		proxy['grpc-opts'] = {};
		const service = queryValue(url, 'serviceName', '') || queryValue(url, 'service-name', '');
		if (service) proxy['grpc-opts']['grpc-service-name'] = service;
	}
	else if (network === 'xhttp') {
		proxy['xhttp-opts'] = {};
		const mode = queryValue(url, 'mode', '') || extraValue(url, 'mode');
		const padding = queryValue(url, 'x_padding_bytes', '') || extraValue(url, 'xPaddingBytes');
		if (path) proxy['xhttp-opts'].path = path;
		if (mode) proxy['xhttp-opts'].mode = mode;
		if (padding) proxy['xhttp-opts']['x-padding-bytes'] = padding;
		if (host) proxy['xhttp-opts'].headers = { Host: host };
	}
	else if (path) {
		proxy['http-opts'] = { path: [ path ] };
		if (host) proxy['http-opts'].headers = { Host: [ host ] };
	}
}

function parseVless(raw, index) {
	const url = new URL(raw);
	const proxy = {
		name: fragmentName(raw, 'VLESS ' + (index + 1)),
		type: 'vless',
		server: url.hostname,
		port: numberValue(url.port, 443),
		uuid: decodePart(url.username),
		encryption: queryValue(url, 'encryption', 'none')
	};
	const flow = queryValue(url, 'flow', '');
	if (flow) proxy.flow = flow;
	const fingerprint = queryValue(url, 'fp', '');
	if (fingerprint) proxy['client-fingerprint'] = fingerprint;
	applyTlsFields(proxy, url);
	applyTransportFields(proxy, url);
	const security = String(queryValue(url, 'security', '') || '').toLowerCase();
	if (security === 'reality' || queryValue(url, 'pbk', '') || queryValue(url, 'public-key', '')) {
		proxy['reality-opts'] = {};
		const publicKey = queryValue(url, 'pbk', '') || queryValue(url, 'public-key', '');
		const shortId = queryValue(url, 'sid', '') || queryValue(url, 'short-id', '');
		const spiderX = queryValue(url, 'spx', '') || queryValue(url, 'spider-x', '');
		if (publicKey) proxy['reality-opts']['public-key'] = publicKey;
		if (shortId) proxy['reality-opts']['short-id'] = shortId;
		if (spiderX) proxy['reality-opts']['spider-x'] = spiderX;
		if (proxy.network === 'xhttp') {
			proxy['reality-opts']['support-x25519mlkem768'] = true;
			proxy['client-fingerprint'] = 'chrome';
		}
	}
	return proxy;
}

function parseVmess(raw, index) {
	const payload = base64Text(String(raw).slice(8).split('#')[0]);
	if (!payload)
		return null;
	const data = JSON.parse(payload);
	const proxy = {
		name: data.ps || fragmentName(raw, 'VMess ' + (index + 1)),
		type: 'vmess',
		server: data.add,
		port: numberValue(data.port, 443),
		uuid: data.id,
		alterId: numberValue(data.aid, 0),
		cipher: data.scy || 'auto'
	};
	if (String(data.tls || '').toLowerCase() === 'tls') proxy.tls = true;
	if (data.sni || data.host) proxy.servername = data.sni || data.host;
	if (data.alpn) proxy.alpn = String(data.alpn).split(',').map(item => item.trim()).filter(Boolean);
	const network = String(data.net || '').toLowerCase();
	if (network) {
		proxy.network = network;
		if (network === 'ws') {
			proxy['ws-opts'] = {};
			if (data.path) proxy['ws-opts'].path = data.path;
			if (data.host) proxy['ws-opts'].headers = { Host: data.host };
		}
		else if (network === 'grpc' && data.path)
			proxy['grpc-opts'] = { 'grpc-service-name': data.path };
	}
	return proxy;
}

function parseShadowsocks(raw, index) {
	const bodyWithName = String(raw).slice(5);
	const marker = bodyWithName.indexOf('#');
	const body = marker >= 0 ? bodyWithName.slice(0, marker) : bodyWithName;
	const name = fragmentName(raw, 'Shadowsocks ' + (index + 1));
	let decoded = '';
	let hostPart = '';
	const at = body.lastIndexOf('@');
	if (at >= 0) {
		const userPart = body.slice(0, at);
		decoded = userPart.indexOf(':') >= 0 ? decodePart(userPart) : base64Text(userPart);
		hostPart = body.slice(at + 1);
	}
	else {
		decoded = base64Text(body);
		const decodedAt = decoded.lastIndexOf('@');
		if (decodedAt >= 0) {
			hostPart = decoded.slice(decodedAt + 1);
			decoded = decoded.slice(0, decodedAt);
		}
	}
	if (!decoded || !hostPart)
		return null;
	const separator = decoded.indexOf(':');
	if (separator < 1)
		return null;
	const host = new URL('ss://' + hostPart);
	const proxy = {
		name: name,
		type: 'ss',
		server: host.hostname,
		port: numberValue(host.port, 443),
		cipher: decoded.slice(0, separator),
		password: decoded.slice(separator + 1)
	};
	const plugin = host.searchParams.get('plugin');
	if (plugin) proxy.plugin = plugin;
	return proxy;
}

function parseGenericUri(raw, index) {
	const url = new URL(raw);
	const scheme = url.protocol.replace(/:$/, '').toLowerCase();
	const name = fragmentName(raw, scheme.toUpperCase() + ' ' + (index + 1));
	if (scheme === 'trojan') {
		const proxy = { name: name, type: 'trojan', server: url.hostname, port: numberValue(url.port, 443), password: decodePart(url.username) };
		applyTlsFields(proxy, url);
		if (!proxy.tls) proxy.tls = true;
		applyTransportFields(proxy, url);
		return proxy;
	}
	if (scheme === 'hysteria2' || scheme === 'hy2') {
		const proxy = { name: name, type: 'hysteria2', server: url.hostname, port: numberValue(url.port, 443), password: decodePart(url.username) };
		const obfs = queryValue(url, 'obfs', '');
		if (obfs) proxy.obfs = obfs;
		const obfsPassword = queryValue(url, 'obfs-password', '');
		if (obfsPassword) proxy['obfs-password'] = obfsPassword;
		applyTlsFields(proxy, url);
		return proxy;
	}
	if (scheme === 'http' || scheme === 'https' || scheme === 'socks' || scheme === 'socks5') {
		const proxy = { name: name, type: scheme === 'http' || scheme === 'https' ? 'http' : 'socks5', server: url.hostname, port: numberValue(url.port, scheme === 'https' ? 443 : 80) };
		if (url.username) proxy.username = decodePart(url.username);
		if (url.password) proxy.password = decodePart(url.password);
		if (scheme === 'https') proxy.tls = true;
		applyTlsFields(proxy, url);
		return proxy;
	}
	return null;
}

function parseProxyUri(raw, index) {
	const line = String(raw || '').trim();
	if (!line || line[0] === '#')
		return null;
	try {
		const scheme = line.slice(0, line.indexOf(':')).toLowerCase();
		if (scheme === 'vless') return parseVless(line, index);
		if (scheme === 'vmess') return parseVmess(line, index);
		if (scheme === 'ss') return parseShadowsocks(line, index);
		return parseGenericUri(line, index);
	}
	catch (error) {
		return null;
	}
}

function effectiveYaml(configText, sourceMode, source) {
	if (!configText || configText.indexOf('proxy-providers:') < 0 || sourceMode !== 'links')
		return { text: configText || '', note: _('Subscriptions and manual profiles remain provider-based; the saved YAML is shown as-is.') };
	const proxies = [];
	const unsupported = [];
	String(source || '').split(/\r?\n/).forEach((line, index) => {
		if (!String(line).trim()) return;
		const proxy = parseProxyUri(line, index);
		if (proxy) proxies.push(proxy);
		else unsupported.push(String(line).trim());
	});
	if (!proxies.length)
		return { text: configText, note: _('No supported local proxy links were found; the saved YAML is shown as-is.') };
	const providerStart = configText.indexOf('proxy-providers:');
	const groupStart = configText.indexOf('proxy-groups:', providerStart);
	const rulesStart = configText.indexOf('rules:', groupStart);
	if (providerStart < 0 || groupStart < 0)
		return { text: configText, note: _('The saved YAML is not an automatic provider profile, so it is shown as-is.') };
	const head = configText.slice(0, providerStart).trimEnd();
	const tail = rulesStart >= 0 ? configText.slice(rulesStart).trim() : '';
	const lines = [ '# Standalone snapshot generated by Freenetic.', '# Runtime still uses the provider-based configuration.', head, '', 'proxies:' ];
	proxies.forEach(proxy => emitYamlProxy(lines, proxy));
	lines.push('', 'proxy-groups:', '  - name: PROXY', '    type: select', '    proxies:');
	proxies.forEach(proxy => lines.push('      - ' + yamlScalar(proxy.name)));
	if (tail) lines.push('', tail);
	if (unsupported.length) {
		lines.push('', '# Unsupported source links were not expanded:');
		unsupported.forEach(line => lines.push('# - ' + line));
	}
	return {
		text: lines.join('\n') + '\n',
		note: unsupported.length
			? _('The snapshot expands supported URI links. Unsupported links are kept as comments at the bottom.')
			: _('The snapshot expands local URI links into proxies. It is for review/export; automatic mode keeps the provider file.')
	};
}

function downloadText(filename, text) {
	const url = URL.createObjectURL(new Blob([ text || '' ], { type: 'text/yaml;charset=utf-8' }));
	const link = E('a', { href: url, download: filename });
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(url);
}

return view.extend({
	load() {
		return Promise.all([
			apiCall('status').catch(() => null),
			fs.exec_direct(PACKAGE_HELPER, [ 'status' ], 'json').catch(() => null),
			apiCall('config').catch(() => null)
		]);
	},

	render(data) {
		const packageStatus = data && data[1];
		const status = packageStatus && packageStatus.installed ? data[0] : null;
		this.status = status || {};
		this.configText = data && data[2] && data[2].text || '';
		if (!packageStatus || !packageStatus.installed)
			return this.renderMissing();
		return this.renderInstalled();
	},

	renderMissing() {
		return E('section', { class: 'fn-card fn-zapret-missing' }, [
			E('div', { class: 'fn-card-head' }, [ E('h3', {}, _('Mihomo')) ]),
			E('div', { class: 'fn-card-body' }, [
				E('strong', {}, _('Mihomo is not installed')),
				E('p', {}, _('Install Mihomo from Applications to convert proxy links and subscriptions on the router.')),
				E('a', { class: 'fn-settings-btn fn-settings-btn-primary', href: applicationsUrl() }, _('Open Applications'))
			])
		]);
	},

	renderInstalled() {
		const status = this.status || {};
		const sourceMode = status.source_mode === 'subscriptions' ? 'subscriptions' : 'links';
		const editMode = E('select', { class: 'fn-settings-input fn-mihomo-edit-mode' }, [
			E('option', { value: 'automatic' }, _('Automatic import')),
			E('option', { value: 'manual' }, _('Manual YAML'))
		]);
		const mode = E('select', { class: 'fn-settings-input' }, [
			E('option', { value: 'links' }, _('Proxy links')),
			E('option', { value: 'subscriptions' }, _('Subscriptions'))
		]);
		mode.value = sourceMode;
		const input = E('textarea', {
			class: 'fn-settings-input fn-mihomo-input',
			rows: 8,
			wrap: 'off',
			placeholder: sourceMode === 'links' ? _('vless://, vmess://, ss:// or trojan:// — one per line') : _('https://example.com/subscription — one URL per line')
		}, status.provider_input || '');
		const port = E('input', { class: 'fn-settings-input', type: 'number', min: 1, max: 65535, value: status.mixed_port || 7890 });
		const allowLan = checkbox(_('Allow access from LAN'), !!status.allow_lan);
		const webUi = checkbox(_('Open Mihomo Web UI'), !!status.web_ui);
		const blockStatus = status.blocks || {};
		const secureDns = checkbox(_('Secure DNS through https-dns-proxy'), !!blockStatus.secure_dns);
		const tun = checkbox(_('Transparent TUN mode'), !!blockStatus.tun);
		const dnsPolicy = E('select', { class: 'fn-settings-input' }, [
			E('option', { value: 'default' }, _('Default DNS policy')),
			E('option', { value: 'split' }, _('Split DNS for local domains'))
		]);
		dnsPolicy.value = blockStatus.dns_policy === 'split' ? 'split' : 'default';
		const secureDnsInput = secureDns.querySelector('input');
		const tunInput = tun.querySelector('input');
		if (!blockStatus.https_dns_proxy_installed && !blockStatus.secure_dns)
			secureDnsInput.disabled = true;
		if (blockStatus.tun_available === false && !blockStatus.tun)
			tunInput.disabled = true;
		const secureDnsHint = blockStatus.https_dns_proxy_installed
			? _('The local DoH proxy will use Mihomo as its HTTP upstream.')
			: E([], [ _('Install https-dns-proxy from '), E('a', { href: applicationsUrl('dot_doh') }, _('Applications')), _(' to enable this block.') ]);
		const tunHint = blockStatus.tun_available === false
			? _('The router has no /dev/net/tun device. Install or enable kmod-tun first.')
			: _('Routes client traffic through Mihomo and hijacks DNS requests.');
		const manualConfig = E('textarea', {
			class: 'fn-settings-input fn-mihomo-input fn-mihomo-raw-input',
			rows: 18,
			wrap: 'off',
			spellcheck: 'false',
			placeholder: _('Paste a complete Mihomo YAML configuration')
		}, this.configText || '');
		const apply = E('button', { class: 'fn-settings-btn fn-settings-btn-primary', type: 'button' }, _('Apply configuration'));
		const effective = E('button', { class: 'fn-settings-btn fn-mihomo-compact-btn', type: 'button', click: () => this.showEffectiveConfig() }, _('Show effective YAML'));
		const serviceButtons = [ 'start', 'stop', 'restart' ].map(action => E('button', {
			class: 'fn-settings-btn fn-mihomo-compact-btn', type: 'button', click: () => this.service(action)
		}, { start: _('Start'), stop: _('Stop'), restart: _('Restart') }[action]));
		const logButton = E('button', { class: 'fn-settings-btn fn-mihomo-compact-btn', type: 'button', click: () => this.showLogs() }, _('Logs'));
		const log = E('pre', { class: 'fn-mihomo-log', hidden: true });
		const autoFields = E('div', { class: 'fn-mihomo-auto-fields' }, [
			inputField(_('Source type'), mode, _('Mihomo parses links and remote subscriptions itself.')),
			inputField(_('Sources'), input, _('One item per line. Existing local links are loaded when available.')),
			inputField(_('Mixed port'), port, _('Port exposed by Mihomo for local clients.')),
			E('div', { class: 'fn-mihomo-checks' }, [ allowLan, webUi ]),
			E('div', { class: 'fn-mihomo-blocks' }, [
				E('strong', {}, _('Built-in blocks')),
				inputField(_('Secure DNS'), secureDns, secureDnsHint),
				inputField(_('Transparent mode'), tun, tunHint),
				inputField(_('DNS policy'), dnsPolicy, _('Split policy keeps local domains on the router resolver.'))
			])
		]);
		const manualFields = E('div', { class: 'fn-mihomo-manual-fields', hidden: true }, [
			inputField(_('Raw Mihomo configuration'), manualConfig,
				_('The YAML is validated by Mihomo before the service is restarted.'))
		]);

		const syncEditor = () => {
			const manual = editMode.value === 'manual';
			autoFields.hidden = manual;
			manualFields.hidden = !manual;
			uiHelper.content(apply, manual ? _('Validate and apply YAML') : _('Apply configuration'));
		};

		mode.addEventListener('change', () => {
			input.placeholder = mode.value === 'links'
				? _('vless://, vmess://, ss:// or trojan:// — one per line')
				: _('https://example.com/subscription — one URL per line');
		});
		editMode.addEventListener('change', syncEditor);
		apply.addEventListener('click', () => editMode.value === 'manual'
			? this.applyRawConfig({ config: manualConfig, apply })
			: this.applyConfig({ mode, input, port, allowLan, webUi, secureDns, tun, dnsPolicy, apply }));
		this.mihomoFields = { editMode, mode, input, port, allowLan, webUi, secureDns, tun, dnsPolicy, manualConfig, apply, log };
		syncEditor();

		return E('div', { class: 'fn-mihomo-page' }, [
			E('div', { class: 'fn-card fn-mihomo-hero' }, [
				E('div', { class: 'fn-card-head' }, [ E('h3', {}, _('Mihomo')), statusPill(status) ]),
				E('div', { class: 'fn-card-body' }, [
					E('p', { class: 'fn-info-empty' }, _('Mihomo converts proxy links and subscriptions locally on the router. No Node.js or cloud converter is required.')),
					E('div', { class: 'fn-mihomo-meta' }, [
						E('span', {}, _('Version: %s').format(status.version || _('Unknown'))),
						E('span', {}, _('Controller: %s').format(status.controller || '127.0.0.1:9090'))
					])
				])
			]),
			E('div', { class: 'fn-mihomo-layout' }, [
				E('section', { class: 'fn-card fn-mihomo-card' }, [
					E('div', { class: 'fn-card-head' }, [ E('h3', {}, _('Configuration')) ]),
					E('div', { class: 'fn-card-body' }, [
						inputField(_('Editor mode'), editMode, _('Use links or edit the complete Mihomo YAML manually.')),
						autoFields,
						manualFields,
						E('div', { class: 'fn-mihomo-actions' }, [ apply, effective ])
					])
				]),
				E('section', { class: 'fn-card fn-mihomo-card' }, [
					E('div', { class: 'fn-card-head' }, [ E('h3', {}, _('Service')), statusPill(status) ]),
					E('div', { class: 'fn-card-body' }, [
						E('div', { class: 'fn-mihomo-service-actions' }, serviceButtons.concat([ logButton ])),
						log
					])
				])
			])
		]);
	},

	applyConfig(fields) {
		const button = fields.apply;
		button.disabled = true;
		uiHelper.content(button, _('Applying…'));
		return apiCall('apply', {
			source_mode: fields.mode.value,
			input: fields.input.value,
			mixed_port: Number(fields.port.value),
			allow_lan: fields.allowLan.querySelector('input').checked,
			web_ui: fields.webUi.querySelector('input').checked,
			secure_dns: fields.secureDns.querySelector('input').checked,
			tun: fields.tun.querySelector('input').checked,
			dns_policy: fields.dnsPolicy.value
		}).then(result => {
			this.status = result.status || this.status;
			notify(_('Mihomo configuration applied.'), 'info');
			return this.refreshStatus();
		}).catch(error => notify(_('Failed to apply Mihomo configuration: %s').format(error.message || error), 'danger'))
			.finally(() => {
				button.disabled = false;
				uiHelper.content(button, _('Apply configuration'));
			});
	},

	applyRawConfig(fields) {
		const button = fields.apply;
		button.disabled = true;
		uiHelper.content(button, _('Validating…'));
		return apiCall('apply_raw', { config: fields.config.value })
			.then(result => {
				this.status = result.status || this.status;
				this.configText = fields.config.value;
				notify(_('Manual Mihomo configuration applied.'), 'info');
				return this.refreshStatus();
			})
			.catch(error => notify(_('Failed to apply manual Mihomo configuration: %s').format(error.message || error), 'danger'))
			.finally(() => {
				button.disabled = false;
				uiHelper.content(button, _('Validate and apply YAML'));
			});
	},

	showEffectiveConfig() {
		const fields = this.mihomoFields || {};
		const sourceMode = this.status && this.status.source_mode || (fields.mode && fields.mode.value) || 'links';
		const source = this.status && this.status.provider_input
			|| (fields.input && fields.mode && fields.mode.value === 'links' ? fields.input.value : '');
		const result = effectiveYaml(this.configText || '', sourceMode, source);
		const textarea = E('textarea', {
			class: 'fn-settings-input fn-mihomo-effective-input',
			rows: 26,
			wrap: 'off',
			spellcheck: 'false'
		}, result.text || '');
		textarea.readOnly = true;
		const copy = E('button', { class: 'fn-settings-btn fn-mihomo-compact-btn', type: 'button', click: () => {
			const copied = navigator.clipboard && navigator.clipboard.writeText
				? navigator.clipboard.writeText(result.text || '')
				: Promise.reject(new Error(_('Clipboard access is unavailable.')));
			return copied.then(() => notify(_('Effective YAML copied.'), 'info'))
				.catch(() => {
					textarea.focus(); textarea.select();
					try { document.execCommand('copy'); notify(_('Effective YAML copied.'), 'info'); }
					catch (error) { notify(_('Clipboard access is unavailable.'), 'warning'); }
				});
		} }, _('Copy YAML'));
		const download = E('button', { class: 'fn-settings-btn fn-mihomo-compact-btn', type: 'button', click: () => downloadText('mihomo-effective.yaml', result.text) }, _('Download YAML'));
		ui.showModal(_('Effective YAML'), [
			E('p', { class: 'fn-field-hint fn-mihomo-effective-note' }, result.note),
			textarea,
			E('div', { class: 'fn-mihomo-modal-actions' }, [ copy, download ])
		]);
	},

	service(action) {
		return apiCall('service', { action: action })
			.then(result => {
				this.status = result.status || this.status;
				notify(_('Mihomo service updated.'), 'info');
				return this.refreshStatus();
			})
			.catch(error => notify(_('Mihomo service action failed: %s').format(error.message || error), 'danger'));
	},

	showLogs() {
		const log = this.mihomoFields && this.mihomoFields.log;
		if (!log)
			return;
		log.hidden = false;
		log.textContent = _('Loading logs…');
		return apiCall('logs').then(data => {
			log.textContent = data.text || _('No logs yet.');
		}).catch(error => { log.textContent = error.message || String(error); });
	},

	refreshStatus() {
		return apiCall('status').then(status => {
			this.status = status;
			const previousConfig = this.configText || '';
			return apiCall('config').then(data => {
				const text = data && data.text || '';
				const fields = this.mihomoFields;
				const manual = fields && fields.editMode && fields.editMode.value === 'manual';
				const untouched = fields && fields.manualConfig && fields.manualConfig.value === previousConfig;
				this.configText = text || this.configText || '';
				if (fields && fields.manualConfig && (!manual || untouched))
					fields.manualConfig.value = this.configText;
				return status;
			}).catch(() => status);
		});
	},

	addFooter() { return E([]); }
});
