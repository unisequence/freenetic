'use strict';
'require view';
'require ui';
'require uci';
'require fs';
'require freenetic-rpc as rpc';
'require freenetic-ui as uiHelper';

/*
 * Other Connections is intentionally a small editor over OpenWrt's native
 * network UCI model.  WireGuard, AmneziaWG and OpenVPN are native netifd
 * protocols; AWG options are never written to a regular wireguard section,
 * while OpenVPN profiles stay as provider-supplied files.  This keeps
 * configurations usable from stock LuCI and makes optional packages explicit
 * capabilities instead of hidden runtime dependencies.
 */
const ubusCall = rpc.call;
const dom_empty = uiHelper.empty;
const dom_content = uiHelper.content;
const notify = uiHelper.notify;
const notifyLong = uiHelper.notifyLong;
const applyChanges = uiHelper.applyChanges;

const NETWORK_RESTART_HELPER = '/usr/libexec/freenetic-network-restart';

const WG_PROTO = 'wireguard';
const AWG_PROTO = 'amneziawg';
const OVPN_PROTO = 'openvpn';
const L2TP_PROTO = 'l2tp';
const XFRM_PROTO = 'xfrm';
const L2TP_IPSEC_PROTO = 'l2tp_ipsec';
const IKEV2_PROTO = 'ikev2';
const WG_PEER_TYPE = 'wireguard_';
const AWG_PEER_TYPE = 'amneziawg_';
const IPSEC_CONFIG = 'ipsec';
const IPSEC_GLOBALS = 'globals';
const OPENVPN_PROFILE_DIR = '/etc/openvpn/freenetic';
const OPENVPN_PROFILE_HELPER = '/usr/libexec/freenetic-openvpn-profile';
const OPENVPN_PROFILE_MAX = 512 * 1024;
const IPSEC_RESTART_HELPER = '/usr/libexec/freenetic-ipsec-restart';
const IPSEC_STATUS_HELPER = '/usr/libexec/freenetic-ipsec-status';
const L2TP_IPSEC_PACKAGES = [ 'xl2tpd', 'ppp-mod-pppol2tp', 'kmod-l2tp', 'kmod-pppol2tp', 'strongswan-default', 'luci-proto-ppp' ];
const IKEV2_PACKAGES = [ 'strongswan-default', 'strongswan-mod-eap-identity', 'strongswan-mod-eap-mschapv2', 'xfrm', 'kmod-xfrm-interface', 'luci-proto-xfrm' ];

const OPENVPN_VARIANTS = [ 'openvpn-openssl', 'openvpn-mbedtls', 'openvpn-wolfssl', 'openvpn' ];

const AWG_OPTIONS = [
	[ 'awg_jc', 'Jc', 0, 65535 ],
	[ 'awg_jmin', 'Jmin', 0, 65535 ],
	[ 'awg_jmax', 'Jmax', 0, 65535 ],
	[ 'awg_s1', 'S1', 0, 65535 ],
	[ 'awg_s2', 'S2', 0, 65535 ],
	[ 'awg_h1', 'H1', 0, 4294967295 ],
	[ 'awg_h2', 'H2', 0, 4294967295 ],
	[ 'awg_h3', 'H3', 0, 4294967295 ],
	[ 'awg_h4', 'H4', 0, 4294967295 ]
];

const KEY_RE = /^[A-Za-z0-9+/]{43}=$/;
const IPV4_RE = /^(?:\d{1,3}\.){3}\d{1,3}$/;
const HOST_RE = /^[A-Za-z0-9._:[\]%~-]+$/;

function restartNetifd() {
	return fs.exec_direct(NETWORK_RESTART_HELPER, [], 'json').then(result => {
		if (!result || result.ok !== true)
			throw new Error(result && result.error || _('The network service did not restart.'));
		return result;
	});
}

function restartIpsec() {
	return fs.exec_direct(IPSEC_RESTART_HELPER, [], 'json').then(result => {
		if (!result || result.ok !== true)
			throw new Error(result && result.error || _('The IPsec service did not restart.'));
		return result;
	});
}

function listValue(value) {
	if (value == null || value === '')
		return [];
	return Array.isArray(value) ? value.slice() : [ value ];
}

function listText(value) {
	return listValue(value).join(', ');
}

function parseList(value) {
	return String(value || '').replace(/[\r\n,]+/g, ' ').split(/\s+/).map(v => v.trim()).filter(Boolean);
}

function sectionName(section) {
	return section && (section['.name'] || section.name);
}

/* UCI section names are intentionally short and deterministic.  Provider
 * names are user-controlled, so never use them directly as IPsec section
 * identifiers (UCI limits names to 15 characters on some releases). */
function sectionToken(value) {
	let hash = 0;
	String(value || '').split('').forEach(character => {
		hash = ((hash << 5) - hash + character.charCodeAt(0)) | 0;
	});
	return (hash >>> 0).toString(36).slice(0, 7) || 'default';
}

function managedIpsecSection(prefix, value) {
	return prefix + sectionToken(value);
}

function ipsecSection(config, type, name) {
	return uci.sections(config, type).find(section => sectionName(section) === name) || null;
}

function ipsecList(section, option) {
	return listValue(section && section[option]);
}

function validSecret(value, optional) {
	value = String(value || '');
	return optional && !value || value.length > 0 && value.length <= 4096 &&
		value.indexOf('\0') === -1 && value.indexOf('\r') === -1 && value.indexOf('\n') === -1 &&
		value.indexOf('"') === -1 && value.indexOf('\\') === -1;
}

function validSelector(value) {
	value = String(value || '').trim();
	if (!value)
		return false;
	return validAddress(value);
}

function validServer(value) {
	const endpoint = parseEndpoint(value);
	return !!endpoint.host && validHost(endpoint.host) && validPort(endpoint.port, true);
}

function ipsecProtocolLabel(protocol) {
	return protocol === L2TP_IPSEC_PROTO ? _('L2TP/IPsec') : _('IKEv2/IPsec');
}

function validKey(value, optional) {
	value = String(value || '').trim();
	return optional && !value || value === 'generate' || KEY_RE.test(value);
}

function validIPv4(value) {
	if (!IPV4_RE.test(String(value || '')))
		return false;
	return String(value).split('.').every(part => +part >= 0 && +part <= 255);
}

function validAddress(value) {
	value = String(value || '').trim();
	const parts = value.split('/');
	if (parts.length > 2 || !parts[0])
		return false;
	if (parts[0].indexOf(':') !== -1) {
		if (!/^[0-9a-f:]+$/i.test(parts[0]) || (parts[0].match(/::/g) || []).length > 1)
			return false;
		const groups = parts[0].split('::');
		const count = p => p ? p.split(':').filter(Boolean).length : 0;
		if (groups.length === 1 && count(groups[0]) !== 8)
			return false;
		if (groups.length === 2 && count(groups[0]) + count(groups[1]) >= 8)
			return false;
		return parts.length === 1 || /^\d+$/.test(parts[1]) && +parts[1] <= 128;
	}
	return validIPv4(parts[0]) && (parts.length === 1 || /^\d+$/.test(parts[1]) && +parts[1] <= 32);
}

function validHost(value) {
	value = String(value || '').trim();
	return !value || HOST_RE.test(value);
}

function validPort(value, optional) {
	value = String(value || '').trim();
	return optional && !value || /^\d+$/.test(value) && +value > 0 && +value <= 65535;
}

function validNumber(value, min, max) {
	value = String(value || '').trim();
	return !value || /^\d+$/.test(value) && +value >= min && +value <= max;
}

function formatBytes(value) {
	value = +value || 0;
	if (value < 1024)
		return '%d B'.format(value);
	if (value < 1024 * 1024)
		return '%.1f KiB'.format(value / 1024);
	if (value < 1024 * 1024 * 1024)
		return '%.1f MiB'.format(value / (1024 * 1024));
	return '%.2f GiB'.format(value / (1024 * 1024 * 1024));
}

function formatAge(seconds) {
	seconds = +seconds || 0;
	if (!seconds)
		return _('Never');
	const age = Math.max(0, Math.floor(Date.now() / 1000) - seconds);
	if (age < 60)
		return _('%d sec ago').format(age);
	if (age < 3600)
		return _('%d min ago').format(Math.floor(age / 60));
	if (age < 86400)
		return _('%d h ago').format(Math.floor(age / 3600));
	return _('%d d ago').format(Math.floor(age / 86400));
}

function shortKey(value) {
	value = String(value || '');
	return value ? value.slice(0, 8) + '…' + value.slice(-6) : '–';
}

function svgIcon(d, size) {
	size = size || 20;
	const span = E('span', { class: 'fn-icon' });
	span.innerHTML = '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">' +
		'<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
	return span;
}

function getInterfaceDump() {
	return ubusCall('network.interface', 'dump', { verbose: true }).catch(() => ({}));
}

function normalizeDumpStatus(data) {
	const result = {};
	Object.keys(data || {}).forEach(name => {
		const device = data[name] || {};
		const peers = {};
		(device.peers || []).forEach(peer => {
			if (!peer || !peer.public_key)
				return;
			peers[peer.public_key] = {
				last_handshake: +peer.latest_handshake || 0,
				rx_bytes: +peer.transfer_rx || 0,
				tx_bytes: +peer.transfer_tx || 0,
				endpoint: peer.endpoint || ''
			};
		});
		result[name] = {
			public_key: device.public_key || '',
			listen_port: device.listen_port || '',
			fwmark: device.fwmark || '',
			peers: peers
		};
	});
	return result;
}

function getWireGuardStatus() {
	return Promise.all([
		ubusCall('luci.wireguard', 'getWgInstances', {}).then(data => ({ available: true, data: normalizeDumpStatus(data) }))
			.catch(() => ({ available: false, data: {} })),
		ubusCall('wireguard', 'status', {}).then(data => ({ available: true, data: data || {} }))
			.catch(() => ({ available: false, data: {} })),
		ubusCall('luci.amneziawg', 'getWgInstances', {}).then(data => ({ available: true, data: normalizeDumpStatus(data) }))
			.catch(() => ({ available: false, data: {} }))
	]).then(results => ({
		available: results.some(item => item.available),
		data: Object.assign({}, results[0].data, results[1].data, results[2].data)
	}));
}

function normalizeKeyPair(result) {
	const value = result && result.keys || result || {};
	return { private: value.private || value.priv || '', public: value.public || value.pub || '' };
}

function generateKeyPair() {
	return ubusCall('luci.wireguard', 'generateKeyPair', {}).then(normalizeKeyPair)
		.then(result => result.private && result.public ? result : Promise.reject(new Error('empty key pair')))
		.catch(() => ubusCall('wireguard', 'genkey', {}).then(normalizeKeyPair))
		.then(result => result.private && result.public ? result : Promise.reject(new Error('empty key pair')))
		.catch(() => ubusCall('luci.amneziawg', 'generateKeyPair', {}).then(normalizeKeyPair))
		.then(result => result.private && result.public ? result : Promise.reject(new Error('empty key pair')));
}

function derivePublicKey(privateKey) {
	const normalizePublic = result => result && result.public || result && result.pub || '';
	return ubusCall('luci.wireguard', 'getPublicAndPrivateKeyFromPrivate', { privkey: privateKey }).then(result => {
		const value = result && result.keys || result || {};
		return value.public || value.pub || '';
	}).then(result => result || Promise.reject(new Error('empty public key')))
		.catch(() => ubusCall('wireguard', 'pubkey', { private: privateKey }).then(normalizePublic))
		.then(result => result || Promise.reject(new Error('empty public key')))
		.catch(() => ubusCall('luci.amneziawg', 'getPublicAndPrivateKeyFromPrivate', { privkey: privateKey })
			.then(result => {
				const value = result && result.keys || result || {};
				return value.public || value.pub || '';
			})
			.then(result => result || Promise.reject(new Error('empty public key'))));
}

function generatePresharedKey() {
	const normalizePsk = result => result && (result.preshared || result.psk) || '';
	return ubusCall('luci.wireguard', 'generatePsk', {}).then(normalizePsk)
		.then(result => result || Promise.reject(new Error('empty preshared key')))
		.catch(() => ubusCall('wireguard', 'genpsk', {}).then(normalizePsk))
		.then(result => result || Promise.reject(new Error('empty preshared key')))
		.catch(() => ubusCall('luci.amneziawg', 'generatePsk', {}).then(normalizePsk))
		.then(result => result || Promise.reject(new Error('empty preshared key')));
}

function getInstalledPackages() {
	return fs.exec_direct('/usr/libexec/package-manager-call', [ 'list-installed' ], 'json')
		.then(list => Array.isArray(list) ? list : []).catch(() => []);
}

function openvpnAvailable(packages) {
	packages = packages || {};
	return OPENVPN_VARIANTS.some(name => !!packages[name]);
}

function openvpnProfileName(section) {
	return String(section || '').replace(/[^A-Za-z0-9_-]/g, '_') || 'connection';
}

function openvpnProfilePath(section) {
	return OPENVPN_PROFILE_DIR + '/' + openvpnProfileName(section) + '.ovpn';
}

function managedOpenvpnProfile(path) {
	return String(path || '').indexOf(OPENVPN_PROFILE_DIR + '/') === 0 &&
		/\/[-A-Za-z0-9_]+\.ovpn$/.test(String(path || ''));
}

function openvpnProfileNameFromPath(path) {
	const prefix = OPENVPN_PROFILE_DIR + '/';
	const filename = String(path || '').indexOf(prefix) === 0 ? String(path || '').slice(prefix.length) : '';
	return /^[-A-Za-z0-9_]+\.ovpn$/.test(filename) ? filename.slice(0, -5) : '';
}

function normalizeOpenvpnProfile(value) {
	return String(value || '').replace(/\r\n?/g, '\n').trim() + '\n';
}

function validateOpenvpnProfile(value) {
	const profile = String(value || '').replace(/\r\n?/g, '\n').trim();
	if (!profile)
		return _('Paste or choose an OpenVPN profile first.');
	if (profile.indexOf('\0') !== -1)
		return _('The OpenVPN profile contains an invalid NUL character.');
	if (profile.length > OPENVPN_PROFILE_MAX)
		return _('The OpenVPN profile is too large (maximum %d KiB).').format(Math.floor(OPENVPN_PROFILE_MAX / 1024));
	/* A profile can be a client, server or provider bundle.  Do not try to
	 * rewrite directives here: OpenVPN's own parser remains the source of
	 * truth, while this check catches an accidental empty/text upload. */
	if (!/(^|\n)\s*(client|server|remote|dev|proto)\b/im.test(profile))
		return _('The file does not look like an OpenVPN profile.');
	return null;
}

function storeOpenvpnProfile(name, profile) {
	const temporary = '/tmp/freenetic-openvpn-' + name + '.ovpn';
	return fs.write(temporary, normalizeOpenvpnProfile(profile), 384 /* 0600 */)
		.then(() => fs.exec_direct(OPENVPN_PROFILE_HELPER, [ 'install', name ], 'json'))
		.then(result => {
			if (!result || result.ok !== true)
				throw new Error(result && result.error || _('Unable to install the OpenVPN profile.'));
			return result;
		});
}

function removeOpenvpnProfile(name) {
	if (!name)
		return Promise.resolve({ ok: true });
	return fs.exec_direct(OPENVPN_PROFILE_HELPER, [ 'remove', name ], 'json').then(result => {
		if (!result || result.ok !== true)
			throw new Error(result && result.error || _('Unable to remove the OpenVPN profile.'));
		return result;
	});
}

function getFeedStatus() {
	return fs.exec_direct('/usr/libexec/freenetic-awg-feed', [ 'status' ], 'json')
		.then(result => result && typeof result === 'object' ? result : null).catch(() => null);
}

function getIpsecStatus() {
	return fs.exec_direct(IPSEC_STATUS_HELPER, [], 'json')
		.then(result => result && typeof result === 'object' ? result : {
			ok: false,
			available: false,
			error: _('The IPsec status helper is unavailable.')
		})
		.catch(error => ({
			ok: false,
			available: false,
			error: error && (error.message || error) || _('The IPsec status helper is unavailable.')
		}));
}

function packageMap(list) {
	const result = {};
	(list || []).forEach(item => {
		if (item && item.name)
			result[item.name] = true;
	});
	return result;
}

function peerType(protocol) {
	return protocol === AWG_PROTO ? AWG_PEER_TYPE : WG_PEER_TYPE;
}

function peerSectionsFor(name) {
	const result = [];
	const seen = {};
	[ WG_PEER_TYPE + name, AWG_PEER_TYPE + name ].forEach(type => {
		uci.sections('network', type).forEach(section => {
			const id = sectionName(section);
			if (id && !seen[id]) {
				seen[id] = true;
				result.push(section);
			}
		});
	});
	return result;
}

function parseEndpoint(value) {
	value = String(value || '').trim();
	if (!value)
		return { host: '', port: '' };
	let match = value.match(/^\[([^\]]+)\](?::(\d+))?$/);
	if (!match) {
		const colon = value.lastIndexOf(':');
		if (colon > -1 && /^\d+$/.test(value.slice(colon + 1)))
			match = [ value, value.slice(0, colon), value.slice(colon + 1) ];
	}
	return match ? { host: match[1], port: match[2] || '' } : { host: value, port: '' };
}

function parseConfig(text) {
	const lines = String(text || '').split(/\r?\n/);
	let section = '';
	const config = { peers: [], awg: {} };
	let currentPeer = null;
	const knownAwg = {};
	AWG_OPTIONS.forEach(item => { knownAwg[item[1].toLowerCase()] = item[0]; });

	lines.forEach(raw => {
		const line = raw.replace(/\s*[#;].*$/, '').trim();
		if (!line)
			return;
		const header = line.match(/^\[\s*(interface|peer)\s*\]$/i);
		if (header) {
			section = header[1].toLowerCase();
			currentPeer = section === 'peer' ? {} : null;
			if (currentPeer)
				config.peers.push(currentPeer);
			return;
		}
		const item = line.match(/^([^=]+?)\s*=\s*(.*)$/);
		if (!item || !section)
			return;
		const key = item[1].trim().toLowerCase();
		const value = item[2].trim();
		const target = section === 'peer' ? currentPeer : config;
		if (!target)
			return;
		if (section === 'interface') {
			if (key === 'privatekey') target.privateKey = value;
			else if (key === 'address' || key === 'addresses') target.addresses = parseList(value);
			else if (key === 'listenport') target.listenPort = value;
			else if (key === 'mtu') target.mtu = value;
			else if (key === 'fwmark') target.fwmark = value;
			else if (key === 'dns') target.dns = parseList(value);
			else if (knownAwg[key]) { target.awg[knownAwg[key]] = value; target.protocol = AWG_PROTO; }
		}
		else if (key === 'publickey') target.publicKey = value;
		else if (key === 'privatekey') target.privateKey = value;
		else if (key === 'presharedkey') target.presharedKey = value;
		else if (key === 'allowedips') target.allowedIps = parseList(value);
		else if (key === 'endpoint') {
			target.endpoint = value;
			Object.assign(target, parseEndpoint(value));
		}
		else if (key === 'persistentkeepalive') target.keepalive = value;
		else if (key === 'routeallowedips') target.routeAllowed = value === '1' || value.toLowerCase() === 'true';
	});

	if (!config.privateKey || !validKey(config.privateKey, false))
		return { error: _('PrivateKey is missing or invalid.') };
	if (!config.addresses || !config.addresses.every(validAddress))
		return { error: _('Address contains an invalid IP or prefix.') };
	for (const peer of config.peers) {
		if (!peer.publicKey || !validKey(peer.publicKey, false))
			return { error: _('A peer is missing a valid PublicKey.') };
		if (peer.presharedKey && !validKey(peer.presharedKey, true))
			return { error: _('A peer has an invalid PresharedKey.') };
		if (peer.allowedIps && !peer.allowedIps.every(validAddress))
			return { error: _('A peer has an invalid AllowedIPs value.') };
		if (peer.endpoint && (!peer.host || !validHost(peer.host) || !validPort(peer.port, true)))
			return { error: _('A peer has an invalid Endpoint.') };
	}

	return {
		section: null,
		name: _('Imported connection'),
		protocol: config.protocol || WG_PROTO,
		enabled: true,
		privateKey: config.privateKey,
		publicKey: '',
		addresses: config.addresses || [],
		dns: config.dns || [],
		listenPort: config.listenPort || '',
		mtu: config.mtu || '',
		fwmark: config.fwmark || '',
		nohostroute: false,
		awg: config.awg || {},
		peers: config.peers.map(peer => ({
			section: null,
			description: '',
			disabled: false,
			publicKey: peer.publicKey || '',
			privateKey: peer.privateKey || '',
			presharedKey: peer.presharedKey || '',
			allowedIps: peer.allowedIps || [],
			endpointHost: peer.host || '',
			endpointPort: peer.port || '',
			keepalive: peer.keepalive || '',
			routeAllowed: !!peer.routeAllowed
		}))
	};
}

function endpointText(host, port) {
	if (!host)
		return port ? '*:%s'.format(port) : '–';
	const displayed = host.indexOf(':') !== -1 && host[0] !== '[' ? '[' + host + ']' : host;
	return port ? displayed + ':' + port : displayed;
}

function serializeConfig(connection) {
	const lines = [ '[Interface]' ];
	if (connection.privateKey)
		lines.push('PrivateKey = ' + connection.privateKey);
	if (connection.addresses && connection.addresses.length)
		lines.push('Address = ' + connection.addresses.join(', '));
	if (connection.listenPort)
		lines.push('ListenPort = ' + connection.listenPort);
	if (connection.mtu)
		lines.push('MTU = ' + connection.mtu);
	if (connection.fwmark)
		lines.push('FwMark = ' + connection.fwmark);
	if (connection.dns && connection.dns.length)
		lines.push('DNS = ' + connection.dns.join(', '));
	if (connection.protocol === AWG_PROTO) {
		AWG_OPTIONS.forEach(item => {
			const value = connection.awg && connection.awg[item[0]];
			if (value)
				lines.push(item[1] + ' = ' + value);
		});
	}

	(connection.peers || []).forEach(peer => {
		lines.push('', '[Peer]');
		if (peer.publicKey) lines.push('PublicKey = ' + peer.publicKey);
		if (peer.privateKey) lines.push('PrivateKey = ' + peer.privateKey);
		if (peer.presharedKey) lines.push('PresharedKey = ' + peer.presharedKey);
		if (peer.allowedIps && peer.allowedIps.length) lines.push('AllowedIPs = ' + peer.allowedIps.join(', '));
		if (peer.endpointHost) lines.push('Endpoint = ' + endpointText(peer.endpointHost, peer.endpointPort));
		if (peer.keepalive) lines.push('PersistentKeepalive = ' + peer.keepalive);
	});

	return lines.join('\n') + '\n';
}

return view.extend({
	load() {
		return Promise.all([
			uci.load('network'),
			getInterfaceDump(),
			getWireGuardStatus(),
			getInstalledPackages(),
			getFeedStatus(),
			uci.load(IPSEC_CONFIG).catch(() => null),
			getIpsecStatus()
		]);
	},

	render(data) {
		window.__freeneticActiveView = this;
		this.interfaceDump = data[1] || {};
		this.wgRpc = data[2] || { available: false, data: {} };
		this.packages = packageMap(data[3]);
		this.feed = data[4];
		this.ipsecAvailable = data[5] !== null;
		this.ipsecStatus = data[6] || { ok: false, available: false, error: _('The IPsec status helper is unavailable.') };
		this.modalOpen = false;

		this.supportNode = E('div');
		this.listNode = E('div');
		this.renderSupport();
		this.fillConnections();
		this.startIpsecPolling();

		return E('div', { class: 'fn-pf-page fn-oc-page' }, [
			E('div', { class: 'fn-oc-title-row' }, [
				E('div', {}, [
					E('h1', { class: 'fn-pf-title' }, _('Other Connections')),
					E('p', { class: 'fn-pf-description' }, _('Manage additional VPN and tunnel connections through the OpenWrt network stack.'))
				]),
				E('div', { class: 'fn-oc-head-actions' }, [
					E('button', { type: 'button', class: 'fn-settings-btn', click: () => this.openImportDialog() }, _('Import .conf')),
					E('button', { type: 'button', class: 'fn-settings-btn', click: () => this.openOpenvpnImportDialog() }, _('Import .ovpn')),
					E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', click: () => this.openForm(null) }, _('Add connection'))
				])
			]),
			this.supportNode,
			E('section', { class: 'fn-oc-connections' }, [ this.listNode ])
		]);
	},

	renderSupport() {
		if (!this.supportNode)
			return;
		dom_empty(this.supportNode);
		const wgTools = !!this.packages['wireguard-tools'];
		const wgKernel = !!this.packages['kmod-wireguard'];
		const wgReady = wgTools && wgKernel;
		const awgInstalled = this.awgAvailable();
		const cards = [];
		const wgMissing = [];
		if (!wgTools) wgMissing.push('wireguard-tools');
		if (!wgKernel) wgMissing.push('kmod-wireguard');
		const wgBody = [ E('span', {}, wgReady
			? _('Native OpenWrt kernel protocol is ready.')
			: _('Required package(s) are missing: %s.').format(wgMissing.join(', '))) ];
		if (!wgReady)
			wgBody.push(E('a', { href: L.url('admin/system/applications'), class: 'fn-oc-support-link' }, _('Open Applications')));
		cards.push(E('section', { class: 'fn-oc-support-card fn-oc-support-card-wireguard' }, [
			E('div', { class: 'fn-oc-support-head' }, [
				E('div', { class: 'fn-oc-support-title' }, [
					E('h3', {}, _('WireGuard')),
					E('p', {}, _('Standard kernel-based VPN protocol'))
				]),
				E('span', { class: 'fn-status-pill ' + (wgReady ? 'fn-status-ok' : 'fn-status-off') }, wgReady ? _('Ready') : _('Unavailable'))
			]),
			E('div', { class: 'fn-oc-support-body' }, wgBody)
		]));

		const ovpnReady = openvpnAvailable(this.packages);
		const ovpnBody = [ E('span', {}, ovpnReady
			? _('OpenVPN netifd protocol is ready.')
			: _('Install an OpenVPN package to create or start an OpenVPN tunnel.')) ];
		if (!ovpnReady)
			ovpnBody.push(E('a', { href: L.url('admin/system/applications'), class: 'fn-oc-support-link' }, _('Open Applications')));
		cards.push(E('section', { class: 'fn-oc-support-card fn-oc-support-card-openvpn' }, [
			E('div', { class: 'fn-oc-support-head' }, [
				E('div', { class: 'fn-oc-support-title' }, [
					E('h3', {}, _('OpenVPN')),
					E('p', {}, _('Profile-based VPN protocol with broad provider support'))
				]),
				E('span', { class: 'fn-status-pill ' + (ovpnReady ? 'fn-status-ok' : 'fn-status-off') }, ovpnReady ? _('Ready') : _('Unavailable'))
			]),
			E('div', { class: 'fn-oc-support-body' }, ovpnBody)
		]));

		let feedText = awgInstalled
			? _('AWG parameters are available in the connection editor.')
			: _('Optional WireGuard-compatible obfuscation with AmneziaWG parameters.');
		if (!awgInstalled && this.feed && this.feed.ok !== false && this.feed.feed_url) {
			feedText = this.feed.configured
				? _('Signed feed for %s/%s is configured, but AmneziaWG packages are not installed.').format(this.feed.target, this.feed.subtarget)
				: _('The signed AmneziaWG feed targets %s/%s. Connect it to verify and install matching packages.').format(this.feed.target, this.feed.subtarget);
			if (this.feed.version === 'SNAPSHOT')
				feedText += ' ' + _('SNAPSHOT builds may not have a matching kernel package.');
		}
		const awgBody = [ E('span', {}, feedText) ];
		if (!awgInstalled) {
			const install = E('button', { type: 'button', class: 'fn-settings-btn fn-oc-support-action', click: () => this.installAwg(install) }, _('Connect feed and install'));
			awgBody.push(install);
		}
		cards.push(E('section', { class: 'fn-oc-support-card fn-oc-support-card-awg' }, [
			E('div', { class: 'fn-oc-support-head' }, [
				E('div', { class: 'fn-oc-support-title' }, [
					E('h3', {}, _('AmneziaWG')),
					E('p', {}, _('WireGuard-compatible protocol with AWG obfuscation'))
				]),
				E('span', { class: 'fn-status-pill ' + (awgInstalled ? 'fn-status-ok' : 'fn-status-off') }, awgInstalled ? _('Ready') : _('Optional'))
			]),
			E('div', { class: 'fn-oc-support-body' }, awgBody)
		]));

		const addPackageCard = (className, title, description, packages, readyText) => {
			const missing = packages.filter(name => !this.packages[name]);
			const ready = !missing.length;
			const body = [ E('span', {}, ready
				? readyText
				: _('Required package(s) are missing: %s.').format(missing.join(', '))) ];
			if (!ready)
				body.push(E('a', { href: L.url('admin/system/applications'), class: 'fn-oc-support-link' }, _('Open Applications')));
			cards.push(E('section', { class: 'fn-oc-support-card ' + className }, [
				E('div', { class: 'fn-oc-support-head' }, [
					E('div', { class: 'fn-oc-support-title' }, [ E('h3', {}, title), E('p', {}, description) ]),
					E('span', { class: 'fn-status-pill ' + (ready ? 'fn-status-ok' : 'fn-status-off') }, ready ? _('Ready') : _('Unavailable'))
				]),
				E('div', { class: 'fn-oc-support-body' }, body)
			]));
		};

		addPackageCard('fn-oc-support-card-l2tp', _('L2TP/IPsec'),
			_('Legacy PPP tunnel protected by an IPsec transport connection.'),
			L2TP_IPSEC_PACKAGES, _('xl2tpd and strongSwan are ready.'));
		addPackageCard('fn-oc-support-card-ikev2', _('IKEv2/IPsec'),
			_('Modern IPsec VPN with PSK or EAP-MSCHAPv2 authentication.'),
			IKEV2_PACKAGES, _('strongSwan and the XFRM interface are ready.'));

		this.supportNode.appendChild(E('div', { class: 'fn-oc-support-grid' }, cards));
	},

	/* The helper reports a complete installation, but also recognize a
	 * manually-installed package set when the helper is unavailable or its
	 * state is stale.  A partial set is not enough: the kernel module, tools,
	 * and LuCI/netifd protocol must all be present before an AWG interface can
	 * be activated. */
	awgAvailable() {
		const packages = this.packages || {};
		return !!(this.feed && this.feed.installed) ||
			(!!packages['amneziawg-tools'] && !!packages['kmod-amneziawg'] && !!packages['luci-proto-amneziawg']);
	},

	getL2tpConnection(section) {
		const name = sectionName(section);
		const remoteName = section.freenetic_ipsec_remote || '';
		const childName = section.freenetic_ipsec_child || '';
		const remote = ipsecSection(IPSEC_CONFIG, 'remote', remoteName) || {};
		const child = ipsecSection(IPSEC_CONFIG, 'transport', childName) || {};
		const ikeName = listValue(remote.crypto_proposal)[0] || '';
		const espName = listValue(child.crypto_proposal)[0] || '';
		const server = section.server || listValue(remote.remote_addrs)[0] || '';
		const endpoint = parseEndpoint(server);
		return {
			section: name,
			name: section.freenetic_name || section.description || name,
			protocol: L2TP_IPSEC_PROTO,
			networkProto: L2TP_PROTO,
			enabled: section.disabled !== '1' && remote.enabled !== '0',
			server: server,
			serverHost: endpoint.host,
			username: section.username || '',
			password: section.password || '',
			psk: remote.pre_shared_key || '',
			localIdentifier: remote.local_identifier || '',
			remoteIdentifier: remote.remote_identifier || '',
			keepalive: section.keepalive || '',
			mtu: section.mtu || '',
			ipv6: section.ipv6 === '1',
			defaultRoute: /(?:^|\s)defaultroute(?:\s|$)/.test(String(section.pppd_options || '')),
			remoteSection: remoteName,
			childSection: childName,
			ikeProposalSection: ikeName,
			espProposalSection: espName,
			status: this.interfaceStatus(name)
		};
	},

	getIkev2Connection(section) {
		const name = sectionName(section);
		const remoteName = section.freenetic_ipsec_remote || '';
		const childName = section.freenetic_ipsec_child || '';
		const secretName = section.freenetic_ipsec_secret || '';
		const remote = ipsecSection(IPSEC_CONFIG, 'remote', remoteName) || {};
		const child = ipsecSection(IPSEC_CONFIG, 'tunnel', childName) || {};
		const secret = ipsecSection(IPSEC_CONFIG, 'mschapv2_secrets', secretName) || {};
		const ikeName = listValue(remote.crypto_proposal)[0] || '';
		const espName = listValue(child.crypto_proposal)[0] || '';
		const gateway = listValue(remote.remote_addrs)[0] || section.gateway || '';
		return {
			section: name,
			name: section.freenetic_name || section.description || name,
			protocol: IKEV2_PROTO,
			networkProto: XFRM_PROTO,
			enabled: section.disabled !== '1' && remote.enabled !== '0',
			gateway: gateway,
			authMethod: remote.authentication_method || 'psk',
			psk: remote.pre_shared_key || '',
			username: remote.eap_id || secret.id || '',
			password: secret.secret || '',
			caCert: listText(remote.remote_ca_certs),
			localIdentifier: remote.local_identifier || '',
			remoteIdentifier: remote.remote_identifier || '',
			localSelectors: ipsecList(child, 'local_subnet'),
			remoteSelectors: ipsecList(child, 'remote_subnet'),
			ifid: child.if_id || section.ifid || '',
			mtu: section.mtu || '',
			mobike: remote.mobike !== '0',
			encap: remote.encap === '1',
			autoStart: child.startaction === 'start' || child.startaction === 'route' || child.startaction === 'trap',
			remoteSection: remoteName,
			childSection: childName,
			secretSection: secretName,
			ikeProposalSection: ikeName,
			espProposalSection: espName,
			status: this.interfaceStatus(name)
		};
	},

	getConnections() {
		return uci.sections('network', 'interface').filter(section => {
			const proto = String(section.proto || '').toLowerCase();
			return proto === WG_PROTO || proto === AWG_PROTO || proto === OVPN_PROTO ||
				(proto === L2TP_PROTO && section.freenetic_protocol === L2TP_IPSEC_PROTO) ||
				(proto === XFRM_PROTO && section.freenetic_protocol === IKEV2_PROTO);
		}).map(section => {
			const name = sectionName(section);
			const protocol = String(section.proto || '').toLowerCase();
			if (protocol === OVPN_PROTO) {
				const profilePath = section.config || '';
				return {
					section: name,
					name: section.freenetic_name || section.description || name,
					protocol: OVPN_PROTO,
					enabled: section.disabled !== '1',
					profilePath: profilePath,
					managedProfile: section.freenetic_profile === '1' || managedOpenvpnProfile(profilePath),
					status: this.interfaceStatus(name)
				};
			}
			if (protocol === L2TP_PROTO)
				return this.getL2tpConnection(section);
			if (protocol === XFRM_PROTO)
				return this.getIkev2Connection(section);
			const peers = peerSectionsFor(name).map(peer => ({
				section: sectionName(peer),
				description: peer.description || '',
				disabled: peer.disabled === '1',
				publicKey: peer.public_key || '',
				privateKey: peer.private_key || '',
				presharedKey: peer.preshared_key || '',
				allowedIps: listValue(peer.allowed_ips),
				endpointHost: peer.endpoint_host || '',
				endpointPort: peer.endpoint_port || '',
				keepalive: peer.persistent_keepalive || '',
				routeAllowed: peer.route_allowed_ips === '1'
			}));
			const awg = {};
			AWG_OPTIONS.forEach(item => { if (section[item[0]] != null) awg[item[0]] = section[item[0]]; });
			return {
				section: name,
				name: section.freenetic_name || section.description || name,
				protocol: protocol,
				enabled: section.disabled !== '1',
				privateKey: section.private_key || '',
				publicKey: section.freenetic_public_key || '',
				addresses: listValue(section.addresses),
				dns: listValue(section.dns),
				listenPort: section.listen_port || '',
				mtu: section.mtu || '',
				fwmark: section.fwmark || '',
				nohostroute: section.nohostroute === '1',
				awg: awg,
				peers: peers,
				status: this.interfaceStatus(name),
				wireStatus: this.wgStatus(name)
			};
		});
	},

	interfaceStatus(name) {
		return (this.interfaceDump.interface || []).find(item => item.interface === name || item.l3_device === name) || null;
	},

	wgStatus(name) {
		return this.wgRpc && this.wgRpc.data && this.wgRpc.data[name] || null;
	},

	parseIpsecSas(value) {
		const result = {};
		String(value || '').split(/\r?\n/).forEach(line => {
			/* swanctl --list-sas --pretty starts each IKE SA with
			 * "<connection>: #<id>, <STATE>, ...".  Keep the parser strict
			 * enough to avoid mistaking child-SA detail lines for connections. */
			const match = line.match(/^\s*([^:\s]+):\s*#\d+,\s*([A-Z][A-Z_-]*)\b/);
			if (match)
				result[match[1]] = match[2];
		});
		return result;
	},

	ipsecSaState(connection) {
		const status = this.ipsecStatus || {};
		const sas = this.parseIpsecSas(status.sas);
		const names = [ connection.remoteSection, connection.section ].filter(Boolean);
		for (const name of names) {
			if (sas[name])
				return sas[name];
		}
		return '';
	},

	ipsecPresentation(connection) {
		const interfaceUp = !!(connection.status && connection.status.up);
		const state = this.ipsecSaState(connection);
		if (!connection.enabled)
			return { text: _('Disabled'), className: 'fn-status-off', state: state, interfaceUp: interfaceUp };
		if (state === 'ESTABLISHED' || state === 'INSTALLED')
			return { text: _('Connected'), className: 'fn-status-ok', state: state, interfaceUp: interfaceUp };
		if (/^(CONNECTING|REKEYING|ROUTED|TRAPPED|NEGOTIATING)$/.test(state))
			return { text: _('Negotiating'), className: 'fn-status-warn', state: state, interfaceUp: interfaceUp };
		if (interfaceUp)
			return {
				text: connection.protocol === L2TP_IPSEC_PROTO ? _('Connected') : _('Interface ready'),
				className: 'fn-status-ok',
				state: state,
				interfaceUp: interfaceUp
			};
		if (this.ipsecStatus && (this.ipsecStatus.available === false || this.ipsecStatus.ok === false))
			return { text: _('IPsec service unavailable'), className: 'fn-status-warn', state: state, interfaceUp: interfaceUp };
		return { text: _('Not connected'), className: 'fn-status-off', state: state, interfaceUp: interfaceUp };
	},

	refreshIpsecStatus() {
		return Promise.all([ getIpsecStatus(), getInterfaceDump() ]).then(data => {
			this.ipsecStatus = data[0] || { ok: false, available: false, error: _('The IPsec status helper is unavailable.') };
			this.interfaceDump = data[1] || {};
			this.fillConnections();
			return this.ipsecStatus;
		});
	},

	startIpsecPolling() {
		this.stopIpsecPolling();
		this.ipsecTimer = window.setInterval(() => this.refreshIpsecStatus().catch(() => null), 15000);
	},

	stopIpsecPolling() {
		if (this.ipsecTimer) {
			window.clearInterval(this.ipsecTimer);
			this.ipsecTimer = null;
		}
	},

	fillConnections() {
		if (!this.listNode)
			return;
		dom_empty(this.listNode);
		const connections = this.getConnections();
		if (!connections.length) {
			this.listNode.appendChild(E('div', { class: 'fn-oc-empty' }, [
				E('strong', {}, _('No other connections configured')),
				E('span', {}, _('Add a connection or import a provider configuration file.')),
				E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', click: () => this.openForm(null) }, _('Add connection'))
			]));
			return;
		}
		connections.forEach(connection => this.listNode.appendChild(this.renderConnection(connection)));
	},

	renderOpenvpnConnection(connection) {
		const status = connection.status;
		const up = !!(status && status.up);
		const disabled = !connection.enabled;
		const statusClass = disabled ? 'fn-status-off' : (up ? 'fn-status-ok' : 'fn-status-off');
		const statusText = disabled ? _('Disabled') : (up ? _('Connected') : _('Not connected'));
		const statusPill = E('span', { class: 'fn-status-pill ' + statusClass }, statusText);
		const toggle = E('input', { type: 'checkbox', class: 'fn-switch-input' });
		toggle.checked = connection.enabled;
		const toggleLabel = E('label', { class: 'fn-switch fn-oc-switch' }, [ toggle, E('span', { class: 'fn-switch-slider' }) ]);
		toggle.addEventListener('change', () => this.toggleConnection(connection, toggle));

		const device = status && (status.l3_device || status.device || status.device_name);
		const profileName = connection.profilePath ? connection.profilePath.split('/').pop() : _('Profile not set');
		const info = [
			[ _('Protocol'), 'OpenVPN' ],
			[ _('Interface'), connection.section ],
			[ _('Tunnel device'), device || '–' ],
			[ _('Profile'), profileName ],
			[ _('Profile storage'), connection.managedProfile ? _('Freenetic managed') : _('External file') ]
		];
		const grid = E('div', { class: 'fn-info-grid fn-oc-info-grid' }, info.map(item => E('div', { class: 'fn-info-item' }, [
			E('div', { class: 'fn-info-label' }, item[0]),
			E('div', { class: 'fn-info-value fn-oc-break-value' }, item[1])
		])));

		const edit = E('button', { type: 'button', class: 'fn-settings-btn', click: () => this.openForm(connection) }, _('Edit'));
		const exportButton = E('button', { type: 'button', class: 'fn-settings-btn', click: () => this.exportOpenvpnConnection(connection) }, _('Export'));
		const remove = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-danger', click: () => this.deleteConnection(connection) }, _('Delete'));

		return E('article', { class: 'fn-card fn-oc-card fn-oc-openvpn-card' }, [
			E('div', { class: 'fn-card-head fn-oc-card-head' }, [
				svgIcon('M4 7h16M7 4v3M17 4v3M6 11h4M6 15h7M4 20h16', 20),
				E('div', { class: 'fn-oc-card-title' }, [ E('h3', {}, connection.name), E('span', { class: 'fn-oc-protocol' }, _('OpenVPN profile')) ]),
				toggleLabel,
				statusPill
			]),
			E('div', { class: 'fn-card-body' }, [
				grid,
				E('p', { class: 'fn-oc-profile-note' }, _('The profile is passed to the native OpenVPN netifd protocol. Provider directives and inline certificates stay unchanged.')),
				E('div', { class: 'fn-pf-actions fn-oc-actions' }, [ edit, exportButton, remove ])
			])
		]);
	},

	renderIpsecConnection(connection) {
		const status = connection.status;
		const presentation = this.ipsecPresentation(connection);
		const statusPill = E('span', { class: 'fn-status-pill ' + presentation.className }, presentation.text);
		const toggle = E('input', { type: 'checkbox', class: 'fn-switch-input' });
		toggle.checked = connection.enabled;
		const toggleLabel = E('label', { class: 'fn-switch fn-oc-switch' }, [ toggle, E('span', { class: 'fn-switch-slider' }) ]);
		toggle.addEventListener('change', () => this.toggleConnection(connection, toggle));

		const info = connection.protocol === L2TP_IPSEC_PROTO ? [
			[ _('Protocol'), _('L2TP/IPsec') ],
			[ _('Interface'), connection.section ],
			[ _('Server'), connection.server || '–' ],
			[ _('PPP username'), connection.username || '–' ],
			[ _('Tunnel device'), status && (status.l3_device || status.device) || 'l2tp-' + connection.section ],
			[ _('IP version'), connection.ipv6 ? _('IPv4 + IPv6') : _('IPv4') ]
		] : [
			[ _('Protocol'), _('IKEv2/IPsec') ],
			[ _('Interface'), connection.section ],
			[ _('Gateway'), connection.gateway || '–' ],
			[ _('Authentication'), connection.authMethod === 'eap-mschapv2' ? _('EAP-MSCHAPv2') : _('Pre-shared key') ],
			[ _('XFRM interface ID'), connection.ifid || '–' ],
			[ _('Traffic selectors'), (connection.localSelectors || []).join(', ') + ' → ' + (connection.remoteSelectors || []).join(', ') ]
		];
		const grid = E('div', { class: 'fn-info-grid fn-oc-info-grid' }, info.map(item => E('div', { class: 'fn-info-item' }, [
			E('div', { class: 'fn-info-label' }, item[0]),
			E('div', { class: 'fn-info-value fn-oc-break-value' }, item[1])
		])));
		const hint = connection.protocol === IKEV2_PROTO
			? _('The XFRM interface is created by netifd; strongSwan establishes the IKEv2 security association on top of it.')
			: _('The PPP tunnel is carried by xl2tpd after strongSwan negotiates the IPsec transport connection.');
		const diagnostics = E('button', { type: 'button', class: 'fn-settings-btn', click: () => this.openIpsecDiagnostics(connection) }, _('Diagnostics'));
		const reconnect = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', disabled: !connection.enabled, click: () => this.reconnectIpsec(connection, reconnect) }, _('Reconnect'));
		const edit = E('button', { type: 'button', class: 'fn-settings-btn', click: () => this.openForm(connection) }, _('Edit'));
		const remove = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-danger', click: () => this.deleteConnection(connection) }, _('Delete'));

		return E('article', { class: 'fn-card fn-oc-card fn-oc-ipsec-card' }, [
			E('div', { class: 'fn-card-head fn-oc-card-head' }, [
				svgIcon('M12 2l8 4v5c0 5-3.5 9.5-8 11-4.5-1.5-8-6-8-11V6l8-4zM9 12l2 2 4-4', 20),
				E('div', { class: 'fn-oc-card-title' }, [ E('h3', {}, connection.name), E('span', { class: 'fn-oc-protocol' }, ipsecProtocolLabel(connection.protocol)) ]),
				toggleLabel,
				statusPill
			]),
			E('div', { class: 'fn-card-body' }, [
				grid,
				E('p', { class: 'fn-oc-profile-note' }, hint),
				E('div', { class: 'fn-pf-actions fn-oc-actions' }, [ reconnect, diagnostics, edit, remove ])
			])
		]);
	},

	reconnectIpsec(connection, button) {
		if (!connection.enabled) {
			notify(_('Enable the connection before reconnecting it.'), 'warning');
			return Promise.resolve(false);
		}
		button.disabled = true;
		dom_content(button, _('Reconnecting…'));
		return restartIpsec()
			.then(() => this.refreshIpsecStatus())
			.then(() => {
				notify(_('Reconnect requested. The current negotiation status is shown on the connection card.'), 'info');
				return true;
			})
			.catch(error => {
				notify(_('Failed to reconnect IPsec: %s').format(error.message || error), 'danger');
				return false;
			})
			.finally(() => {
				button.disabled = !connection.enabled;
				dom_content(button, _('Reconnect'));
			});
	},

	openIpsecDiagnostics(connection) {
		if (this.modalOpen)
			ui.hideModal();

		const statusNode = E('div', { class: 'fn-oc-diagnostics-status' });
		const errorNode = E('div', { class: 'fn-oc-diagnostics-error' });
		const sasNode = E('pre', { class: 'fn-oc-diagnostics-output' });
		const connsNode = E('pre', { class: 'fn-oc-diagnostics-output' });
		const logsNode = E('pre', { class: 'fn-oc-diagnostics-output' });
		const snapshot = () => this.ipsecStatus || {};
		const update = () => {
			const current = snapshot();
			const latestConnection = this.getConnections().find(item => item.section === connection.section) || connection;
			const presentation = this.ipsecPresentation(latestConnection);
			dom_empty(statusNode);
			statusNode.appendChild(E('span', { class: 'fn-status-pill ' + presentation.className }, presentation.text));
			if (presentation.state)
				statusNode.appendChild(E('span', { class: 'fn-oc-diagnostics-state' }, _('strongSwan state: %s').format(presentation.state)));
			else if (presentation.interfaceUp)
				statusNode.appendChild(E('span', { class: 'fn-oc-diagnostics-state' }, _('The network interface is present; no IKE security association was reported.')));
			else
				statusNode.appendChild(E('span', { class: 'fn-oc-diagnostics-state' }, _('No active IKE security association was reported.')));
			dom_content(errorNode, current.error || '');
			dom_content(sasNode, current.sas || _('No security associations reported.'));
			dom_content(connsNode, current.conns || _('No loaded IPsec connections reported.'));
			dom_content(logsNode, current.logs || _('No matching IPsec log entries reported.'));
		};

		const close = E('button', { type: 'button', class: 'fn-settings-btn', click: () => { ui.hideModal(); this.modalOpen = false; } }, _('Close'));
		const refresh = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', click: () => {
			refresh.disabled = true;
			dom_content(refresh, _('Refreshing…'));
			return this.refreshIpsecStatus().then(update).catch(error => {
				notify(_('Failed to refresh IPsec diagnostics: %s').format(error.message || error), 'danger');
			}).finally(() => {
				refresh.disabled = false;
				dom_content(refresh, _('Refresh'));
			});
		} }, _('Refresh'));

		update();
		ui.showModal(_('IPsec diagnostics: %s').format(connection.name), [
			E('p', { class: 'fn-oc-modal-description' }, _('Read-only strongSwan status, loaded connection definitions and recent relevant log entries. Private keys and passwords are not requested or displayed.')),
			statusNode,
			errorNode,
			E('h4', { class: 'fn-oc-diagnostics-heading' }, _('Security associations')),
			sasNode,
			E('h4', { class: 'fn-oc-diagnostics-heading' }, _('Loaded connections')),
			connsNode,
			E('h4', { class: 'fn-oc-diagnostics-heading' }, _('Recent IPsec logs')),
			logsNode,
			E('div', { class: 'fn-pf-actions fn-oc-modal-actions' }, [ close, refresh ])
		]);
		this.modalOpen = true;
		const modal = document.querySelector('#modal_overlay .modal');
		if (modal)
			modal.classList.add('fn-oc-diagnostics-modal');
	},

	renderConnection(connection) {
		if (connection.protocol === OVPN_PROTO)
			return this.renderOpenvpnConnection(connection);
		if (connection.protocol === L2TP_IPSEC_PROTO || connection.protocol === IKEV2_PROTO)
			return this.renderIpsecConnection(connection);
		const status = connection.status;
		const up = !!(status && status.up);
		const disabled = !connection.enabled;
		const statusClass = disabled ? 'fn-status-off' : (up ? 'fn-status-ok' : 'fn-status-off');
		const statusText = disabled ? _('Disabled') : (up ? _('Connected') : _('Not connected'));
		const statusPill = E('span', { class: 'fn-status-pill ' + statusClass }, statusText);
		const protocolLabel = connection.protocol === AWG_PROTO ? 'AmneziaWG' : 'WireGuard';
		const toggle = E('input', { type: 'checkbox', class: 'fn-switch-input' });
		toggle.checked = connection.enabled;
		const toggleLabel = E('label', { class: 'fn-switch fn-oc-switch' }, [ toggle, E('span', { class: 'fn-switch-slider' }) ]);
		toggle.addEventListener('change', () => this.toggleConnection(connection, toggle));

		const info = [
			[ _('Protocol'), protocolLabel ],
			[ _('Interface'), connection.section ],
			[ _('Addresses'), connection.addresses.length ? connection.addresses.join(', ') : '–' ],
			[ _('Peers'), String(connection.peers.length) ],
			[ _('Listen port'), connection.listenPort || _('Random') ]
		];
		const grid = E('div', { class: 'fn-info-grid fn-oc-info-grid' }, info.map(item => E('div', { class: 'fn-info-item' }, [
			E('div', { class: 'fn-info-label' }, item[0]),
			E('div', { class: 'fn-info-value' }, item[1])
		])));

		const peerNode = E('div', { class: 'fn-oc-peer-list' });
		if (!connection.peers.length)
			peerNode.appendChild(E('div', { class: 'fn-info-empty' }, _('No peers configured.')));
		connection.peers.forEach(peer => {
			const peerStatus = connection.wireStatus && connection.wireStatus.peers && connection.wireStatus.peers[peer.publicKey];
			const handshake = peerStatus ? formatAge(peerStatus.last_handshake) : _('No handshake');
			peerNode.appendChild(E('div', { class: 'fn-oc-peer-row' }, [
				E('div', { class: 'fn-oc-peer-main' }, [
					E('strong', {}, peer.description || _('Untitled peer')),
					E('code', {}, shortKey(peer.publicKey)),
					E('span', { class: 'fn-oc-peer-endpoint' }, peer.endpointHost ? endpointText(peer.endpointHost, peer.endpointPort) : _('Endpoint not set'))
				]),
				E('div', { class: 'fn-oc-peer-ips' }, peer.allowedIps.length ? peer.allowedIps.join(', ') : _('No allowed IPs')),
				E('div', { class: 'fn-oc-peer-stats' }, [
					E('span', {}, _('Handshake: %s').format(handshake)),
					peerStatus ? E('span', {}, _('↓ %s · ↑ %s').format(formatBytes(peerStatus.rx_bytes), formatBytes(peerStatus.tx_bytes))) : ''
				])
			]));
		});

		const edit = E('button', { type: 'button', class: 'fn-settings-btn', click: () => this.openForm(connection) }, _('Edit'));
		const exportButton = E('button', { type: 'button', class: 'fn-settings-btn', click: () => this.exportConnection(connection) }, _('Export'));
		const remove = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-danger', click: () => this.deleteConnection(connection) }, _('Delete'));

		return E('article', { class: 'fn-card fn-oc-card' }, [
			E('div', { class: 'fn-card-head fn-oc-card-head' }, [
				svgIcon('M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83', 20),
				E('div', { class: 'fn-oc-card-title' }, [ E('h3', {}, connection.name), E('span', { class: 'fn-oc-protocol' }, protocolLabel) ]),
				toggleLabel,
				statusPill
			]),
			E('div', { class: 'fn-card-body' }, [
				grid,
				connection.protocol === AWG_PROTO ? E('div', { class: 'fn-oc-awg-badge' }, _('AmneziaWG obfuscation parameters enabled')) : '',
				E('h4', { class: 'fn-oc-subtitle' }, _('Peers')),
				peerNode,
				E('div', { class: 'fn-pf-actions fn-oc-actions' }, [ edit, exportButton, remove ])
			])
		]);
	},

	openAddConnection() {
		if (this.modalOpen)
			ui.hideModal();
		const protocol = E('select', { class: 'fn-input' }, [
			E('option', { value: WG_PROTO }, _('WireGuard')),
			E('option', { value: AWG_PROTO }, _('AmneziaWG')),
			E('option', { value: OVPN_PROTO }, _('OpenVPN')),
			E('option', { value: L2TP_IPSEC_PROTO }, _('L2TP/IPsec')),
			E('option', { value: IKEV2_PROTO }, _('IKEv2/IPsec'))
		]);
		const cancel = E('button', { type: 'button', class: 'fn-settings-btn', click: () => { ui.hideModal(); this.modalOpen = false; } }, _('Cancel'));
		const next = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', click: () => {
			const selected = protocol.value;
			ui.hideModal();
			this.modalOpen = false;
			if (selected === OVPN_PROTO)
				this.openOpenvpnForm(null);
			else if (selected === L2TP_IPSEC_PROTO)
				this.openL2tpForm(null);
			else if (selected === IKEV2_PROTO)
				this.openIkev2Form(null);
			else
				this.openForm({
					section: null,
					name: _('New VPN connection'),
					protocol: selected,
					enabled: true,
					privateKey: '',
					publicKey: '',
					addresses: [],
					dns: [],
					listenPort: '',
					mtu: '1420',
					fwmark: '',
					nohostroute: false,
					awg: {},
					peers: []
				});
		} }, _('Continue'));

		ui.showModal(_('Add connection'), [
			E('p', { class: 'fn-oc-modal-description' }, _('Choose the protocol for the new native OpenWrt connection. You can import a provider profile instead.')),
			E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Protocol')), protocol ]),
			E('div', { class: 'fn-pf-actions fn-oc-modal-actions' }, [ cancel, next ])
		]);
		this.modalOpen = true;
		const modal = document.querySelector('#modal_overlay .modal');
		if (modal)
			modal.classList.add('fn-oc-chooser-modal');
	},

	openForm(connection) {
		if (!connection)
			return this.openAddConnection();
		if (connection.protocol === OVPN_PROTO)
			return this.openOpenvpnForm(connection);
		if (connection.protocol === L2TP_IPSEC_PROTO)
			return this.openL2tpForm(connection);
		if (connection.protocol === IKEV2_PROTO)
			return this.openIkev2Form(connection);
		if (this.modalOpen)
			ui.hideModal();
		connection = connection || {
			section: null,
			name: _('New VPN connection'),
			protocol: WG_PROTO,
			enabled: true,
			privateKey: '',
			publicKey: '',
			addresses: [],
			dns: [],
			listenPort: '',
			mtu: '1420',
			fwmark: '',
			nohostroute: false,
			awg: {},
			peers: []
		};

		this.formConnection = connection;
		this.formPeers = (connection.peers || []).map(peer => Object.assign({}, peer));
		this.formOriginalPeerNames = this.formPeers.map(peer => peer.section).filter(Boolean);
		this.formProtocolChanged = false;

		const nameInput = E('input', { type: 'text', class: 'fn-input', value: connection.name || '', placeholder: _('VPN connection') });
		const protocolInput = E('select', { class: 'fn-input' }, [
			E('option', { value: WG_PROTO }, _('WireGuard')),
			E('option', { value: AWG_PROTO }, _('AmneziaWG'))
		]);
		protocolInput.value = connection.protocol === AWG_PROTO ? AWG_PROTO : WG_PROTO;
		const enabledInput = E('input', { type: 'checkbox' });
		enabledInput.checked = connection.enabled !== false;
		const privateInput = E('input', { type: 'password', class: 'fn-input', value: connection.privateKey || '', placeholder: _('Base64 private key') });
		const publicInput = E('input', { type: 'text', class: 'fn-input', value: connection.publicKey || '', readonly: true, placeholder: _('Generate from private key') });
		const addressInput = E('input', { type: 'text', class: 'fn-input', value: listText(connection.addresses), placeholder: '10.0.0.2/32, fd00::2/128' });
		const dnsInput = E('input', { type: 'text', class: 'fn-input', value: listText(connection.dns), placeholder: '1.1.1.1, 9.9.9.9' });
		const listenInput = E('input', { type: 'number', class: 'fn-input', value: connection.listenPort || '', min: '1', max: '65535', placeholder: _('Random') });
		const mtuInput = E('input', { type: 'number', class: 'fn-input', value: connection.mtu || '', min: '576', max: '8940', placeholder: '1420' });
		const fwmarkInput = E('input', { type: 'text', class: 'fn-input', value: connection.fwmark || '', placeholder: '0x0' });
		const nohostInput = E('input', { type: 'checkbox' });
		nohostInput.checked = !!connection.nohostroute;

		const keyStatus = E('span', { class: 'fn-oc-key-status' });
		const updateKeyStatus = value => dom_content(keyStatus, validKey(value, true) ? (value ? _('Key present') : _('Key not set')) : _('Invalid key'));
		privateInput.addEventListener('input', () => updateKeyStatus(privateInput.value.trim()));
		updateKeyStatus(privateInput.value.trim());

		const generateKey = E('button', { type: 'button', class: 'fn-settings-btn fn-oc-small-btn', click: () => {
			generateKey.disabled = true;
			dom_content(generateKey, _('Generating…'));
			return generateKeyPair().then(result => {
				privateInput.value = result.private;
				publicInput.value = result.public;
				updateKeyStatus(privateInput.value);
			}).catch(() => notify(_('Key generation needs rpcd-mod-wireguard.'), 'warning'))
				.finally(() => { generateKey.disabled = false; dom_content(generateKey, _('Generate key pair')); });
		} }, _('Generate key pair'));
		const deriveKey = E('button', { type: 'button', class: 'fn-settings-btn fn-oc-small-btn', click: () => {
			if (!validKey(privateInput.value.trim(), false)) {
				notify(_('Enter a valid private key first.'), 'warning');
				return;
			}
			deriveKey.disabled = true;
			return derivePublicKey(privateInput.value.trim()).then(publicKey => {
				publicInput.value = publicKey;
			}).catch(() => notify(_('Public key calculation needs the WireGuard or AmneziaWG tools package.'), 'warning'))
				.finally(() => { deriveKey.disabled = false; });
		} }, _('Update public key'));

		const awgBody = E('div', { class: 'fn-oc-awg-grid' });
		const awgInputs = {};
		AWG_OPTIONS.forEach(item => {
			const input = E('input', { type: 'number', class: 'fn-input', value: connection.awg && connection.awg[item[0]] || '', min: String(item[2]), max: String(item[3]), placeholder: _('Optional') });
			awgInputs[item[0]] = input;
			awgBody.appendChild(E('div', { class: 'fn-settings-field' }, [ E('label', {}, item[1]), input ]));
		});
		const awgHint = E('p', { class: 'fn-oc-field-hint' }, _('These values must match the remote AmneziaWG peer. They are ignored by standard WireGuard only when the protocol is explicitly changed to WireGuard.'));
		const awgSection = E('details', { class: 'fn-oc-advanced', open: protocolInput.value === AWG_PROTO }, [
			E('summary', {}, _('AmneziaWG parameters')),
			awgHint,
			awgBody
		]);
		const protocolHint = E('p', { class: 'fn-oc-field-hint' });
		const updateProtocol = () => {
			const isAwg = protocolInput.value === AWG_PROTO;
			awgSection.hidden = !isAwg;
			if (isAwg)
				dom_content(protocolHint, this.awgAvailable() ? _('AmneziaWG support is installed.') : _('AmneziaWG packages are not installed yet. Saving will ask whether to install the optional feed or remove AWG parameters.'));
			else
				dom_content(protocolHint, _('Standard WireGuard does not use AmneziaWG obfuscation parameters.'));
		};
		protocolInput.addEventListener('change', () => { this.formProtocolChanged = true; updateProtocol(); });
		updateProtocol();

		this.formPeerNode = E('div', { class: 'fn-oc-peer-edit-list' });
		const addPeer = E('button', { type: 'button', class: 'fn-settings-btn fn-oc-small-btn', click: () => {
			this.formPeers.push({ section: null, description: '', disabled: false, publicKey: '', privateKey: '', presharedKey: '', allowedIps: [], endpointHost: '', endpointPort: '', keepalive: '', routeAllowed: false });
			this.renderFormPeers();
		} }, _('Add peer'));
		this.formAddPeer = addPeer;
		this.renderFormPeers();

		const save = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', click: () => {
			const peers = this.formPeers.map(peer => this.readFormPeer(peer));
			return this.saveConnection({
				section: connection.section,
				name: nameInput.value.trim(),
				protocol: protocolInput.value,
				enabled: enabledInput.checked,
				privateKey: privateInput.value.trim(),
				publicKey: publicInput.value.trim(),
				addresses: parseList(addressInput.value),
				dns: parseList(dnsInput.value),
				listenPort: listenInput.value.trim(),
				mtu: mtuInput.value.trim(),
				fwmark: fwmarkInput.value.trim(),
				nohostroute: nohostInput.checked,
				awg: Object.keys(awgInputs).reduce((out, key) => { out[key] = awgInputs[key].value.trim(); return out; }, {}),
				peers: peers
			}, save);
		} }, connection.section ? _('Save') : _('Add connection'));
		const cancel = E('button', { type: 'button', class: 'fn-settings-btn', click: () => { ui.hideModal(); this.modalOpen = false; } }, _('Cancel'));

		const enabledField = E('label', { class: 'fn-oc-enable' }, [ enabledInput, E('span', {}, _('Connection enabled')) ]);
		const keyActions = E('div', { class: 'fn-oc-key-actions' }, [ generateKey, deriveKey ]);
		const body = [
			E('p', { class: 'fn-oc-modal-description' }, _('Use the native OpenWrt interface and peer settings. Private keys stay on the router and are included only when you explicitly export a configuration.')),
			E('div', { class: 'fn-oc-form-grid' }, [
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Connection name')), nameInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Protocol')), protocolInput, protocolHint ]),
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Private key')), privateInput, keyStatus, keyActions ]),
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Public key')), publicInput, E('span', { class: 'fn-oc-field-hint' }, _('Stored for display only; netifd derives the active key from the private key.')) ]),
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Interface addresses')), addressInput ]),
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('DNS servers')), dnsInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Listen port')), listenInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('MTU')), mtuInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Firewall mark')), fwmarkInput ]),
				E('label', { class: 'fn-oc-checkbox-field' }, [ nohostInput, E('span', {}, _('Do not create host routes')) ])
			]),
			enabledField,
			awgSection,
			E('div', { class: 'fn-oc-peer-head' }, [ E('h3', {}, _('Peers')), addPeer ]),
			this.formPeerNode,
			E('div', { class: 'fn-pf-actions fn-oc-modal-actions' }, [ cancel, save ])
		];

		ui.showModal(connection.section ? _('Edit connection') : _('Add connection'), body);
		this.modalOpen = true;
		const modal = document.querySelector('#modal_overlay .modal');
		if (modal)
			modal.classList.add('fn-oc-modal');
	},

	openOpenvpnForm(connection) {
		if (this.modalOpen)
			ui.hideModal();
		connection = connection || {
			section: null,
			name: _('New OpenVPN connection'),
			protocol: OVPN_PROTO,
			enabled: true,
			profilePath: '',
			profile: ''
		};

		const nameInput = E('input', { type: 'text', class: 'fn-input', value: connection.name || '', placeholder: _('VPN connection') });
		const enabledInput = E('input', { type: 'checkbox' });
		enabledInput.checked = connection.enabled !== false;
		const profileInput = E('textarea', { class: 'fn-input fn-oc-profile-text', rows: '18', placeholder: _('Paste the complete .ovpn profile, including inline certificates when possible…'), autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' });
		profileInput.value = connection.profile || '';
		const profileStatus = E('span', { class: 'fn-oc-field-hint' }, connection.profilePath ? _('Loading profile…') : _('Stored on the router with mode 0600.'));
		if (connection.profilePath) {
			fs.read(connection.profilePath).then(value => {
				if (!profileInput.value)
					profileInput.value = value || '';
				dom_content(profileStatus, connection.managedProfile ? _('Stored on the router with mode 0600.') : _('External profile file; saving creates a Freenetic-managed copy.'));
			}).catch(() => dom_content(profileStatus, _('The profile could not be read. Paste it again or choose a local file.')));
		}

		const fileInput = E('input', { type: 'file', class: 'fn-oc-file-input', accept: '.ovpn,.conf,text/plain' });
		const choose = E('button', { type: 'button', class: 'fn-settings-btn fn-oc-small-btn', click: () => fileInput.click() }, _('Choose .ovpn file'));
		fileInput.addEventListener('change', () => {
			const file = fileInput.files && fileInput.files[0];
			if (!file)
				return;
			const reader = new FileReader();
			reader.onload = event => {
				profileInput.value = event.target.result || '';
				dom_content(profileStatus, _('Local profile loaded. It will be copied to the router when saved.'));
			};
			reader.readAsText(file);
		});

		const save = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', click: () => this.saveOpenvpnConnection({
			section: connection.section,
			name: nameInput.value.trim(),
			enabled: enabledInput.checked,
			profilePath: connection.profilePath || '',
			managedProfile: !!connection.managedProfile,
			profile: profileInput.value
		}, save) }, connection.section ? _('Save') : _('Add connection'));
		const cancel = E('button', { type: 'button', class: 'fn-settings-btn', click: () => { ui.hideModal(); this.modalOpen = false; } }, _('Cancel'));
		const enabledField = E('label', { class: 'fn-oc-enable' }, [ enabledInput, E('span', {}, _('Connection enabled')) ]);

		ui.showModal(connection.section ? _('Edit OpenVPN connection') : _('Add OpenVPN connection'), [
			E('p', { class: 'fn-oc-modal-description' }, _('Use a complete OpenVPN client or server profile. The native OpenVPN netifd protocol keeps provider directives, inline certificates and routing options intact.')),
			E('div', { class: 'fn-oc-form-grid' }, [
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Connection name')), nameInput ]),
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('OpenVPN profile')), profileInput, profileStatus, E('div', { class: 'fn-oc-key-actions' }, [ choose, fileInput ]) ])
			]),
			enabledField,
			E('div', { class: 'fn-oc-compat-note fn-oc-profile-warning' }, [
				E('strong', {}, _('Profile files and secrets')),
				E('span', {}, _('Profiles are stored only on this router. Relative certificate or auth-file paths must already exist beside the profile; inline blocks are recommended for imports.'))
			]),
			E('div', { class: 'fn-pf-actions fn-oc-modal-actions' }, [ cancel, save ])
		]);
		this.modalOpen = true;
		const modal = document.querySelector('#modal_overlay .modal');
		if (modal)
			modal.classList.add('fn-oc-openvpn-modal');
	},

	openL2tpForm(connection) {
		if (this.modalOpen)
			ui.hideModal();
		connection = connection || {
			section: null,
			name: _('New L2TP/IPsec connection'),
			protocol: L2TP_IPSEC_PROTO,
			enabled: true,
			server: '',
			username: '',
			password: '',
			psk: '',
			localIdentifier: '',
			remoteIdentifier: '',
			keepalive: '10,5',
			mtu: '1460',
			ipv6: false,
			defaultRoute: false
		};

		const nameInput = E('input', { type: 'text', class: 'fn-input', value: connection.name || '', placeholder: _('VPN connection') });
		const serverInput = E('input', { type: 'text', class: 'fn-input', value: connection.server || '', placeholder: 'vpn.example.com[:port]' });
		const usernameInput = E('input', { type: 'text', class: 'fn-input', value: connection.username || '', autocomplete: 'username', placeholder: _('PPP username') });
		const passwordInput = E('input', { type: 'password', class: 'fn-input', value: connection.password || '', autocomplete: 'current-password', placeholder: _('PPP password') });
		const pskInput = E('input', { type: 'password', class: 'fn-input', value: connection.psk || '', placeholder: _('IPsec pre-shared key') });
		const localIdInput = E('input', { type: 'text', class: 'fn-input', value: connection.localIdentifier || '', placeholder: _('Optional local ID') });
		const remoteIdInput = E('input', { type: 'text', class: 'fn-input', value: connection.remoteIdentifier || '', placeholder: _('Optional server ID') });
		const keepaliveInput = E('input', { type: 'text', class: 'fn-input', value: connection.keepalive || '', placeholder: '10,5' });
		const mtuInput = E('input', { type: 'number', class: 'fn-input', value: connection.mtu || '', min: '576', max: '9000', placeholder: '1460' });
		const ipv6Input = E('input', { type: 'checkbox' });
		ipv6Input.checked = !!connection.ipv6;
		const routeInput = E('input', { type: 'checkbox' });
		routeInput.checked = !!connection.defaultRoute;
		const enabledInput = E('input', { type: 'checkbox' });
		enabledInput.checked = connection.enabled !== false;

		const save = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', click: () => this.saveL2tpConnection({
			section: connection.section,
			name: nameInput.value.trim(),
			server: serverInput.value.trim(),
			username: usernameInput.value.trim(),
			password: passwordInput.value,
			psk: pskInput.value,
			localIdentifier: localIdInput.value.trim(),
			remoteIdentifier: remoteIdInput.value.trim(),
			keepalive: keepaliveInput.value.trim(),
			mtu: mtuInput.value.trim(),
			ipv6: ipv6Input.checked,
			defaultRoute: routeInput.checked,
			enabled: enabledInput.checked,
			remoteSection: connection.remoteSection || '',
			childSection: connection.childSection || '',
			ikeProposalSection: connection.ikeProposalSection || '',
			espProposalSection: connection.espProposalSection || ''
		}, save) }, connection.section ? _('Save') : _('Add connection'));
		const cancel = E('button', { type: 'button', class: 'fn-settings-btn', click: () => { ui.hideModal(); this.modalOpen = false; } }, _('Cancel'));
		const enabledField = E('label', { class: 'fn-oc-enable' }, [ enabledInput, E('span', {}, _('Connection enabled')) ]);

		ui.showModal(connection.section ? _('Edit L2TP/IPsec connection') : _('Add L2TP/IPsec connection'), [
			E('p', { class: 'fn-oc-modal-description' }, _('L2TP uses xl2tpd for PPP and strongSwan for the IPsec transport protection. The router must have the matching kernel modules installed.')),
			E('div', { class: 'fn-oc-form-grid' }, [
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Connection name')), nameInput ]),
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('L2TP server')), serverInput, E('span', { class: 'fn-oc-field-hint' }, _('Use a hostname or IP address. A custom UDP port may be appended as host:port.')) ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('PPP username')), usernameInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('PPP password')), passwordInput ]),
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('IPsec pre-shared key')), pskInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Local identity')), localIdInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Server identity')), remoteIdInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('LCP keepalive')), keepaliveInput, E('span', { class: 'fn-oc-field-hint' }, _('Failure count and interval, for example 10,5.')) ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('MTU')), mtuInput ])
			]),
			E('div', { class: 'fn-oc-checkbox-row' }, [
				E('label', { class: 'fn-oc-checkbox-field' }, [ ipv6Input, E('span', {}, _('Enable IPv6 on the PPP tunnel')) ]),
				E('label', { class: 'fn-oc-checkbox-field' }, [ routeInput, E('span', {}, _('Install a default route through this tunnel')) ])
			]),
			enabledField,
			E('div', { class: 'fn-oc-compat-note fn-oc-profile-warning' }, [
				E('strong', {}, _('Native OpenWrt configuration')),
				E('span', {}, _('Credentials are written to network UCI. IPsec proposals use a conservative AES-256/SHA-1 baseline compatible with common L2TP providers.'))
			]),
			E('div', { class: 'fn-pf-actions fn-oc-modal-actions' }, [ cancel, save ])
		]);
		this.modalOpen = true;
		const modal = document.querySelector('#modal_overlay .modal');
		if (modal)
			modal.classList.add('fn-oc-modal');
	},

	openIkev2Form(connection) {
		if (this.modalOpen)
			ui.hideModal();
		connection = connection || {
			section: null,
			name: _('New IKEv2/IPsec connection'),
			protocol: IKEV2_PROTO,
			enabled: true,
			gateway: '',
			authMethod: 'psk',
			psk: '',
			username: '',
			password: '',
			caCert: '',
			localIdentifier: '',
			remoteIdentifier: '',
			localSelectors: [ '0.0.0.0/0' ],
			remoteSelectors: [ '0.0.0.0/0' ],
			ifid: '',
			mtu: '1280',
			mobike: true,
			encap: false,
			autoStart: true
		};

		const nameInput = E('input', { type: 'text', class: 'fn-input', value: connection.name || '', placeholder: _('VPN connection') });
		const gatewayInput = E('input', { type: 'text', class: 'fn-input', value: connection.gateway || '', placeholder: 'vpn.example.com' });
		const authInput = E('select', { class: 'fn-input' }, [
			E('option', { value: 'psk' }, _('Pre-shared key')),
			E('option', { value: 'eap-mschapv2' }, _('EAP-MSCHAPv2 (username/password)'))
		]);
		authInput.value = connection.authMethod === 'eap-mschapv2' ? 'eap-mschapv2' : 'psk';
		const pskInput = E('input', { type: 'password', class: 'fn-input', value: connection.psk || '', placeholder: _('IPsec pre-shared key') });
		const usernameInput = E('input', { type: 'text', class: 'fn-input', value: connection.username || '', autocomplete: 'username', placeholder: _('VPN username') });
		const passwordInput = E('input', { type: 'password', class: 'fn-input', value: connection.password || '', autocomplete: 'current-password', placeholder: _('VPN password') });
		const caInput = E('input', { type: 'text', class: 'fn-input', value: connection.caCert || '', placeholder: 'provider-ca.pem' });
		const localIdInput = E('input', { type: 'text', class: 'fn-input', value: connection.localIdentifier || '', placeholder: _('Optional local ID') });
		const remoteIdInput = E('input', { type: 'text', class: 'fn-input', value: connection.remoteIdentifier || '', placeholder: _('Optional server ID') });
		const localSelectorInput = E('input', { type: 'text', class: 'fn-input', value: listText(connection.localSelectors), placeholder: '0.0.0.0/0' });
		const remoteSelectorInput = E('input', { type: 'text', class: 'fn-input', value: listText(connection.remoteSelectors), placeholder: '0.0.0.0/0' });
		const ifidInput = E('input', { type: 'number', class: 'fn-input', value: connection.ifid || '', min: '1', max: '4294967295', placeholder: '1000' });
		const mtuInput = E('input', { type: 'number', class: 'fn-input', value: connection.mtu || '', min: '576', max: '9000', placeholder: '1280' });
		const mobikeInput = E('input', { type: 'checkbox' });
		mobikeInput.checked = connection.mobike !== false;
		const encapInput = E('input', { type: 'checkbox' });
		encapInput.checked = !!connection.encap;
		const startInput = E('input', { type: 'checkbox' });
		startInput.checked = connection.autoStart !== false;
		const enabledInput = E('input', { type: 'checkbox' });
		enabledInput.checked = connection.enabled !== false;
		const pskField = E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('IPsec pre-shared key')), pskInput ]);
		const eapFields = E('div', { class: 'fn-oc-form-grid fn-oc-wide-field' }, [
			E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('EAP username')), usernameInput ]),
			E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('EAP password')), passwordInput ]),
			E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('CA certificate filename')), caInput, E('span', { class: 'fn-oc-field-hint' }, _('Upload this PEM file to /etc/swanctl/x509ca on the router. Leave empty only when the provider does not require CA pinning.')) ])
		]);
		const authHint = E('p', { class: 'fn-oc-field-hint' });
		const updateAuth = () => {
			const eap = authInput.value === 'eap-mschapv2';
			pskField.hidden = eap;
			eapFields.hidden = !eap;
			dom_content(authHint, eap
				? _('EAP-MSCHAPv2 is common for commercial IKEv2 providers and needs a trusted CA certificate when the server identity is verified.')
				: _('PSK authentication stores the pre-shared key in the native strongSwan secrets section.'));
		};
		authInput.addEventListener('change', updateAuth);
		updateAuth();

		const save = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', click: () => this.saveIkev2Connection({
			section: connection.section,
			name: nameInput.value.trim(),
			gateway: gatewayInput.value.trim(),
			authMethod: authInput.value,
			psk: pskInput.value,
			username: usernameInput.value.trim(),
			password: passwordInput.value,
			caCert: caInput.value.trim(),
			localIdentifier: localIdInput.value.trim(),
			remoteIdentifier: remoteIdInput.value.trim(),
			localSelectors: parseList(localSelectorInput.value),
			remoteSelectors: parseList(remoteSelectorInput.value),
			ifid: ifidInput.value.trim(),
			mtu: mtuInput.value.trim(),
			mobike: mobikeInput.checked,
			encap: encapInput.checked,
			autoStart: startInput.checked,
			enabled: enabledInput.checked,
			remoteSection: connection.remoteSection || '',
			childSection: connection.childSection || '',
			secretSection: connection.secretSection || '',
			ikeProposalSection: connection.ikeProposalSection || '',
			espProposalSection: connection.espProposalSection || ''
		}, save) }, connection.section ? _('Save') : _('Add connection'));
		const cancel = E('button', { type: 'button', class: 'fn-settings-btn', click: () => { ui.hideModal(); this.modalOpen = false; } }, _('Cancel'));
		const enabledField = E('label', { class: 'fn-oc-enable' }, [ enabledInput, E('span', {}, _('Connection enabled')) ]);

		ui.showModal(connection.section ? _('Edit IKEv2/IPsec connection') : _('Add IKEv2/IPsec connection'), [
			E('p', { class: 'fn-oc-modal-description' }, _('Use a native route-based XFRM interface with strongSwan. The IKEv2 security association carries the selectors below; applications can route traffic to the XFRM interface through Access & Routing Policy.')),
			E('div', { class: 'fn-oc-form-grid' }, [
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Connection name')), nameInput ]),
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('VPN gateway')), gatewayInput ]),
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Authentication')), authInput, authHint ]),
				pskField,
				eapFields,
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Local identity')), localIdInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Server identity')), remoteIdInput ]),
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Local traffic selectors')), localSelectorInput, E('span', { class: 'fn-oc-field-hint' }, _('Comma-separated CIDR prefixes, for example 0.0.0.0/0.')) ]),
				E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Remote traffic selectors')), remoteSelectorInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('XFRM interface ID')), ifidInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('MTU')), mtuInput ])
			]),
			E('div', { class: 'fn-oc-checkbox-row' }, [
				E('label', { class: 'fn-oc-checkbox-field' }, [ startInput, E('span', {}, _('Start tunnel automatically')) ]),
				E('label', { class: 'fn-oc-checkbox-field' }, [ mobikeInput, E('span', {}, _('Enable MOBIKE')) ]),
				E('label', { class: 'fn-oc-checkbox-field' }, [ encapInput, E('span', {}, _('Force UDP encapsulation')) ])
			]),
			enabledField,
			E('div', { class: 'fn-oc-compat-note fn-oc-profile-warning' }, [
				E('strong', {}, _('Native strongSwan configuration')),
				E('span', {}, _('IKEv2 uses the router’s strongSwan UCI backend. The XFRM interface ID must match the child SA and is kept stable when you edit this connection.'))
			]),
			E('div', { class: 'fn-pf-actions fn-oc-modal-actions' }, [ cancel, save ])
		]);
		this.modalOpen = true;
		const modal = document.querySelector('#modal_overlay .modal');
		if (modal)
			modal.classList.add('fn-oc-modal');
	},

	renderFormPeers() {
		if (!this.formPeerNode)
			return;
		dom_empty(this.formPeerNode);
		if (!this.formPeers.length) {
			this.formPeerNode.appendChild(E('div', { class: 'fn-oc-empty fn-oc-empty-small' }, _('No peers. Add at least one peer to establish a tunnel.')));
			return;
		}
		this.formPeers.forEach((peer, index) => {
			const inputs = {};
			peer._inputs = inputs;
			const description = E('input', { type: 'text', class: 'fn-input', value: peer.description || '', placeholder: _('Peer %d').format(index + 1) });
			const publicField = E('input', { type: 'text', class: 'fn-input', value: peer.publicKey || '', placeholder: _('Required Base64 public key'), autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' });
			const privateKey = E('input', { type: 'password', class: 'fn-input', value: peer.privateKey || '', placeholder: _('Optional private key') });
			const psk = E('input', { type: 'password', class: 'fn-input', value: peer.presharedKey || '', placeholder: _('Optional preshared key') });
			const allowed = E('input', { type: 'text', class: 'fn-input', value: listText(peer.allowedIps), placeholder: '0.0.0.0/0, ::/0' });
			const endpointHost = E('input', { type: 'text', class: 'fn-input', value: peer.endpointHost || '', placeholder: 'vpn.example.com' });
			const endpointPort = E('input', { type: 'number', class: 'fn-input', value: peer.endpointPort || '', min: '1', max: '65535', placeholder: '51820' });
			const keepalive = E('input', { type: 'number', class: 'fn-input', value: peer.keepalive || '', min: '0', max: '65535', placeholder: '25' });
			const disabled = E('input', { type: 'checkbox' });
			disabled.checked = !!peer.disabled;
			const routeAllowed = E('input', { type: 'checkbox' });
			routeAllowed.checked = !!peer.routeAllowed;
			Object.assign(inputs, { description, publicKey: publicField, privateKey, presharedKey: psk, allowedIps: allowed, endpointHost, endpointPort, keepalive, disabled, routeAllowed });

			const summaryTitle = E('span', {}, peer.description || _('Peer %d').format(index + 1));
			description.addEventListener('input', () => dom_content(summaryTitle, description.value || _('Peer %d').format(index + 1)));
			const genPsk = E('button', { type: 'button', class: 'fn-settings-btn fn-oc-small-btn', click: () => {
				genPsk.disabled = true;
				return generatePresharedKey().then(value => { psk.value = value; })
					.catch(() => notify(_('Preshared key generation needs the WireGuard or AmneziaWG tools package.'), 'warning'))
					.finally(() => { genPsk.disabled = false; });
			} }, _('Generate PSK'));
			const remove = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-danger fn-oc-small-btn', click: () => {
				this.formPeers.splice(index, 1);
				this.renderFormPeers();
			} }, _('Remove peer'));

			const details = E('details', { class: 'fn-oc-peer-editor', open: !peer.publicKey }, [
				E('summary', {}, [ summaryTitle, E('span', { class: 'fn-oc-peer-summary-key' }, shortKey(peer.publicKey)) ]),
				E('div', { class: 'fn-oc-peer-grid' }, [
					E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Description')), description ]),
					E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Public key')), publicField ]),
					E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Private key (optional)')), privateKey ]),
					E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Preshared key (optional)')), psk, genPsk ]),
					E('div', { class: 'fn-settings-field fn-oc-wide-field' }, [ E('label', {}, _('Allowed IPs')), allowed ]),
					E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Endpoint host')), endpointHost ]),
					E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Endpoint port')), endpointPort ]),
					E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Persistent keepalive')), keepalive ]),
					E('label', { class: 'fn-oc-checkbox-field' }, [ routeAllowed, E('span', {}, _('Route allowed IPs')) ]),
					E('label', { class: 'fn-oc-checkbox-field' }, [ disabled, E('span', {}, _('Disable peer')) ]),
					E('div', { class: 'fn-pf-actions fn-oc-peer-actions' }, [ remove ])
				])
			]);
			this.formPeerNode.appendChild(details);
		});
	},

	readFormPeer(peer) {
		const input = peer._inputs || {};
		return {
			section: peer.section || null,
			description: input.description ? input.description.value.trim() : peer.description || '',
			disabled: !!(input.disabled && input.disabled.checked),
			publicKey: input.publicKey ? input.publicKey.value.trim() : peer.publicKey || '',
			privateKey: input.privateKey ? input.privateKey.value.trim() : peer.privateKey || '',
			presharedKey: input.presharedKey ? input.presharedKey.value.trim() : peer.presharedKey || '',
			allowedIps: input.allowedIps ? parseList(input.allowedIps.value) : listValue(peer.allowedIps),
			endpointHost: input.endpointHost ? input.endpointHost.value.trim() : peer.endpointHost || '',
			endpointPort: input.endpointPort ? input.endpointPort.value.trim() : peer.endpointPort || '',
			keepalive: input.keepalive ? input.keepalive.value.trim() : peer.keepalive || '',
			routeAllowed: !!(input.routeAllowed && input.routeAllowed.checked)
		};
	},

	validateConnection(fields) {
		if (!fields.name)
			return _('Enter a connection name.');
		if (!validKey(fields.privateKey, false))
			return _('Enter a valid Base64 private key or generate one.');
		if (!fields.addresses.length || !fields.addresses.every(validAddress))
			return _('Enter at least one valid interface address.');
		if (!validPort(fields.listenPort, true))
			return _('Listen port must be between 1 and 65535.');
		if (!validNumber(fields.mtu, 576, 8940))
			return _('MTU must be between 576 and 8940.');
		if (fields.fwmark && !/^0x[0-9a-f]{1,8}$/i.test(fields.fwmark))
			return _('Firewall mark must be hexadecimal, for example 0x1000.');
		if (fields.dns.some(item => !validAddress(item.split('/')[0])))
			return _('DNS servers must be valid IP addresses.');
		if (fields.protocol === AWG_PROTO) {
			for (const item of AWG_OPTIONS)
				if (!validNumber(fields.awg[item[0]], item[2], item[3]))
					return _('%s is outside its supported range.').format(item[1]);
		}
		for (const peer of fields.peers) {
			if (!validKey(peer.publicKey, false))
				return _('Every peer needs a valid Base64 public key.');
			if (peer.privateKey && !validKey(peer.privateKey, false))
				return _('A peer has an invalid private key.');
			if (peer.presharedKey && !validKey(peer.presharedKey, false))
				return _('A peer has an invalid preshared key.');
			if (peer.allowedIps.some(item => !validAddress(item)))
				return _('A peer has an invalid Allowed IPs value.');
			if (!validHost(peer.endpointHost) || !validPort(peer.endpointPort, true))
				return _('A peer has an invalid endpoint.');
			if (!validNumber(peer.keepalive, 0, 65535))
				return _('Persistent keepalive must be between 0 and 65535.');
		}
		return null;
	},

	setList(config, section, option, values) {
		if (values && values.length)
			uci.set(config, section, option, values);
		else
			uci.unset(config, section, option);
	},

	setOptional(config, section, option, value) {
		if (value != null && value !== '')
			uci.set(config, section, option, value);
		else
			uci.unset(config, section, option);
	},

	validateOpenvpnConnection(fields) {
		if (!fields.name)
			return _('Enter a connection name.');
		return validateOpenvpnProfile(fields.profile);
	},

	validateL2tpConnection(fields) {
		if (!fields.name)
			return _('Enter a connection name.');
		if (!validServer(fields.server))
			return _('Enter a valid L2TP server hostname or IP address.');
		if (!fields.username || !validSecret(fields.username, false) || !validSecret(fields.password, false))
			return _('Enter the PPP username and password.');
		if (!validSecret(fields.psk, false))
			return _('Enter the IPsec pre-shared key.');
		if (!validNumber(fields.mtu, 576, 9000))
			return _('MTU must be between 576 and 9000.');
		if (fields.keepalive && !/^\d+\s*,\s*\d+$/.test(fields.keepalive))
			return _('LCP keepalive must use failure count,interval format, for example 10,5.');
		if (!validSecret(fields.localIdentifier, true) || !validSecret(fields.remoteIdentifier, true))
			return _('The IPsec identities contain invalid characters.');
		return null;
	},

	validateIkev2Connection(fields) {
		if (!fields.name)
			return _('Enter a connection name.');
		if (!validServer(fields.gateway))
			return _('Enter a valid IKEv2 gateway hostname or IP address.');
		if (fields.authMethod === 'eap-mschapv2') {
			if (!fields.username || !validSecret(fields.username, false) || !validSecret(fields.password, false))
				return _('Enter the EAP username and password.');
			if (fields.caCert && !/^[A-Za-z0-9._-]+$/.test(fields.caCert))
				return _('CA certificate must be a filename stored in /etc/swanctl/x509ca.');
		}
		else if (!validSecret(fields.psk, false))
			return _('Enter the IPsec pre-shared key.');
		if (!fields.localSelectors.length || !fields.localSelectors.every(validSelector) ||
			!fields.remoteSelectors.length || !fields.remoteSelectors.every(validSelector))
			return _('Enter valid CIDR traffic selectors for both sides.');
		if (!validNumber(fields.ifid, 1, 4294967295))
			return _('XFRM interface ID must be between 1 and 4294967295.');
		if (!validNumber(fields.mtu, 576, 9000))
			return _('MTU must be between 576 and 9000.');
		if (!validSecret(fields.localIdentifier, true) || !validSecret(fields.remoteIdentifier, true))
			return _('The IKE identities contain invalid characters.');
		return null;
	},

	ensureIpsecSection(type, name) {
		if (!name)
			return uci.add(IPSEC_CONFIG, type);
		if (!uci.get(IPSEC_CONFIG, name, '.type'))
			uci.add(IPSEC_CONFIG, type, name);
		return name;
	},

	removeIpsecSections(connection) {
		[ connection.remoteSection, connection.childSection, connection.secretSection,
			connection.ikeProposalSection, connection.espProposalSection ].forEach(name => {
			if (name && uci.get(IPSEC_CONFIG, name, '.type'))
				uci.remove(IPSEC_CONFIG, name);
		});
	},

	restartIpsecAfterApply() {
		return restartIpsec().catch(error => {
			notify(_('Network settings were saved, but strongSwan could not be restarted: %s').format(error.message || error), 'warning');
			return null;
		});
	},

	saveL2tpConnection(fields, button) {
		const error = this.validateL2tpConnection(fields);
		if (error) {
			notify(error, 'warning');
			return Promise.resolve(false);
		}
		if (!L2TP_IPSEC_PACKAGES.every(name => this.packages && this.packages[name])) {
			notify(_('Install the L2TP/IPsec packages from Applications before saving a tunnel.'), 'warning');
			return Promise.resolve(false);
		}

		button.disabled = true;
		dom_content(button, _('Saving…'));
		let section;
		let remoteName;
		let childName;
		let ikeName;
		let espName;
		return Promise.all([ uci.load('network'), uci.load(IPSEC_CONFIG).catch(() => null) ]).then(() => {
			section = fields.section || uci.add('network', 'interface');
			remoteName = fields.remoteSection || managedIpsecSection('fnr_', section + ':l2tp');
			childName = fields.childSection || managedIpsecSection('fnc_', section + ':l2tp');
			ikeName = fields.ikeProposalSection || managedIpsecSection('fnp_', section + ':l2tp-ike');
			espName = fields.espProposalSection || managedIpsecSection('fne_', section + ':l2tp-esp');
			this.ensureIpsecSection('ipsec', IPSEC_GLOBALS);

			uci.set('network', section, 'proto', L2TP_PROTO);
			if (fields.enabled) uci.unset('network', section, 'disabled');
			else uci.set('network', section, 'disabled', '1');
			uci.set('network', section, 'freenetic_protocol', L2TP_IPSEC_PROTO);
			uci.set('network', section, 'freenetic_name', fields.name);
			uci.set('network', section, 'freenetic_ipsec_remote', remoteName);
			uci.set('network', section, 'freenetic_ipsec_child', childName);
			this.setOptional('network', section, 'server', fields.server);
			this.setOptional('network', section, 'username', fields.username);
			this.setOptional('network', section, 'password', fields.password);
			this.setOptional('network', section, 'keepalive', fields.keepalive);
			this.setOptional('network', section, 'mtu', fields.mtu);
			if (fields.ipv6) uci.set('network', section, 'ipv6', '1');
			else uci.unset('network', section, 'ipv6');
			this.setOptional('network', section, 'pppd_options', fields.defaultRoute ? 'defaultroute' : '');

			uci.set(IPSEC_CONFIG, remoteName, 'enabled', fields.enabled ? '1' : '0');
			uci.set(IPSEC_CONFIG, remoteName, 'authentication_method', 'psk');
			uci.set(IPSEC_CONFIG, remoteName, 'pre_shared_key', fields.psk);
			uci.set(IPSEC_CONFIG, remoteName, 'keyexchange', 'ikev1');
			this.setOptional(IPSEC_CONFIG, remoteName, 'local_identifier', fields.localIdentifier);
			this.setOptional(IPSEC_CONFIG, remoteName, 'remote_identifier', fields.remoteIdentifier);
			uci.set(IPSEC_CONFIG, remoteName, 'remote_addrs', parseEndpoint(fields.server).host);
			uci.set(IPSEC_CONFIG, remoteName, 'encap', '1');
			uci.set(IPSEC_CONFIG, remoteName, 'mobike', '0');
			this.setList(IPSEC_CONFIG, remoteName, 'crypto_proposal', [ ikeName ]);
			this.setList(IPSEC_CONFIG, remoteName, 'transport', [ childName ]);

			this.setList(IPSEC_CONFIG, childName, 'local_subnet', [ 'dynamic[udp/l2tp]' ]);
			this.setList(IPSEC_CONFIG, childName, 'remote_subnet', [ 'dynamic[udp/l2tp]' ]);
			this.setList(IPSEC_CONFIG, childName, 'crypto_proposal', [ espName ]);
			uci.set(IPSEC_CONFIG, childName, 'startaction', 'trap');
			uci.set(IPSEC_CONFIG, childName, 'dpdaction', 'restart');
			uci.set(IPSEC_CONFIG, childName, 'closeaction', 'start');
			uci.unset(IPSEC_CONFIG, childName, 'if_id');
			uci.unset(IPSEC_CONFIG, childName, 'interface');

			uci.set(IPSEC_CONFIG, ikeName, 'is_esp', '0');
			uci.set(IPSEC_CONFIG, ikeName, 'encryption_algorithm', 'aes256');
			uci.set(IPSEC_CONFIG, ikeName, 'hash_algorithm', 'sha1');
			uci.set(IPSEC_CONFIG, ikeName, 'dh_group', 'modp2048');
			uci.set(IPSEC_CONFIG, ikeName, 'prf_algorithm', 'prfsha1');
			uci.set(IPSEC_CONFIG, espName, 'is_esp', '1');
			uci.set(IPSEC_CONFIG, espName, 'encryption_algorithm', 'aes256');
			uci.set(IPSEC_CONFIG, espName, 'hash_algorithm', 'sha1');
			uci.unset(IPSEC_CONFIG, espName, 'dh_group');
			uci.unset(IPSEC_CONFIG, espName, 'prf_algorithm');
			return uci.save();
		}).then(() => applyChanges())
			.then(() => this.restartIpsecAfterApply())
			.then(() => {
				ui.hideModal();
				this.modalOpen = false;
				notify(_('L2TP/IPsec connection saved.'), 'info');
				return this.refresh();
			})
			.catch(err => {
				notify(_('Failed to save L2TP/IPsec connection: %s').format(err.message || err), 'danger');
				button.disabled = false;
				dom_content(button, fields.section ? _('Save') : _('Add connection'));
				return false;
			});
	},

	saveIkev2Connection(fields, button) {
		const error = this.validateIkev2Connection(fields);
		if (error) {
			notify(error, 'warning');
			return Promise.resolve(false);
		}
		if (!IKEV2_PACKAGES.every(name => this.packages && this.packages[name])) {
			notify(_('Install the IKEv2/IPsec packages from Applications before saving a tunnel.'), 'warning');
			return Promise.resolve(false);
		}

		button.disabled = true;
		dom_content(button, _('Saving…'));
		let section;
		let remoteName;
		let childName;
		let secretName;
		let ikeName;
		let espName;
		return Promise.all([ uci.load('network'), uci.load(IPSEC_CONFIG).catch(() => null) ]).then(() => {
			section = fields.section || uci.add('network', 'interface');
			remoteName = fields.remoteSection || managedIpsecSection('fnr_', section + ':ikev2');
			childName = fields.childSection || managedIpsecSection('fnc_', section + ':ikev2');
			secretName = fields.secretSection || managedIpsecSection('fns_', section + ':ikev2');
			ikeName = fields.ikeProposalSection || managedIpsecSection('fnp_', section + ':ikev2-ike');
			espName = fields.espProposalSection || managedIpsecSection('fne_', section + ':ikev2-esp');
			this.ensureIpsecSection('ipsec', IPSEC_GLOBALS);

			uci.set('network', section, 'proto', XFRM_PROTO);
			if (fields.enabled) uci.unset('network', section, 'disabled');
			else uci.set('network', section, 'disabled', '1');
			uci.set('network', section, 'freenetic_protocol', IKEV2_PROTO);
			uci.set('network', section, 'freenetic_name', fields.name);
			uci.set('network', section, 'freenetic_ipsec_remote', remoteName);
			uci.set('network', section, 'freenetic_ipsec_child', childName);
			uci.set('network', section, 'freenetic_ipsec_secret', fields.authMethod === 'eap-mschapv2' ? secretName : '');
			uci.set('network', section, 'ifid', fields.ifid || String(1000 + (parseInt(sectionToken(section), 36) % 40000)));
			this.setOptional('network', section, 'mtu', fields.mtu);
			this.setOptional('network', section, 'freenetic_ifid', fields.ifid);
			[ 'server', 'username', 'password', 'keepalive', 'ipv6', 'pppd_options' ].forEach(option => uci.unset('network', section, option));

			uci.set(IPSEC_CONFIG, remoteName, 'enabled', fields.enabled ? '1' : '0');
			uci.set(IPSEC_CONFIG, remoteName, 'keyexchange', 'ikev2');
			uci.set(IPSEC_CONFIG, remoteName, 'authentication_method', fields.authMethod);
			if (fields.authMethod === 'eap-mschapv2') {
				uci.unset(IPSEC_CONFIG, remoteName, 'pre_shared_key');
				uci.set(IPSEC_CONFIG, remoteName, 'eap_id', fields.username);
				this.setOptional(IPSEC_CONFIG, remoteName, 'remote_ca_certs', fields.caCert);
				this.ensureIpsecSection('mschapv2_secrets', secretName);
				uci.set(IPSEC_CONFIG, secretName, 'id', fields.username);
				uci.set(IPSEC_CONFIG, secretName, 'secret', fields.password);
			}
			else {
				uci.set(IPSEC_CONFIG, remoteName, 'pre_shared_key', fields.psk);
				[ 'eap_id', 'remote_ca_certs' ].forEach(option => uci.unset(IPSEC_CONFIG, remoteName, option));
				if (fields.secretSection && uci.get(IPSEC_CONFIG, fields.secretSection, '.type'))
					uci.remove(IPSEC_CONFIG, fields.secretSection);
			}
			this.setOptional(IPSEC_CONFIG, remoteName, 'local_identifier', fields.localIdentifier);
			this.setOptional(IPSEC_CONFIG, remoteName, 'remote_identifier', fields.remoteIdentifier);
			uci.set(IPSEC_CONFIG, remoteName, 'remote_addrs', parseEndpoint(fields.gateway).host);
			uci.set(IPSEC_CONFIG, remoteName, 'mobike', fields.mobike ? '1' : '0');
			uci.set(IPSEC_CONFIG, remoteName, 'encap', fields.encap ? '1' : '0');
			this.setList(IPSEC_CONFIG, remoteName, 'crypto_proposal', [ ikeName ]);
			this.setList(IPSEC_CONFIG, remoteName, 'tunnel', [ childName ]);

			this.setList(IPSEC_CONFIG, childName, 'local_subnet', fields.localSelectors);
			this.setList(IPSEC_CONFIG, childName, 'remote_subnet', fields.remoteSelectors);
			this.setList(IPSEC_CONFIG, childName, 'crypto_proposal', [ espName ]);
			uci.set(IPSEC_CONFIG, childName, 'if_id', uci.get('network', section, 'ifid'));
			uci.set(IPSEC_CONFIG, childName, 'interface', section);
			uci.set(IPSEC_CONFIG, childName, 'startaction', fields.autoStart ? 'start' : 'none');
			uci.set(IPSEC_CONFIG, childName, 'dpdaction', 'restart');
			uci.set(IPSEC_CONFIG, childName, 'closeaction', 'start');

			uci.set(IPSEC_CONFIG, ikeName, 'is_esp', '0');
			uci.set(IPSEC_CONFIG, ikeName, 'encryption_algorithm', 'aes256gcm128');
			uci.unset(IPSEC_CONFIG, ikeName, 'hash_algorithm');
			uci.set(IPSEC_CONFIG, ikeName, 'dh_group', 'modp2048');
			uci.set(IPSEC_CONFIG, ikeName, 'prf_algorithm', 'prfsha256');
			uci.set(IPSEC_CONFIG, espName, 'is_esp', '1');
			uci.set(IPSEC_CONFIG, espName, 'encryption_algorithm', 'aes256gcm128');
			uci.unset(IPSEC_CONFIG, espName, 'hash_algorithm');
			uci.unset(IPSEC_CONFIG, espName, 'dh_group');
			uci.unset(IPSEC_CONFIG, espName, 'prf_algorithm');
			return uci.save();
		}).then(() => applyChanges())
			.then(() => this.restartIpsecAfterApply())
			.then(() => {
				ui.hideModal();
				this.modalOpen = false;
				notify(_('IKEv2/IPsec connection saved.'), 'info');
				return this.refresh();
			})
			.catch(err => {
				notify(_('Failed to save IKEv2/IPsec connection: %s').format(err.message || err), 'danger');
				button.disabled = false;
				dom_content(button, fields.section ? _('Save') : _('Add connection'));
				return false;
			});
	},

	saveOpenvpnConnection(fields, button) {
		const error = this.validateOpenvpnConnection(fields);
		if (error) {
			notify(error, 'warning');
			return Promise.resolve(false);
		}
		if (!openvpnAvailable(this.packages)) {
			notify(_('Install an OpenVPN package from Applications before saving a tunnel.'), 'warning');
			return Promise.resolve(false);
		}

		button.disabled = true;
		dom_content(button, _('Saving…'));
		let section;
		let profileName;
		let profilePath;
		let oldManagedName = '';
		return uci.load('network').then(() => {
			section = fields.section || uci.add('network', 'interface');
			profileName = openvpnProfileName(section);
			profilePath = openvpnProfilePath(section);
			oldManagedName = fields.managedProfile ? openvpnProfileNameFromPath(fields.profilePath) : '';
			return storeOpenvpnProfile(profileName, fields.profile);
		}).then(() => {
			uci.set('network', section, 'proto', OVPN_PROTO);
			if (fields.enabled)
				uci.unset('network', section, 'disabled');
			else
				uci.set('network', section, 'disabled', '1');
			uci.set('network', section, 'freenetic_name', fields.name);
			uci.set('network', section, 'config', profilePath);
			uci.set('network', section, 'freenetic_profile', '1');
			return uci.save();
		}).then(() => applyChanges()).then(() => {
			const cleanup = oldManagedName && oldManagedName !== profileName
				? removeOpenvpnProfile(oldManagedName).catch(() => null)
				: Promise.resolve();
			return cleanup;
		}).then(() => {
			ui.hideModal();
			this.modalOpen = false;
			notify(_('OpenVPN connection saved.'), 'info');
			return this.refresh();
		}).catch(err => {
			notify(_('Failed to save OpenVPN connection: %s').format(err.message || err), 'danger');
			button.disabled = false;
			dom_content(button, fields.section ? _('Save') : _('Add connection'));
			return false;
		});
	},

	saveConnection(fields, button) {
		const error = this.validateConnection(fields);
		if (error) {
			notify(error, 'warning');
			return Promise.resolve(false);
		}
		if (fields.protocol === AWG_PROTO && !this.awgAvailable()) {
			this.openAwgCompatibilityDialog(fields, true);
			return Promise.resolve(false);
		}

		button.disabled = true;
		dom_content(button, _('Saving…'));
		return uci.load('network').then(() => {
			const section = fields.section || uci.add('network', 'interface');
			const oldProtocol = uci.get('network', section, 'proto') || this.formConnection.protocol || WG_PROTO;
			uci.set('network', section, 'proto', fields.protocol);
			if (fields.enabled) uci.unset('network', section, 'disabled');
			else uci.set('network', section, 'disabled', '1');
			uci.set('network', section, 'freenetic_name', fields.name);
			this.setOptional('network', section, 'freenetic_public_key', fields.publicKey);
			this.setOptional('network', section, 'private_key', fields.privateKey);
			this.setList('network', section, 'addresses', fields.addresses);
			this.setList('network', section, 'dns', fields.dns);
			this.setOptional('network', section, 'listen_port', fields.listenPort);
			this.setOptional('network', section, 'mtu', fields.mtu);
			this.setOptional('network', section, 'fwmark', fields.fwmark);
			if (fields.nohostroute) uci.set('network', section, 'nohostroute', '1');
			else uci.unset('network', section, 'nohostroute');

			AWG_OPTIONS.forEach(item => {
				if (fields.protocol === AWG_PROTO)
					this.setOptional('network', section, item[0], fields.awg[item[0]]);
				else
					uci.unset('network', section, item[0]);
			});

			const allOldPeers = peerSectionsFor(section).map(peer => sectionName(peer));
			const typeChanged = oldProtocol !== fields.protocol;
			const newType = peerType(fields.protocol);
			const activePeerNames = {};
			if (typeChanged)
				allOldPeers.forEach(id => uci.remove('network', id));

			fields.peers.forEach(peer => {
				let id = !typeChanged && peer.section && allOldPeers.indexOf(peer.section) !== -1 ? peer.section : null;
				if (!id)
					id = uci.add('network', newType);
				activePeerNames[id] = true;
				this.setOptional('network', id, 'description', peer.description);
				if (peer.disabled) uci.set('network', id, 'disabled', '1');
				else uci.unset('network', id, 'disabled');
				this.setOptional('network', id, 'public_key', peer.publicKey);
				this.setOptional('network', id, 'private_key', peer.privateKey);
				this.setOptional('network', id, 'preshared_key', peer.presharedKey);
				this.setList('network', id, 'allowed_ips', peer.allowedIps);
				this.setOptional('network', id, 'endpoint_host', peer.endpointHost);
				this.setOptional('network', id, 'endpoint_port', peer.endpointPort);
				this.setOptional('network', id, 'persistent_keepalive', peer.keepalive);
				if (peer.routeAllowed) uci.set('network', id, 'route_allowed_ips', '1');
				else uci.unset('network', id, 'route_allowed_ips');
			});

			if (!typeChanged)
				allOldPeers.forEach(id => { if (!activePeerNames[id]) uci.remove('network', id); });
			return uci.save();
		}).then(() => applyChanges()).then(() => {
			ui.hideModal();
			this.modalOpen = false;
			notify(_('Connection settings saved.'), 'info');
			return this.refresh();
		}).catch(err => {
			notify(_('Failed to save connection: %s').format(err.message || err), 'danger');
			button.disabled = false;
			dom_content(button, fields.section ? _('Save') : _('Add connection'));
			return false;
		});
	},

	toggleConnection(connection, toggle) {
		toggle.disabled = true;
		return Promise.all([ uci.load('network'), uci.load(IPSEC_CONFIG).catch(() => null) ]).then(() => {
			if (toggle.checked) uci.unset('network', connection.section, 'disabled');
			else uci.set('network', connection.section, 'disabled', '1');
			if ((connection.protocol === L2TP_IPSEC_PROTO || connection.protocol === IKEV2_PROTO) &&
				connection.remoteSection && uci.get(IPSEC_CONFIG, connection.remoteSection, '.type')) {
				if (toggle.checked) uci.set(IPSEC_CONFIG, connection.remoteSection, 'enabled', '1');
				else uci.set(IPSEC_CONFIG, connection.remoteSection, 'enabled', '0');
			}
			return uci.save();
		}).then(() => applyChanges())
		.then(() => (connection.protocol === L2TP_IPSEC_PROTO || connection.protocol === IKEV2_PROTO
			? this.restartIpsecAfterApply() : null)).then(() => {
			notify(toggle.checked ? _('Connection enabled.') : _('Connection disabled.'), 'info');
			return this.refresh();
		}).catch(err => {
			toggle.checked = !toggle.checked;
			notify(_('Failed to change connection state: %s').format(err.message || err), 'danger');
		}).finally(() => { toggle.disabled = false; });
	},

	deleteConnection(connection) {
		const question = connection.protocol === OVPN_PROTO
			? _('Delete OpenVPN connection "%s" and its managed profile?').format(connection.name)
			: (connection.protocol === L2TP_IPSEC_PROTO || connection.protocol === IKEV2_PROTO
				? _('Delete connection "%s" and its IPsec configuration?').format(connection.name)
				: _('Delete connection "%s" and all its peers?').format(connection.name));
		if (!window.confirm(question))
			return;
		return Promise.all([ uci.load('network'), uci.load(IPSEC_CONFIG).catch(() => null) ]).then(() => {
			if (connection.protocol !== OVPN_PROTO)
				if (connection.protocol === L2TP_IPSEC_PROTO || connection.protocol === IKEV2_PROTO)
					this.removeIpsecSections(connection);
				else
					peerSectionsFor(connection.section).forEach(peer => uci.remove('network', sectionName(peer)));
			uci.remove('network', connection.section);
			return uci.save();
		}).then(() => applyChanges()).then(() => (connection.protocol === L2TP_IPSEC_PROTO || connection.protocol === IKEV2_PROTO
			? this.restartIpsecAfterApply() : null)).then(() => {
			if (connection.protocol === OVPN_PROTO && connection.managedProfile)
				return removeOpenvpnProfile(openvpnProfileNameFromPath(connection.profilePath)).catch(() => null);
			return null;
		}).then(() => {
			notify(_('Connection deleted.'), 'info');
			return this.refresh();
		}).catch(err => notify(_('Failed to delete connection: %s').format(err.message || err), 'danger'));
	},

	exportConnection(connection) {
		if (!connection.privateKey) {
			notify(_('This connection has no private key to export.'), 'warning');
			return;
		}
		if (!window.confirm(_('The exported file contains private keys. Continue?')))
			return;
		const blob = new Blob([ serializeConfig(connection) ], { type: 'text/plain' });
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = (connection.section || 'wireguard') + '.conf';
		document.body.appendChild(link);
		link.click();
		document.body.removeChild(link);
		URL.revokeObjectURL(url);
	},

	exportOpenvpnConnection(connection) {
		if (!connection.profilePath) {
			notify(_('This OpenVPN connection has no profile to export.'), 'warning');
			return;
		}
		if (!window.confirm(_('The exported OpenVPN profile may contain private keys and passwords. Continue?')))
			return;
		return fs.read(connection.profilePath).then(profile => {
			const blob = new Blob([ profile || '' ], { type: 'application/x-openvpn-profile' });
			const url = URL.createObjectURL(blob);
			const link = document.createElement('a');
			link.href = url;
			link.download = (connection.section || 'openvpn') + '.ovpn';
			document.body.appendChild(link);
			link.click();
			document.body.removeChild(link);
			URL.revokeObjectURL(url);
		}).catch(err => notify(_('Failed to export OpenVPN profile: %s').format(err.message || err), 'danger'));
	},

	/* Never downgrade an AWG config implicitly.  The same guard is used for an
	 * imported file and for a manually-created connection, so a user always
	 * chooses between installing the exact AWG support or deliberately removing
	 * the obfuscation fields before saving as ordinary WireGuard. */
	openAwgCompatibilityDialog(draft, reopenOnCancel) {
		const feedTarget = this.feed && this.feed.target && this.feed.subtarget
			? '%s/%s'.format(this.feed.target, this.feed.subtarget)
			: _('this router target');
		const close = () => {
			ui.hideModal();
			this.modalOpen = false;
		};
		const install = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', click: () => {
			return this.installAwg(install, () => this.openForm(draft), true);
		} }, _('Install AmneziaWG support'));
		const strip = E('button', { type: 'button', class: 'fn-settings-btn', click: () => {
			const converted = Object.assign({}, draft, { protocol: WG_PROTO, awg: {} });
			close();
			notify(_('AWG parameters were removed. The connection will be saved as standard WireGuard.'), 'warning');
			this.openForm(converted);
		} }, _('Use standard WireGuard'));
		const cancel = E('button', { type: 'button', class: 'fn-settings-btn', click: () => {
			if (reopenOnCancel) {
				close();
				this.openForm(draft);
			}
			else
				close();
		} }, _('Cancel'));

		ui.showModal(_('AmneziaWG support is required'), [
			E('p', { class: 'fn-oc-modal-description' }, _('This configuration contains AmneziaWG obfuscation parameters. Standard WireGuard cannot use Jc/Jmin/Jmax, S1/S2 or H1–H4, so they must not be written to a regular WireGuard interface.')),
			E('div', { class: 'fn-oc-compat-note' }, [
				E('strong', {}, _('Target-specific signed feed')),
				E('span', {}, _('The installer will use the AmneziaWG feed for %s and verify its signing key. A package must exist for this exact OpenWrt release and kernel.').format(feedTarget))
			]),
			E('div', { class: 'fn-oc-compat-choice' }, [
				E('div', {}, [ E('strong', {}, _('Install AmneziaWG')), E('span', {}, _('Keep every AWG parameter and install the kernel module, tools and LuCI protocol.')) ]),
				install
			]),
			E('div', { class: 'fn-oc-compat-choice' }, [
				E('div', {}, [ E('strong', {}, _('Continue as standard WireGuard')), E('span', {}, _('Remove only the AWG-specific parameters and keep the common interface and peer settings.')) ]),
				strip
			]),
			E('div', { class: 'fn-pf-actions fn-oc-modal-actions' }, [ cancel ])
		]);
		this.modalOpen = true;
		const modal = document.querySelector('#modal_overlay .modal');
		if (modal)
			modal.classList.add('fn-oc-compat-modal');
	},

	openOpenvpnImportDialog() {
		const fileInput = E('input', { type: 'file', class: 'fn-oc-file-input', accept: '.ovpn,.conf,text/plain' });
		const textInput = E('textarea', { class: 'fn-input fn-oc-import-text', placeholder: _('Paste an OpenVPN .ovpn profile here…'), rows: '16', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false' });
		const fileName = E('span', { class: 'fn-oc-file-name' }, _('No file selected'));
		fileInput.addEventListener('change', () => {
			const file = fileInput.files && fileInput.files[0];
			if (!file)
				return;
			dom_content(fileName, file.name);
			const reader = new FileReader();
			reader.onload = event => { textInput.value = event.target.result || ''; };
			reader.readAsText(file);
		});
		const choose = E('button', { type: 'button', class: 'fn-settings-btn', click: () => fileInput.click() }, _('Choose file'));
		const cancel = E('button', { type: 'button', class: 'fn-settings-btn', click: () => { ui.hideModal(); this.modalOpen = false; } }, _('Cancel'));
		const importButton = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', click: () => {
			const error = validateOpenvpnProfile(textInput.value);
			if (error) {
				notify(error, 'warning');
				return;
			}
			const file = fileInput.files && fileInput.files[0];
			const name = file ? file.name.replace(/\.(ovpn|conf)$/i, '') : _('Imported OpenVPN connection');
			ui.hideModal();
			this.modalOpen = false;
			this.openOpenvpnForm({ section: null, name: name, protocol: OVPN_PROTO, enabled: true, profile: textInput.value, profilePath: '' });
		} }, _('Import profile'));

		ui.showModal(_('Import OpenVPN profile'), [
			E('p', { class: 'fn-oc-modal-description' }, _('Import a complete .ovpn profile. Inline certificates and keys are preserved; external files must already be present on the router.')),
			E('div', { class: 'fn-oc-import-file' }, [ choose, fileName, fileInput ]),
			textInput,
			E('div', { class: 'fn-pf-actions fn-oc-modal-actions' }, [ cancel, importButton ])
		]);
		this.modalOpen = true;
		const modal = document.querySelector('#modal_overlay .modal');
		if (modal)
			modal.classList.add('fn-oc-import-modal');
	},

	openImportDialog() {
		const fileInput = E('input', { type: 'file', class: 'fn-oc-file-input', accept: '.conf,text/plain' });
		const textInput = E('textarea', { class: 'fn-input fn-oc-import-text', placeholder: _('Paste a WireGuard or AmneziaWG .conf file here…'), rows: '12' });
		const fileName = E('span', { class: 'fn-oc-file-name' }, _('No file selected'));
		fileInput.addEventListener('change', () => {
			const file = fileInput.files && fileInput.files[0];
			if (!file) return;
			dom_content(fileName, file.name);
			const reader = new FileReader();
			reader.onload = event => { textInput.value = event.target.result || ''; };
			reader.readAsText(file);
		});
		const choose = E('button', { type: 'button', class: 'fn-settings-btn', click: () => fileInput.click() }, _('Choose file'));
		const cancel = E('button', { type: 'button', class: 'fn-settings-btn', click: () => { ui.hideModal(); this.modalOpen = false; } }, _('Cancel'));
		const importButton = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', click: () => {
			const parsed = parseConfig(textInput.value);
			if (parsed.error) {
				notify(parsed.error, 'warning');
				return;
			}
			const file = fileInput.files && fileInput.files[0];
			parsed.name = file ? file.name.replace(/\.conf$/i, '') : _('Imported connection');
			ui.hideModal();
			this.modalOpen = false;
			if (parsed.protocol === AWG_PROTO && !this.awgAvailable())
				this.openAwgCompatibilityDialog(parsed, false);
			else
				this.openForm(parsed);
		} }, _('Import settings'));

		ui.showModal(_('Import VPN configuration'), [
			E('p', { class: 'fn-oc-modal-description' }, _('Import a standard WireGuard or legacy AmneziaWG configuration. AWG parameters are detected automatically and never silently discarded.')),
			E('div', { class: 'fn-oc-import-file' }, [ choose, fileName, fileInput ]),
			textInput,
			E('div', { class: 'fn-pf-actions fn-oc-modal-actions' }, [ cancel, importButton ])
		]);
		this.modalOpen = true;
		const modal = document.querySelector('#modal_overlay .modal');
		if (modal)
			modal.classList.add('fn-oc-import-modal');
	},

	installAwg(button, after, confirmed) {
		if (!confirmed && !window.confirm(_('Connect the signed AmneziaWG feed and install its kernel module and LuCI protocol? The router needs internet access and a compatible package for its exact OpenWrt kernel.')))
			return;
		button.disabled = true;
		dom_content(button, _('Installing…'));
		return fs.exec_direct('/usr/libexec/freenetic-awg-feed', [ 'install' ], 'json').then(result => {
			if (!result || !result.ok)
				throw new Error(result && result.error || _('No compatible AWG package was found.'));
			return restartNetifd().then(() => {
				notify(_('AmneziaWG support installed. Network service restarted.'), 'info');
			}).catch(error => {
				notify(_('AmneziaWG support installed, but the network service could not be restarted: %s Reboot the router before starting a new AWG interface.').format(error.message || error), 'warning');
			}).then(() => this.refresh().then(() => { if (after) after(); }));
		}).catch(err => notifyLong(_('AmneziaWG installation failed: %s').format(err.message || err), 'danger'))
			.finally(() => { button.disabled = false; dom_content(button, _('Connect feed and install')); });
	},

	refresh() {
		return Promise.all([ getInterfaceDump(), getWireGuardStatus(), getInstalledPackages(), getFeedStatus(), uci.load(IPSEC_CONFIG).catch(() => null), getIpsecStatus() ]).then(data => {
			this.interfaceDump = data[0] || {};
			this.wgRpc = data[1] || { available: false, data: {} };
			this.packages = packageMap(data[2]);
			this.feed = data[3];
			this.ipsecAvailable = data[4] !== null;
			this.ipsecStatus = data[5] || { ok: false, available: false, error: _('The IPsec status helper is unavailable.') };
			this.renderSupport();
			this.fillConnections();
		});
	},

	destroy() {
		if (this.modalOpen)
			ui.hideModal();
		this.modalOpen = false;
		this.stopIpsecPolling();
		if (window.__freeneticActiveView === this)
			window.__freeneticActiveView = null;
	},

	addFooter() { return E([]); }
});
