'use strict';
'require view';
'require ui';
'require uci';
'require fs';
'require freenetic-rpc as rpc';
'require freenetic-ui as uiHelper';

/* Wi-Fi ACL deliberately edits the native OpenWrt wireless options instead of
   keeping a second Freenetic database.  hostapd reads macfilter/maclist from
   every wifi-iface, so one card below corresponds to one configured SSID. */
const ubusCall = rpc.call;

const dom_empty = uiHelper.empty;
const notify = uiHelper.notify;
const applyChanges = uiHelper.applyChanges;
const PBR_RESTART_HELPER = '/usr/libexec/freenetic-pbr-restart';

function getWirelessConfig() {
	return ubusCall('uci', 'get', { config: 'wireless' })
		.then(r => r.values || {})
		.catch(() => ({}));
}

function getDhcpLeases() {
	return ubusCall('luci-rpc', 'getDHCPLeases')
		.then(r => r.dhcp_leases || [])
		.catch(() => []);
}

function getWirelessStatus() {
	return ubusCall('network.wireless', 'status').catch(() => ({}));
}

function getUciConfig(config) {
	return ubusCall('uci', 'get', { config: config })
		.then(r => r.values || {})
		.catch(() => ({}));
}

function sectionName(section) {
	return section && (section['.name'] || section.name);
}

function ipv4(value) {
	const parts = String(value || '').trim().split('.');
	return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && +part >= 0 && +part <= 255);
}

function ip2int(value) {
	if (!ipv4(value))
		return null;
	const parts = String(value).split('.').map(Number);
	return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function int2ip(value) {
	return [ (value >>> 24) & 255, (value >>> 16) & 255, (value >>> 8) & 255, value & 255 ].join('.');
}

function netmaskPrefix(value) {
	const n = ip2int(value);
	if (n == null)
		return null;
	let bits = 0;
	for (let i = 31; i >= 0 && (n & (1 << i)); i--)
		bits++;
	const expected = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
	return n === expected ? bits : null;
}

/* Return the IPv4 subnet used by a local network segment.  OpenWrt accepts
 * both `ipaddr + netmask` and the newer `ipaddr: 192.168.1.1/24` form.  The
 * policy engine intentionally starts with IPv4; this keeps the first release
 * predictable while the IPv6 path is still being designed. */
function networkCidr(network) {
	let raw = Array.isArray(network && network.ipaddr) ? network.ipaddr[0] : network && network.ipaddr;
	let prefix = null;
	if (raw && String(raw).indexOf('/') !== -1) {
		const parts = String(raw).split('/');
		raw = parts[0];
		prefix = /^\d+$/.test(parts[1] || '') ? +parts[1] : null;
	}
	if (!ipv4(raw))
		return null;
	if (prefix == null)
		prefix = netmaskPrefix(network && network.netmask);
	if (prefix == null || prefix < 0 || prefix > 32)
		return null;
	const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
	return int2ip((ip2int(raw) & mask) >>> 0) + '/' + prefix;
}

function cidrContains(cidr, address) {
	const parts = String(cidr || '').split('/');
	const base = ip2int(parts[0]);
	const ip = ip2int(address);
	const prefix = /^\d+$/.test(parts[1] || '') ? +parts[1] : null;
	if (base == null || ip == null || prefix == null || prefix < 0 || prefix > 32)
		return false;
	const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
	return (base & mask) >>> 0 === (ip & mask) >>> 0;
}

function policyToken(value) {
	const raw = String(value || 'network');
	let hash = policyHash(raw);
	const safe = raw.replace(/[^A-Za-z0-9_]/g, '_').replace(/^_+|_+$/g, '').slice(0, 24) || 'network';
	return safe + '_' + (hash >>> 0).toString(36);
}

function policyHash(value) {
	const raw = String(value || '');
	let hash = 0;
	for (let i = 0; i < raw.length; i++)
		hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
	return hash;
}

function managedPolicySection(network) {
	return 'freenetic_' + policyToken(network);
}

function managedBlockSection(network) {
	return managedPolicySection(network) + '_block';
}

/* Device rules match a MAC address directly in pbr's nftables prerouting
 * chain.  Keep the generated id short enough for UCI section names while
 * retaining a deterministic mapping for edits and cleanup. */
function managedDeviceSection(mac) {
	return 'freenetic_device_' + (policyHash(mac) >>> 0).toString(36);
}

function managedDeviceBlockSection(mac) {
	return managedDeviceSection(mac) + '_block';
}

function managedDeviceAllowSection(mac) {
	return managedDeviceSection(mac) + '_allow';
}

function isManagedSection(section, scope) {
	return !!section && section.freenetic_managed === '1' &&
		(!scope || section.freenetic_scope === scope);
}

function isVpnInterface(section) {
	const proto = String(section && section.proto || '').toLowerCase();
	return proto === 'wireguard' || proto === 'amneziawg' || proto === 'openvpn' ||
		proto === 'l2tp' || proto === 'xfrm';
}

function vpnProtocolLabel(section) {
	const proto = String(section && section.proto || '').toLowerCase();
	if ((section && section.freenetic_protocol === 'l2tp_ipsec') || proto === 'l2tp')
		return 'L2TP/IPsec';
	if ((section && section.freenetic_protocol === 'ikev2') || proto === 'xfrm')
		return 'IKEv2/IPsec';
	if (proto === 'amneziawg')
		return 'AmneziaWG';
	if (proto === 'openvpn')
		return 'OpenVPN';
	return 'WireGuard';
}

function findZoneForNetwork(firewall, network) {
	return Object.keys(firewall || {}).map(key => firewall[key]).find(zone =>
		zone['.type'] === 'zone' && listValue(zone.network).indexOf(network) !== -1);
}

function findInternetZone(firewall) {
	return Object.keys(firewall || {}).map(key => firewall[key]).find(zone => {
		if (zone['.type'] !== 'zone')
			return false;
		const name = zone.name || sectionName(zone);
		return name === 'wan' || listValue(zone.network).some(network => network === 'wan' || network === 'wan6');
	});
}

function pbrConfigSection(pbr) {
	return Object.keys(pbr || {}).map(key => pbr[key]).find(section =>
		/* pbr's first section is declared as `config pbr`, so its UCI type is
		 * `pbr` rather than the literal string `config`. */
		section['.name'] === 'config' || section['.type'] === 'config');
}

function policyModeLabel(mode) {
	if (mode === 'vpn')
		return _('VPN tunnel');
	if (mode === 'block')
		return _('Block Internet');
	return _('Direct (WAN)');
}

function policyModeClass(mode) {
	return mode === 'block' ? 'fn-status-warn' : 'fn-status-ok';
}

function deviceModeLabel(mode) {
	return mode === 'inherit' ? _('Network default') : policyModeLabel(mode);
}

function deviceModeClass(mode) {
	return mode === 'inherit' ? 'fn-status-off' : policyModeClass(mode);
}

/* DHCP leases are the same source as Client List.  Add currently associated
   stations as well, so a client with a static address can still be picked
   from the page before it has appeared in dnsmasq's lease file. */
function getWifiStations(wstatus) {
	const stations = {};
	const jobs = [];

	Object.keys(wstatus || {}).forEach(radioName => {
		const radio = wstatus[radioName] || {};
		(radio.interfaces || []).forEach(iface => {
			if (!iface.ifname)
				return;

			jobs.push(ubusCall('iwinfo', 'assoclist', { device: iface.ifname })
				.then(result => {
					(result.results || []).forEach(station => {
						const mac = normalizeMac(station.mac);
						if (mac)
							stations[mac] = { network: (iface.config && iface.config.network && iface.config.network[0]) || 'lan' };
					});
				})
				.catch(() => {}));
		});
	});

	return Promise.all(jobs).then(() => stations);
}

/* Accept the usual colon form plus the hyphen/dotted forms users commonly
   copy from a client list, but always write canonical uppercase colon MACs. */
function normalizeMac(value) {
	const raw = String(value || '').trim();
	const compact = raw.replace(/[:-]/g, '').replace(/\./g, '');
	if (!/^[0-9a-fA-F]{12}$/.test(compact))
		return null;

	const octets = compact.match(/.{2}/g);
	return octets ? octets.join(':').toUpperCase() : null;
}

function listValue(value) {
	if (Array.isArray(value))
		return value;
	return value ? String(value).split(/[\s,]+/).filter(Boolean) : [];
}

function readMacList(value) {
	const seen = {};
	return listValue(value).map(normalizeMac).filter(mac => {
		if (!mac || seen[mac])
			return false;
		seen[mac] = true;
		return true;
	});
}

function networkLabel(network) {
	if (Array.isArray(network))
		network = network[0];

	switch (network) {
	case 'lan': return _('Home network');
	case 'guest': return _('Guest network');
	default: return network || _('Unassigned network');
	}
}

function bandLabel(radio) {
	const band = String((radio && radio.band) || '').toLowerCase();
	if (band === '2g' || band === '2.4g' || band === '2.4ghz')
		return '2.4 GHz';
	if (band === '5g' || band === '5ghz')
		return '5 GHz';
	if (band === '6g' || band === '6ghz')
		return '6 GHz';
	return radio && radio['.name'] ? radio['.name'] : _('Wi-Fi radio');
}

function aclMode(iface) {
	const mode = String(iface.macfilter || '').toLowerCase();
	return mode === 'allow' || mode === 'deny' ? mode : 'disabled';
}

function ifaceNetwork(iface) {
	const network = iface && iface.network;
	return Array.isArray(network) ? (network[0] || 'lan') : (network || 'lan');
}

function networkOrder(network) {
	if (network === 'lan')
		return 0;
	if (network === 'guest')
		return 1;
	return 2;
}

function modeLabel(mode) {
	return mode === 'allow' ? _('Allow list') : mode === 'deny' ? _('Deny list') : _('Disabled');
}

function modeStatusClass(mode) {
	return mode === 'allow' ? 'fn-status-ok' : mode === 'deny' ? 'fn-status-warn' : 'fn-status-off';
}

function collectClients(leases, stations) {
	const clients = {};

	(leases || []).forEach(lease => {
		const mac = normalizeMac(lease.macaddr || lease.mac);
		if (!mac)
			return;

		const label = lease.hostname || lease.name || lease.ipaddr || '';
		clients[mac] = {
			mac,
			label,
			ipaddr: ipv4(lease.ipaddr) ? lease.ipaddr : '',
			network: lease.network || '',
			source: 'lease'
		};
	});

	Object.keys(stations || {}).forEach(mac => {
		if (!clients[mac]) {
			clients[mac] = {
				mac,
				label: _('Connected Wi-Fi client'),
				network: stations[mac].network || '',
				source: 'wifi'
			};
		}
		else if (!clients[mac].network && stations[mac].network) {
			clients[mac].network = stations[mac].network;
		}
	});

	return Object.keys(clients).map(mac => clients[mac]).sort((a, b) => {
		const left = a.label || a.mac, right = b.label || b.mac;
		return left.localeCompare(right) || a.mac.localeCompare(b.mac);
	});
}

return view.extend({
	load() {
		return Promise.all([
			getWirelessConfig(),
			getDhcpLeases(),
			getWirelessStatus(),
			getUciConfig('network'),
			getUciConfig('firewall'),
			getUciConfig('pbr')
		]).then(data => getWifiStations(data[2]).then(stations => ({
			wireless: data[0],
			leases: data[1],
			stations,
			network: data[3],
			firewall: data[4],
			pbr: data[5]
		})));
	},

	render(data) {
		this.wireless = data.wireless || {};
		this.clients = collectClients(data.leases, data.stations);
		this.clientByMac = {};
		this.clients.forEach(client => { this.clientByMac[client.mac] = client; });
		this.network = data.network || {};
		this.firewall = data.firewall || {};
		this.pbr = data.pbr || {};
		this.pbrSection = pbrConfigSection(this.pbr);
		this.pbrAvailable = !!this.pbrSection;
		this.cardsNode = E('div', { class: 'fn-oc-connections fn-wifi-acl-cards' });
		this.policySection = this.renderPolicySection();

		this.fillCards();

		const clientLink = E('a', {
			class: 'fn-oc-notice-link',
			href: L.url('admin', 'status', 'clients')
		}, _('Open Client List'));

		return E('div', { class: 'fn-pf-page fn-wifi-acl-page' }, [
			E('h1', { class: 'fn-pf-title' }, _('Access & Routing Policy')),
			E('p', { class: 'fn-pf-description' }, _('Manage Wi-Fi access rules and choose how traffic from network segments or individual devices reaches the internet.')),
			E('div', { class: 'fn-oc-notice fn-oc-notice-warning fn-wifi-acl-warning' }, [
				E('strong', {}, _('Allow lists block unlisted devices')),
				E('span', {}, _('Add your management device first. Applying a rule may briefly restart Wi-Fi.')),
				clientLink
			]),
			this.policySection,
			E('h2', { class: 'fn-wifi-acl-section-title' }, _('Wi-Fi access control')),
			this.cardsNode
		]);
	},

	renderPolicySection() {
		this.policyCardsNode = E('div', { class: 'fn-wifi-policy-cards' });
		this.policyNoticeNode = E('div', { class: 'fn-wifi-policy-notice' });
		this.devicePolicyCardsNode = E('div', { class: 'fn-wifi-device-policy-cards' });
		this.fillPolicies();
		this.fillDevicePolicies();

		return E('section', { class: 'fn-wifi-policy-section' }, [
			E('div', { class: 'fn-wifi-policy-head' }, [
				E('div', {}, [
					E('h2', { class: 'fn-wifi-acl-section-title' }, _('Access & Routing Policy')),
					E('p', { class: 'fn-wifi-policy-description' }, _('Choose how traffic from each network segment reaches the internet. The policy applies to all Wi-Fi and wired clients in that segment.'))
				])
			]),
			this.policyNoticeNode,
			this.policyCardsNode,
			E('div', { class: 'fn-wifi-device-policy-head' }, [
				E('h3', {}, _('Device policies')),
				E('p', {}, _('Override the segment policy for individual clients. Rules match the device MAC address, so a DHCP address change does not break the rule.'))
			]),
			this.devicePolicyCardsNode
		]);
	},

	clientNetwork(client) {
		if (!client)
			return '';
		if (client.policyNetwork && this.network[client.policyNetwork])
			return client.policyNetwork;
		if (client.network && this.network[client.network])
			return client.network;
		if (!client.ipaddr)
			return '';

		return this.policyNetworks().find(name => cidrContains(networkCidr(this.network[name]), client.ipaddr)) || '';
	},

	vpnInterfaces() {
		return Object.keys(this.network || {}).map(key => this.network[key]).filter(section =>
			section['.type'] === 'interface' && isVpnInterface(section) && section.disabled !== '1');
	},

	managedDeviceEntries() {
		const byMac = {};
		(this.clients || []).forEach(client => { byMac[client.mac] = Object.assign({}, client); });

		const remember = (mac, section) => {
			const normalized = normalizeMac(mac);
			if (!normalized)
				return;
			if (!byMac[normalized])
				byMac[normalized] = { mac: normalized, label: _('Configured device'), source: 'policy' };
			if (!byMac[normalized].policyNetwork && section.freenetic_network)
				byMac[normalized].policyNetwork = section.freenetic_network;
		};

		Object.keys(this.pbr || {}).forEach(key => {
			const section = this.pbr[key];
			if (!isManagedSection(section, 'device'))
				return;
			listValue(section.freenetic_mac || section.src_addr).forEach(mac => remember(mac, section));
		});
		Object.keys(this.firewall || {}).forEach(key => {
			const section = this.firewall[key];
			if (!isManagedSection(section, 'device') && !isManagedSection(section, 'device-allow'))
				return;
			listValue(section.freenetic_mac || section.src_mac).forEach(mac => remember(mac, section));
		});

		return Object.keys(byMac).map(mac => byMac[mac]).sort((a, b) => {
			const left = a.label || a.mac, right = b.label || b.mac;
			return left.localeCompare(right) || a.mac.localeCompare(b.mac);
		});
	},

	currentDevicePolicy(mac) {
		const pbr = this.pbr[managedDeviceSection(mac)];
		if (isManagedSection(pbr, 'device') && pbr.enabled !== '0') {
			if (pbr.interface === 'wan')
				return { mode: 'direct', vpnInterface: '', network: pbr.freenetic_network || '' };
			if (pbr.interface)
				return { mode: 'vpn', vpnInterface: pbr.interface, network: pbr.freenetic_network || '' };
		}

		const block = this.firewall[managedDeviceBlockSection(mac)];
		if (isManagedSection(block, 'device') && block.enabled !== '0')
			return { mode: 'block', vpnInterface: '', network: block.freenetic_network || '' };

		const allow = this.firewall[managedDeviceAllowSection(mac)];
		if (isManagedSection(allow, 'device-allow') && allow.enabled !== '0')
			return { mode: 'direct', vpnInterface: '', network: allow.freenetic_network || '' };
		return { mode: 'inherit', vpnInterface: '', network: allow && allow.freenetic_network || '' };
	},

	fillDevicePolicies() {
		if (!this.devicePolicyCardsNode)
			return;
		dom_empty(this.devicePolicyCardsNode);
		const devices = this.managedDeviceEntries();
		if (!devices.length) {
			this.devicePolicyCardsNode.appendChild(E('div', { class: 'fn-oc-empty fn-wifi-device-policy-empty' }, [
				E('strong', {}, _('No clients available')),
				E('span', {}, _('Connect a device or wait for a DHCP lease to assign a per-device policy.'))
			]));
			return;
		}
		devices.forEach(client => this.devicePolicyCardsNode.appendChild(this.renderDevicePolicyCard(client)));
	},

	policyNetworks() {
		const wifiNetworks = {};
		Object.keys(this.wireless || {}).forEach(key => {
			const iface = this.wireless[key];
			if (iface['.type'] !== 'wifi-iface' || (iface.mode || 'ap') !== 'ap')
				return;
			listValue(iface.network || 'lan').forEach(name => {
				if (name)
					wifiNetworks[name] = true;
			});
		});

		const names = {};
		Object.keys(this.network || {}).forEach(key => {
			const section = this.network[key];
			if (section['.type'] !== 'interface')
				return;
			const name = sectionName(section);
			const proto = String(section.proto || '').toLowerCase();
			if (!name || name === 'loopback' || name === 'wan' || name === 'wan6' ||
				isVpnInterface(section) || proto === 'dhcp' || proto === 'dhcpv6')
				return;
			/* Static interfaces are local segments. Include a network referenced by
			 * Wi-Fi even if it has not got an IP yet, so the page can explain why
			 * the policy is unavailable instead of silently hiding it. */
			if (wifiNetworks[name] || proto === 'static' || section.ipaddr)
				names[name] = true;
		});
		Object.keys(wifiNetworks).forEach(name => { if (!names[name]) names[name] = true; });

		return Object.keys(names).sort((a, b) => networkOrder(a) - networkOrder(b) || a.localeCompare(b));
	},

	currentPolicy(network) {
		const p = this.pbr[managedPolicySection(network)];
		if (p && p.freenetic_managed === '1' && p.enabled !== '0') {
			if (p.interface === 'wan')
				return { mode: 'direct', vpnInterface: '' };
			if (p.interface)
				return { mode: 'vpn', vpnInterface: p.interface };
		}

		const block = this.firewall[managedBlockSection(network)];
		if (block && block.freenetic_managed === '1' && block.enabled !== '0')
			return { mode: 'block', vpnInterface: '' };

		return { mode: 'direct', vpnInterface: '' };
	},

	fillPolicies() {
		if (!this.policyCardsNode)
			return;
		dom_empty(this.policyCardsNode);
		dom_empty(this.policyNoticeNode);

		if (!this.pbrAvailable) {
			const link = E('a', {
				class: 'fn-wifi-policy-link',
				href: L.url('admin', 'system', 'applications')
			}, _('Open Applications'));
			this.policyNoticeNode.className = 'fn-oc-notice fn-oc-notice-warning fn-wifi-policy-notice';
			this.policyNoticeNode.appendChild(E('strong', {}, _('VPN routing is not installed')));
			this.policyNoticeNode.appendChild(E('span', {}, _('Direct and Block Internet work without extra packages. Install the advanced “Policy-based routing” package from Applications to route a segment through a VPN tunnel.')));
			this.policyNoticeNode.appendChild(link);
		}
		else {
			this.policyNoticeNode.className = 'fn-oc-notice fn-wifi-policy-notice';
			this.policyNoticeNode.appendChild(E('strong', {}, _('Policies apply per network segment')));
			this.policyNoticeNode.appendChild(E('span', {}, _('Home and Guest may include both Wi-Fi bands and wired clients. IPv4 is supported in this first version; IPv6 keeps its normal route.')));
		}

		const networks = this.policyNetworks();
		if (!networks.length) {
			this.policyCardsNode.appendChild(E('div', { class: 'fn-oc-empty fn-wifi-policy-empty' }, [
				E('strong', {}, _('No local network segments found')),
				E('span', {}, _('Create a Home or Guest network before assigning a traffic policy.'))
			]));
			return;
		}

		networks.forEach(name => this.policyCardsNode.appendChild(this.renderPolicyCard(name)));
	},

	renderPolicyCard(name) {
		const network = this.network[name] || {};
		const cidr = networkCidr(network);
		const zone = findZoneForNetwork(this.firewall, name);
		const wanZone = findInternetZone(this.firewall);
		const current = this.currentPolicy(name);
		const vpnInterfaces = Object.keys(this.network || {}).map(key => this.network[key]).filter(section =>
			section['.type'] === 'interface' && isVpnInterface(section) && section.disabled !== '1');
		const vpnByName = {};
		vpnInterfaces.forEach(section => { vpnByName[sectionName(section)] = section; });

		const status = E('span', { class: 'fn-status-pill ' + policyModeClass(current.mode) }, policyModeLabel(current.mode));
		const modeSelect = E('select', { class: 'fn-input fn-wifi-policy-mode' }, [
			E('option', { value: 'direct' }, _('Direct (WAN)')),
			E('option', { value: 'vpn', disabled: (!this.pbrAvailable || !vpnInterfaces.length) ? true : null }, _('VPN tunnel')),
			E('option', { value: 'block', disabled: (!zone || !wanZone) ? true : null }, _('Block Internet'))
		]);
		modeSelect.value = current.mode === 'vpn' && vpnByName[current.vpnInterface] ? 'vpn' : current.mode;

		const vpnSelect = E('select', { class: 'fn-input' }, [
			E('option', { value: '' }, vpnInterfaces.length ? _('Select a VPN connection') : _('No VPN connections configured'))
		]);
		vpnInterfaces.forEach(section => {
			const ifaceName = sectionName(section);
			vpnSelect.appendChild(E('option', { value: ifaceName }, (section.label || section.freenetic_name || ifaceName) + ' · ' + vpnProtocolLabel(section)));
		});
		vpnSelect.value = vpnByName[current.vpnInterface] ? current.vpnInterface : (vpnInterfaces[0] && sectionName(vpnInterfaces[0]) || '');
		const vpnField = E('div', { class: 'fn-settings-field fn-wifi-policy-vpn-field' }, [ E('label', {}, _('VPN connection')), vpnSelect ]);
		const hint = E('p', { class: 'fn-wifi-policy-hint' });
		const saveButton = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary' }, _('Save'));

		const updateUi = () => {
			const mode = modeSelect.value;
			status.className = 'fn-status-pill ' + policyModeClass(mode);
			dom_empty(status);
			status.appendChild(document.createTextNode(policyModeLabel(mode)));
			vpnField.hidden = mode !== 'vpn';
			if (mode === 'vpn')
				hint.textContent = this.pbrAvailable && vpnInterfaces.length ? _('Only IPv4 traffic from this segment uses the selected tunnel.') : _('Install Policy-based routing and configure a VPN connection first.');
			else if (mode === 'block')
				hint.textContent = _('Internet forwarding is rejected for this segment; access to the router remains available.');
			else
				hint.textContent = _('Traffic follows the regular Internet (WAN) route.');
		};
		modeSelect.addEventListener('change', updateUi);
		updateUi();

		const subtitle = [ cidr || _('IPv4 address is not configured'), zone ? _('Firewall zone %s').format(zone.name || sectionName(zone)) : _('No firewall zone') ].join(' · ');
		const title = network.label || networkLabel(name);
		const bodyChildren = [
			E('div', { class: 'fn-wifi-policy-form' }, [
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Traffic policy')), modeSelect ]),
				vpnField
			]),
			hint
		];
		if (!cidr || !zone || !wanZone)
			bodyChildren.push(E('div', { class: 'fn-wifi-policy-warning' },
				!cidr ? _('Set an IPv4 address and subnet mask for this network first.') : _('A firewall zone for this network and the Internet is required for this policy.')));
		bodyChildren.push(E('div', { class: 'fn-oc-actions fn-wifi-policy-actions' }, [ saveButton ]));
		const card = E('article', { class: 'fn-card fn-wifi-policy-card' }, [
			E('div', { class: 'fn-card-head fn-wifi-policy-card-head' }, [
				E('div', { class: 'fn-oc-card-title' }, [ E('h3', {}, title), E('span', { class: 'fn-oc-protocol' }, subtitle) ]),
				status
			]),
			E('div', { class: 'fn-card-body' }, bodyChildren)
		]);

		saveButton.addEventListener('click', () => this.savePolicy(name, {
			mode: modeSelect.value,
			vpnInterface: vpnSelect.value,
			cidr,
			zone: zone && (zone.name || sectionName(zone)),
			wanZone: wanZone && (wanZone.name || sectionName(wanZone)),
			pbrAvailable: this.pbrAvailable
		}, saveButton));

		return card;
	},

	renderDevicePolicyCard(client) {
		const mac = client.mac;
		const current = this.currentDevicePolicy(mac);
		const networkName = this.clientNetwork(client) || current.network || '';
		const zone = networkName && findZoneForNetwork(this.firewall, networkName);
		const wanZone = findInternetZone(this.firewall);
		const segmentPolicy = networkName ? this.currentPolicy(networkName) : { mode: 'direct' };
		const vpnInterfaces = this.vpnInterfaces();
		const vpnByName = {};
		vpnInterfaces.forEach(section => { vpnByName[sectionName(section)] = section; });

		const title = client.label && client.label !== client.ipaddr ? client.label : mac;
		const subtitle = [
			mac,
			networkName ? networkLabel(networkName) : _('Network not detected'),
			client.ipaddr || ''
		].filter(Boolean).join(' · ');
		const status = E('span', { class: 'fn-status-pill ' + deviceModeClass(current.mode) }, deviceModeLabel(current.mode));
		const modeSelect = E('select', { class: 'fn-input fn-wifi-device-policy-mode' }, [
			E('option', { value: 'inherit' }, _('Use network default')),
			E('option', { value: 'direct' }, _('Direct (WAN)')),
			E('option', { value: 'vpn', disabled: (!this.pbrAvailable || !vpnInterfaces.length) ? true : null }, _('VPN tunnel')),
			E('option', { value: 'block', disabled: (!networkName || !zone || !wanZone) ? true : null }, _('Block Internet'))
		]);
		modeSelect.value = current.mode;

		const vpnSelect = E('select', { class: 'fn-input' }, [
			E('option', { value: '' }, vpnInterfaces.length ? _('Select a VPN connection') : _('No VPN connections configured'))
		]);
		vpnInterfaces.forEach(section => {
			const ifaceName = sectionName(section);
			vpnSelect.appendChild(E('option', { value: ifaceName }, (section.label || section.freenetic_name || ifaceName) + ' · ' + vpnProtocolLabel(section)));
		});
		vpnSelect.value = vpnByName[current.vpnInterface] ? current.vpnInterface : (vpnInterfaces[0] && sectionName(vpnInterfaces[0]) || '');
		const vpnField = E('div', { class: 'fn-settings-field fn-wifi-policy-vpn-field' }, [ E('label', {}, _('VPN connection')), vpnSelect ]);
		const hint = E('p', { class: 'fn-wifi-policy-hint' });
		const saveButton = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary' }, _('Save'));

		const updateUi = () => {
			const mode = modeSelect.value;
			status.className = 'fn-status-pill ' + deviceModeClass(mode);
			dom_empty(status);
			status.appendChild(document.createTextNode(deviceModeLabel(mode)));
			vpnField.hidden = mode !== 'vpn';
			if (mode === 'vpn')
				hint.textContent = this.pbrAvailable && vpnInterfaces.length ? _('This device is matched by its MAC address; only its IPv4 traffic uses the selected tunnel.') : _('Install Policy-based routing and configure a VPN connection first.');
			else if (mode === 'block')
				hint.textContent = _('Internet forwarding is rejected for this device; access to the router remains available.');
			else if (mode === 'direct')
				hint.textContent = _('This device uses the regular Internet (WAN) route, regardless of the segment policy.');
			else
				hint.textContent = _('The device follows the %s policy: %s.').format(
					networkName ? networkLabel(networkName) : _('its network'), policyModeLabel(segmentPolicy.mode));
		};
		modeSelect.addEventListener('change', updateUi);
		updateUi();

		const warnings = [];
		if (!networkName)
			warnings.push(_('The network segment could not be detected. Block Internet requires a DHCP lease or an active Wi-Fi connection.'));
		else if (!zone || !wanZone)
			warnings.push(_('A firewall zone for this network and the Internet is required for Block Internet.'));
		const warning = warnings.length ? E('div', { class: 'fn-wifi-policy-warning' }, warnings.join(' ')) : null;

		const card = E('article', { class: 'fn-card fn-wifi-device-policy-card' }, [
			E('div', { class: 'fn-card-head fn-wifi-policy-card-head' }, [
				E('div', { class: 'fn-oc-card-title' }, [ E('h3', {}, title), E('span', { class: 'fn-oc-protocol' }, subtitle) ]),
				status
			]),
			E('div', { class: 'fn-card-body' }, [
				E('div', { class: 'fn-wifi-policy-form' }, [
					E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Traffic policy')), modeSelect ]),
					vpnField
				]),
				hint,
				warning,
				E('div', { class: 'fn-oc-actions fn-wifi-policy-actions' }, [ saveButton ])
			])
		]);
		saveButton.addEventListener('click', () => this.saveDevicePolicy(mac, {
			mode: modeSelect.value,
			vpnInterface: vpnSelect.value,
			network: networkName,
			zone: zone && (zone.name || sectionName(zone)),
			wanZone: wanZone && (wanZone.name || sectionName(wanZone)),
			pbrAvailable: this.pbrAvailable
		}, saveButton));
		return card;
	},

	reorderManagedPbrPolicies() {
		const sections = uci.sections('pbr', 'policy');
		const devices = sections.filter(section => isManagedSection(section, 'device'));
		const networks = sections.filter(section => isManagedSection(section) && section.freenetic_scope !== 'device');
		if (!devices.length || !networks.length)
			return;

		const firstNetwork = networks[0]['.name'];
		/* pbr evaluates policies in UCI order. Device MAC rules must precede the
		 * broader /24 segment rules or the latter would consume their packets. */
		for (let i = devices.length - 1; i >= 0; i--)
			uci.move('pbr', devices[i]['.name'], firstNetwork, false);
	},

	syncDeviceFirewallExceptions(network, zone, wanZone) {
		const segmentBlock = uci.get('firewall', managedBlockSection(network));
		const devicePbr = {};
		uci.sections('pbr', 'policy').forEach(section => {
			if (!isManagedSection(section, 'device') || section.enabled === '0' || section.freenetic_network !== network)
				return;
			const mac = normalizeMac(section.freenetic_mac || section.src_addr);
			if (mac)
				devicePbr[mac] = true;
		});
		uci.sections('firewall', 'rule').forEach(section => {
			if (!isManagedSection(section, 'device-allow') || section.freenetic_network !== network)
				return;
			const mac = normalizeMac(section.freenetic_mac || section.src_mac);
			if (mac)
				devicePbr[mac] = true;
		});

		Object.keys(devicePbr).forEach(mac => {
			if (!mac)
				return;
			const allowSectionName = managedDeviceAllowSection(mac);
			const existingAllow = uci.get('firewall', allowSectionName);
			if (existingAllow && !isManagedSection(existingAllow, 'device-allow'))
				throw new Error(_('A non-Freenetic firewall rule already uses this device exception name.'));
			if (isManagedSection(segmentBlock) && zone && wanZone) {
				const section = existingAllow || uci.add('firewall', 'rule', allowSectionName);
				const client = this.clientByMac[mac] || {};
				const label = client.label && client.label !== client.ipaddr ? client.label : mac;
				uci.set('firewall', section, 'name', 'Freenetic — Allow device override for ' + label);
				uci.set('firewall', section, 'src', zone);
				uci.set('firewall', section, 'dest', wanZone);
				uci.set('firewall', section, 'src_mac', [ mac.toLowerCase() ]);
				uci.set('firewall', section, 'target', 'ACCEPT');
				uci.set('firewall', section, 'enabled', '1');
				uci.set('firewall', section, 'freenetic_managed', '1');
				uci.set('firewall', section, 'freenetic_scope', 'device-allow');
				uci.set('firewall', section, 'freenetic_mac', mac);
				uci.set('firewall', section, 'freenetic_network', network);
				uci.move('firewall', section, managedBlockSection(network), false);
			}
			else if (existingAllow && isManagedSection(existingAllow, 'device-allow')) {
				uci.remove('firewall', allowSectionName);
			}
		});
	},

	restartPbr() {
		return fs.exec_direct(PBR_RESTART_HELPER, [], 'json').then(result => {
			if (!result || result.ok !== true)
				return { ok: false, error: result && result.error || _('The policy routing service did not restart.') };
			return result;
		}).catch(error => ({ ok: false, error: error.message || error }));
	},

	refreshPolicies() {
		return Promise.all([ getUciConfig('network'), getUciConfig('firewall'), getUciConfig('pbr') ]).then(data => {
			this.network = data[0] || {};
			this.firewall = data[1] || {};
			this.pbr = data[2] || {};
			this.pbrSection = pbrConfigSection(this.pbr);
			this.pbrAvailable = !!this.pbrSection;
			this.fillPolicies();
			this.fillDevicePolicies();
		});
	},

	savePolicy(network, opts, saveButton) {
		if (!opts.cidr) {
			notify(_('Set an IPv4 address and subnet mask for this network first.'), 'warning');
			return Promise.resolve();
		}
		if (opts.mode === 'vpn' && (!opts.pbrAvailable || !opts.vpnInterface)) {
			notify(_('Install Policy-based routing and configure a VPN connection first.'), 'warning');
			return Promise.resolve();
		}
		if (opts.mode === 'block' && (!opts.zone || !opts.wanZone)) {
			notify(_('A firewall zone for this network and the Internet is required.'), 'warning');
			return Promise.resolve();
		}

		saveButton.disabled = true;
		const configs = [ 'network', 'firewall' ];
		if (opts.pbrAvailable)
			configs.push('pbr');

		return uci.load(configs).then(() => {
			const pbrSection = managedPolicySection(network);
			if (opts.pbrAvailable) {
				const existing = uci.get('pbr', pbrSection);
				if (existing && existing.freenetic_managed !== '1')
					throw new Error(_('A non-Freenetic pbr policy already uses this name.'));
				if (opts.mode === 'direct' || opts.mode === 'vpn') {
					const section = existing || uci.add('pbr', 'policy', pbrSection);
					uci.set('pbr', section, 'name', 'Freenetic — ' + (this.network[network] && (this.network[network].label || networkLabel(network)) || network));
					uci.set('pbr', section, 'interface', opts.mode === 'vpn' ? opts.vpnInterface : 'wan');
					uci.set('pbr', section, 'src_addr', opts.cidr);
					uci.set('pbr', section, 'enabled', '1');
					uci.set('pbr', section, 'freenetic_managed', '1');
					uci.set('pbr', section, 'freenetic_scope', 'network');
					uci.set('pbr', section, 'freenetic_network', network);
				}
				else if (existing && existing.freenetic_managed === '1') {
					uci.remove('pbr', pbrSection);
				}
			}

			const blockSection = managedBlockSection(network);
			const existingBlock = uci.get('firewall', blockSection);
			if (existingBlock && existingBlock.freenetic_managed !== '1')
				throw new Error(_('A non-Freenetic firewall rule already uses this name.'));
			if (opts.mode === 'block') {
				const section = existingBlock || uci.add('firewall', 'rule', blockSection);
				uci.set('firewall', section, 'name', 'Freenetic — Block Internet from ' + (this.network[network] && (this.network[network].label || networkLabel(network)) || network));
				uci.set('firewall', section, 'src', opts.zone);
				uci.set('firewall', section, 'dest', opts.wanZone);
				uci.set('firewall', section, 'target', 'REJECT');
				uci.set('firewall', section, 'enabled', '1');
				uci.set('firewall', section, 'freenetic_managed', '1');
				uci.set('firewall', section, 'freenetic_scope', 'network');
				uci.set('firewall', section, 'freenetic_network', network);
			}
			else if (existingBlock && existingBlock.freenetic_managed === '1') {
				uci.remove('firewall', blockSection);
			}
			if (opts.pbrAvailable)
				this.syncDeviceFirewallExceptions(network, opts.zone, opts.wanZone);

			if (opts.pbrAvailable) {
				const configName = this.pbrSection && sectionName(this.pbrSection) || 'config';
				const managed = uci.sections('pbr', 'policy').some(section => section.freenetic_managed === '1' && section.enabled !== '0');
				const anyEnabled = uci.sections('pbr', 'policy').some(section => section.enabled !== '0');
				if (managed) {
					uci.set('pbr', configName, 'enabled', '1');
					uci.set('pbr', configName, 'freenetic_managed', '1');
				}
				else if (uci.get('pbr', configName, 'freenetic_managed') === '1' && !anyEnabled) {
					uci.set('pbr', configName, 'enabled', '0');
					uci.unset('pbr', configName, 'freenetic_managed');
				}
				else if (!managed && uci.get('pbr', configName, 'freenetic_managed') === '1') {
					/* A user policy is still active. Keep pbr running but drop our
					 * ownership marker so a later Freenetic change cannot disable it. */
					uci.unset('pbr', configName, 'freenetic_managed');
				}
				this.reorderManagedPbrPolicies();
			}

			return uci.save();
		}).then(() => applyChanges()).then(() => opts.pbrAvailable ? this.restartPbr() : { ok: true }).then(result => {
			if (result && result.ok === false)
				notify(_('Traffic policy saved, but policy routing could not be reloaded: %s').format(result.error), 'warning');
			else
				notify(_('Traffic policy saved for %s.').format(networkLabel(network)), 'info');
			return this.refreshPolicies();
		}).catch(err => {
			notify(_('Failed to save traffic policy: %s').format(err.message || err), 'danger');
		}).then(() => { saveButton.disabled = false; });
	},

	saveDevicePolicy(mac, opts, saveButton) {
		if (opts.mode === 'vpn' && (!opts.pbrAvailable || !opts.vpnInterface)) {
			notify(_('Install Policy-based routing and configure a VPN connection first.'), 'warning');
			return Promise.resolve();
		}
		if (opts.mode === 'block' && (!opts.network || !opts.zone || !opts.wanZone)) {
			notify(_('A detected network segment with firewall zones is required for Block Internet.'), 'warning');
			return Promise.resolve();
		}

		saveButton.disabled = true;
		const configs = [ 'network', 'firewall' ];
		if (opts.pbrAvailable)
			configs.push('pbr');
		const client = this.clientByMac[mac] || {};
		const label = client.label && client.label !== client.ipaddr ? client.label : mac;

		return uci.load(configs).then(() => {
			const pbrSectionName = managedDeviceSection(mac);
			if (opts.pbrAvailable) {
				const existing = uci.get('pbr', pbrSectionName);
				if (existing && !isManagedSection(existing, 'device'))
					throw new Error(_('A non-Freenetic pbr policy already uses this device name.'));
				if (opts.mode === 'direct' || opts.mode === 'vpn') {
					const section = existing || uci.add('pbr', 'policy', pbrSectionName);
					uci.set('pbr', section, 'name', 'Freenetic — ' + label);
					uci.set('pbr', section, 'interface', opts.mode === 'vpn' ? opts.vpnInterface : 'wan');
					uci.set('pbr', section, 'src_addr', mac.toLowerCase());
					uci.set('pbr', section, 'enabled', '1');
					uci.set('pbr', section, 'freenetic_managed', '1');
					uci.set('pbr', section, 'freenetic_scope', 'device');
					uci.set('pbr', section, 'freenetic_mac', mac);
					if (opts.network) uci.set('pbr', section, 'freenetic_network', opts.network);
					else uci.unset('pbr', section, 'freenetic_network');
				}
				else if (existing && isManagedSection(existing, 'device')) {
					uci.remove('pbr', pbrSectionName);
				}
			}

			const blockSectionName = managedDeviceBlockSection(mac);
			const existingBlock = uci.get('firewall', blockSectionName);
			if (existingBlock && !isManagedSection(existingBlock, 'device'))
				throw new Error(_('A non-Freenetic firewall rule already uses this device name.'));
			if (opts.mode === 'block') {
				const section = existingBlock || uci.add('firewall', 'rule', blockSectionName);
				uci.set('firewall', section, 'name', 'Freenetic — Block Internet from ' + label);
				uci.set('firewall', section, 'src', opts.zone);
				uci.set('firewall', section, 'dest', opts.wanZone);
				uci.set('firewall', section, 'src_mac', [ mac.toLowerCase() ]);
				uci.set('firewall', section, 'target', 'REJECT');
				uci.set('firewall', section, 'enabled', '1');
				uci.set('firewall', section, 'freenetic_managed', '1');
				uci.set('firewall', section, 'freenetic_scope', 'device');
				uci.set('firewall', section, 'freenetic_mac', mac);
				uci.set('firewall', section, 'freenetic_network', opts.network);
			}
			else if (existingBlock && isManagedSection(existingBlock, 'device')) {
				uci.remove('firewall', blockSectionName);
			}

			/* A segment-level block rule is intentionally broad.  Add a managed
			 * allow exception ahead of it when a device explicitly chooses WAN or
			 * VPN, so the per-device rule has the same override semantics as pbr. */
			const allowSectionName = managedDeviceAllowSection(mac);
			const existingAllow = uci.get('firewall', allowSectionName);
			if (existingAllow && !isManagedSection(existingAllow, 'device-allow'))
				throw new Error(_('A non-Freenetic firewall rule already uses this device exception name.'));
			const segmentBlock = opts.network && uci.get('firewall', managedBlockSection(opts.network));
			if ((opts.mode === 'direct' || opts.mode === 'vpn') && isManagedSection(segmentBlock) && opts.zone && opts.wanZone) {
				const section = existingAllow || uci.add('firewall', 'rule', allowSectionName);
				uci.set('firewall', section, 'name', 'Freenetic — Allow device override for ' + label);
				uci.set('firewall', section, 'src', opts.zone);
				uci.set('firewall', section, 'dest', opts.wanZone);
				uci.set('firewall', section, 'src_mac', [ mac.toLowerCase() ]);
				uci.set('firewall', section, 'target', 'ACCEPT');
				uci.set('firewall', section, 'enabled', '1');
				uci.set('firewall', section, 'freenetic_managed', '1');
				uci.set('firewall', section, 'freenetic_scope', 'device-allow');
				uci.set('firewall', section, 'freenetic_mac', mac);
				uci.set('firewall', section, 'freenetic_network', opts.network);
				uci.move('firewall', section, managedBlockSection(opts.network), false);
			}
			else if (existingAllow && isManagedSection(existingAllow, 'device-allow')) {
				uci.remove('firewall', allowSectionName);
			}

			if (opts.pbrAvailable) {
				const configName = this.pbrSection && sectionName(this.pbrSection) || 'config';
				const managed = uci.sections('pbr', 'policy').some(section => section.freenetic_managed === '1' && section.enabled !== '0');
				const anyEnabled = uci.sections('pbr', 'policy').some(section => section.enabled !== '0');
				if (managed) {
					uci.set('pbr', configName, 'enabled', '1');
					uci.set('pbr', configName, 'freenetic_managed', '1');
				}
				else if (uci.get('pbr', configName, 'freenetic_managed') === '1' && !anyEnabled) {
					uci.set('pbr', configName, 'enabled', '0');
					uci.unset('pbr', configName, 'freenetic_managed');
				}
				else if (!managed && uci.get('pbr', configName, 'freenetic_managed') === '1') {
					uci.unset('pbr', configName, 'freenetic_managed');
				}
				this.reorderManagedPbrPolicies();
			}

			return uci.save();
		}).then(() => applyChanges()).then(() => opts.pbrAvailable ? this.restartPbr() : { ok: true }).then(result => {
			if (result && result.ok === false)
				notify(_('Device policy saved, but policy routing could not be reloaded: %s').format(result.error), 'warning');
			else
				notify(_('Device policy saved for %s.').format(label || mac), 'info');
			return this.refreshPolicies();
		}).catch(err => {
			notify(_('Failed to save device policy: %s').format(err.message || err), 'danger');
		}).then(() => { saveButton.disabled = false; });
	},

	fillCards() {
		dom_empty(this.cardsNode);

		const radios = {};
		Object.keys(this.wireless).forEach(key => {
			const section = this.wireless[key];
			if (section['.type'] === 'wifi-device')
				radios[section['.name']] = section;
		});

		const ifaces = Object.keys(this.wireless).map(key => this.wireless[key]).filter(section =>
			section['.type'] === 'wifi-iface' && (section.mode || 'ap') === 'ap');
		ifaces.sort((a, b) => networkOrder(ifaceNetwork(a)) - networkOrder(ifaceNetwork(b)) ||
			ifaceNetwork(a).localeCompare(ifaceNetwork(b)) ||
			(a.ssid || a['.name']).localeCompare(b.ssid || b['.name']));

		if (!ifaces.length) {
			this.cardsNode.appendChild(E('div', { class: 'fn-oc-empty fn-wifi-acl-empty' }, [
				E('strong', {}, _('No wireless networks configured')),
				E('span', {}, _('Create an access point on the Home Network or Guest Network page first.'))
			]));
			return;
		}

		const compactScreen = window.matchMedia && window.matchMedia('(max-width: 640px)').matches;
		ifaces.forEach((iface, index) => this.cardsNode.appendChild(this.renderCard(iface, radios[iface.device], index === 0 && !compactScreen)));
	},

	renderCard(iface, radio, openByDefault) {
		const section = iface['.name'];
		const mode = aclMode(iface);
		const entries = readMacList(iface.maclist).map(mac => ({
			mac,
			label: this.clientByMac[mac] ? this.clientByMac[mac].label : ''
		}));

		const statusPill = E('span', { class: 'fn-status-pill ' + modeStatusClass(mode) }, modeLabel(mode));
		const modeSelect = E('select', { class: 'fn-input' }, [
			E('option', { value: 'disabled' }, _('Disabled')),
			E('option', { value: 'allow' }, _('Allow list')),
			E('option', { value: 'deny' }, _('Deny list'))
		]);
		modeSelect.value = mode;

		const hint = E('div', { class: 'fn-wifi-acl-hint' });
		const list = E('div', { class: 'fn-apps-list fn-wifi-acl-list' });
		const manualInput = E('input', {
			type: 'text', class: 'fn-input',
			placeholder: 'AA:BB:CC:DD:EE:FF',
			'aria-label': _('MAC address')
		});
		const clientSelect = E('select', { class: 'fn-input', 'aria-label': _('Client List') }, [
			E('option', { value: '' }, this.clients.length ? _('Select a client') : _('No clients found'))
		]);
		this.clients.forEach(client => clientSelect.appendChild(E('option', { value: client.mac },
			(client.label ? client.label + ' — ' : '') + client.mac)));

		const updateModeUi = () => {
			const value = modeSelect.value;
			statusPill.className = 'fn-status-pill ' + modeStatusClass(value);
			dom_empty(statusPill);
			statusPill.appendChild(document.createTextNode(modeLabel(value)));
			if (value === 'allow')
				hint.textContent = _('Only listed MAC addresses may connect to this SSID.');
			else if (value === 'deny')
				hint.textContent = _('Listed MAC addresses will be refused; all other devices may connect.');
			else
				hint.textContent = _('No MAC filtering is applied.');
		};

		const renderEntries = () => {
			dom_empty(list);
			if (!entries.length) {
				list.appendChild(E('div', { class: 'fn-oc-empty fn-oc-empty-small fn-wifi-acl-empty-list' },
					modeSelect.value === 'allow' ? _('No devices allowed yet.') : _('No MAC addresses listed.')));
				return;
			}

			entries.forEach((entry, index) => {
				const info = E('div', { class: 'fn-apps-info' }, [
					E('div', { class: 'fn-apps-name' }, entry.mac),
					entry.label ? E('div', { class: 'fn-apps-desc' }, entry.label) : null
				].filter(Boolean));
				list.appendChild(E('div', { class: 'fn-apps-row fn-wifi-acl-row' }, [
					E('span', { class: 'fn-wifi-acl-mac-icon', 'aria-hidden': 'true' }, '⌁'),
					info,
					E('button', {
						type: 'button', class: 'fn-settings-btn fn-settings-btn-danger',
						click: () => { entries.splice(index, 1); renderEntries(); }
					}, _('Remove'))
				]));
			});
		};

		const addMac = (value, label) => {
			const mac = normalizeMac(value);
			if (!mac) {
				notify(_('Enter a valid MAC address, for example AA:BB:CC:DD:EE:FF.'), 'warning');
				return false;
			}
			if (entries.some(entry => entry.mac === mac)) {
				notify(_('This MAC address is already listed.'), 'warning');
				return false;
			}
			entries.push({ mac, label: label || (this.clientByMac[mac] && this.clientByMac[mac].label) || '' });
			renderEntries();
			return true;
		};

		const addManualButton = E('button', { type: 'button', class: 'fn-settings-btn fn-wifi-acl-add-button' }, _('Add'));
		addManualButton.addEventListener('click', () => {
			if (addMac(manualInput.value, ''))
				manualInput.value = '';
		});
		manualInput.addEventListener('keydown', ev => {
			if (ev.key === 'Enter') {
				ev.preventDefault();
				addManualButton.click();
			}
		});

		const addClientButton = E('button', { type: 'button', class: 'fn-settings-btn fn-wifi-acl-add-button' }, _('Add client'));
		addClientButton.disabled = !this.clients.length;
		addClientButton.addEventListener('click', () => {
			const selected = this.clientByMac[clientSelect.value];
			if (selected && addMac(selected.mac, selected.label))
				clientSelect.value = '';
		});

		const saveButton = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary fn-wifi-acl-save' }, _('Save'));
		saveButton.addEventListener('click', () => this.saveAcl(section, iface.ssid || section, modeSelect.value,
			entries.map(entry => entry.mac), saveButton));

		modeSelect.addEventListener('change', () => { updateModeUi(); renderEntries(); });
		updateModeUi();
		renderEntries();

		const network = ifaceNetwork(iface);
		const disabled = iface.disabled === '1';
		const subtitle = [ networkLabel(network), bandLabel(radio), disabled ? _('Network disabled') : '' ].filter(Boolean).join(' · ');
		const expandLabel = E('span', { class: 'fn-wifi-acl-expand-label' }, openByDefault ? _('Hide settings') : _('Configure'));
		const body = E('div', { class: 'fn-card-body fn-wifi-acl-body' }, [
			E('div', { class: 'fn-wifi-acl-body-grid' }, [
				E('div', { class: 'fn-wifi-acl-settings' }, [
					E('div', { class: 'fn-settings-field fn-wifi-acl-mode-field' }, [ E('label', {}, _('Access control')), modeSelect ]),
					hint
				]),
				E('div', { class: 'fn-wifi-acl-editor' }, [
					E('h4', { class: 'fn-oc-subtitle fn-wifi-acl-subtitle' }, _('MAC addresses')),
					list,
					E('div', { class: 'fn-wifi-acl-add-grid' }, [
						E('div', { class: 'fn-wifi-acl-add-control' }, [ manualInput, addManualButton ]),
						E('div', { class: 'fn-wifi-acl-add-control' }, [ clientSelect, addClientButton ])
					]),
					E('div', { class: 'fn-oc-actions fn-wifi-acl-actions' }, [ saveButton ])
				])
			])
		]);
		body.classList.toggle('fn-wifi-acl-body-collapsed', !openByDefault);
		body.setAttribute('aria-hidden', openByDefault ? 'false' : 'true');
		const expandButton = E('button', {
			type: 'button', class: 'fn-wifi-acl-expand',
			'aria-expanded': openByDefault ? 'true' : 'false',
			'aria-label': openByDefault ? _('Hide settings') : _('Configure')
		}, [ expandLabel, E('span', { class: 'fn-wifi-acl-expand-icon', 'aria-hidden': 'true' }, '⌄') ]);
		expandButton.addEventListener('click', () => {
			const open = body.classList.contains('fn-wifi-acl-body-collapsed');
			body.classList.toggle('fn-wifi-acl-body-collapsed', !open);
			body.setAttribute('aria-hidden', open ? 'false' : 'true');
			expandButton.setAttribute('aria-expanded', open ? 'true' : 'false');
			expandButton.setAttribute('aria-label', open ? _('Hide settings') : _('Configure'));
			dom_empty(expandLabel);
			expandLabel.appendChild(document.createTextNode(open ? _('Hide settings') : _('Configure')));
	});

		return E('article', { class: 'fn-card fn-oc-card fn-wifi-acl-card' }, [
			E('div', { class: 'fn-card-head fn-oc-card-head fn-wifi-acl-card-head' }, [
				E('div', { class: 'fn-oc-card-title' }, [
					E('h3', {}, iface.ssid || _('Unnamed network')),
					E('span', { class: 'fn-oc-protocol' }, subtitle)
				]),
				statusPill,
				expandButton
			]),
			body
		]);
	},

	saveAcl(section, ssid, mode, macs, saveButton) {
		if (mode === 'allow' && !macs.length) {
			notify(_('An allow list must contain at least one MAC address.'), 'warning');
			return Promise.resolve();
		}

		saveButton.disabled = true;
		return uci.load('wireless').then(() => {
			if (mode === 'allow' || mode === 'deny')
				uci.set('wireless', section, 'macfilter', mode);
			else
				uci.unset('wireless', section, 'macfilter');

			if (macs.length)
				uci.set('wireless', section, 'maclist', macs);
			else
				uci.unset('wireless', section, 'maclist');

			return uci.save();
		}).then(() => applyChanges()).then(() => {
			notify(_('Wi-Fi access rules saved for %s.').format(ssid || section), 'info');
		}).catch(err => {
			notify(_('Failed to save Wi-Fi access rules: %s').format(err.message || err), 'danger');
		}).then(() => { saveButton.disabled = false; });
	},

	addFooter() { return E([]); }
});
