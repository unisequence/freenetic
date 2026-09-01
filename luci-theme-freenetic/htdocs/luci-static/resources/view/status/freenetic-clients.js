'use strict';
'require view';
'require poll';
'require ui';
'require uci';

/* Same raw-fetch approach as the dashboard view for reads, and the same
   reasoning: headless/backgrounded tabs never fire requestAnimationFrame,
   which the 'rpc'/'network' modules wait on. Writes (register/block below)
   use the real 'uci' module instead, same as the dashboard's guest-network
   provisioning — that's a real (non-headless) browser interaction, and the
   session-staged apply() is what correctly cascades a dnsmasq/firewall
   reload after the change. */
let ubusReqId = 1;
function ubusCall(object, method, params) {
	return fetch(L.url('admin/ubus'), {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		credentials: 'include',
		body: JSON.stringify({
			jsonrpc: '2.0',
			id: ubusReqId++,
			method: 'call',
			params: [ L.env.sessionid, object, method, params || {} ]
		})
	}).then(r => r.json()).then(msg => {
		if (!msg || !Array.isArray(msg.result))
			throw new Error('Malformed ubus reply');
		const [rc, data] = msg.result;
		if (rc !== 0)
			throw new Error('ubus error (object=%s method=%s, code %d)'.format(object, method, rc));
		return data || {};
	});
}

function dom_empty(node) { while (node.firstChild) node.removeChild(node.firstChild); }

/* Auto-dismissing toast (same mechanic as luci-theme-onyx's notify()): not
   using ui.addTimeLimitedNotification() since its fade-out removes the
   element via setTimeout(0), before the CSS transition can actually paint. */
const FADE_MS = 400;
function notify(message, type) {
	const timeout = (type === 'warning' || type === 'danger') ? 6000 : 4000;
	const msg = ui.addNotification(null, E('p', {}, message), type);

	setTimeout(() => {
		msg.classList.add('fade-out');
		msg.classList.remove('fade-in');
		setTimeout(() => {
			if (msg.parentNode)
				msg.parentNode.removeChild(msg);
		}, FADE_MS);
	}, timeout);

	return msg;
}

/* uci.apply() commits fine but doesn't clear the header's "Unsaved Changes"
   indicator on its own — that's only refreshed by ui.js's own changes flow,
   which stock views trigger via a full page reload. Re-run it explicitly. */
/* uci.apply() fails with ubus code 5 (NO_DATA) when uci.save() found nothing
   actually changed — there's simply nothing staged to apply, not a failure. */
function applyChanges() {
	return uci.apply().catch(err => {
		if (err && /code 5/.test(err.message))
			return;
		throw err;
	}).then(() => ui.changes.init());
}

function getDhcpLeases() {
	return ubusCall('luci-rpc', 'getDHCPLeases').then(r => r.dhcp_leases || []).catch(() => []);
}

function getArpTable() {
	return ubusCall('file', 'read', { path: '/proc/net/arp' }).then(r => {
		const map = {};
		(r.data || '').split('\n').slice(1).forEach(line => {
			const cols = line.trim().split(/\s+/);
			if (cols.length >= 4 && cols[3] !== '00:00:00:00:00:00')
				map[cols[0]] = cols[3];
		});
		return map;
	}).catch(() => ({}));
}

function getDhcpHosts() {
	return ubusCall('uci', 'get', { config: 'dhcp' }).then(r => {
		const values = r.values || {};
		return Object.keys(values)
			.map(k => values[k])
			.filter(s => s['.type'] === 'host' && s.mac);
	}).catch(() => []);
}

function getFirewallBlocks() {
	return ubusCall('uci', 'get', { config: 'firewall' }).then(r => {
		const values = r.values || {};
		return Object.keys(values)
			.map(k => values[k])
			.filter(s => s['.type'] === 'rule' && s.src_mac && (s.name || '').indexOf('freenetic_block_') === 0);
	}).catch(() => []);
}

function getInterfaceInfo(name) {
	return ubusCall('network.interface', 'status', { interface: name }).then(r => {
		const addr = (r['ipv4-address'] || [])[0];
		return addr ? { address: addr.address, mask: addr.mask } : null;
	}).catch(() => null);
}

function ip2int(ip) {
	const p = ip.split('.').map(Number);
	return p.length === 4 ? ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0 : null;
}

function ipInLan(ip, lan) {
	if (!ip || !lan || !lan.address || ip.indexOf(':') !== -1)
		return false;
	const a = ip2int(ip), b = ip2int(lan.address);
	if (a == null || b == null)
		return false;
	const bits = lan.mask || 24;
	const shift = bits >= 32 ? 0 : 32 - bits;
	return (a >>> shift) === (b >>> shift);
}

function getWirelessStatus() {
	return ubusCall('network.wireless', 'status').catch(() => ({}));
}

/* Cross-references every configured AP interface's live station list
   (iwinfo assoclist, which has signal strength) against its uci network/
   band, keyed by MAC so client rows can say "5 GHz Wi-Fi, Guest, -52 dBm"
   instead of just "Wired". */
function getWifiStations(wstatus) {
	const map = {};
	const jobs = [];

	Object.keys(wstatus).forEach(radioName => {
		const radio = wstatus[radioName];
		(radio.interfaces || []).forEach(iface => {
			if (!iface.ifname)
				return;
			const network = (iface.config && iface.config.network && iface.config.network[0]) || 'lan';
			const band = radio.config && radio.config.band;

			jobs.push(ubusCall('iwinfo', 'assoclist', { device: iface.ifname }).then(res => {
				(res.results || []).forEach(st => {
					if (st.mac)
						map[st.mac.toUpperCase()] = { band, network, signal: st.signal };
				});
			}).catch(() => {}));
		});
	});

	return Promise.all(jobs).then(() => map);
}

/* Bit 1 of the first octet marks a locally-administered (i.e. randomized,
   not the manufacturer's burned-in) address — the standard "private MAC"
   signal modern phones/laptops use, same thing Keenetic flags as "(частный)". */
function isPrivateMac(mac) {
	const first = parseInt(mac.split(':')[0], 16);
	return !isNaN(first) && (first & 0x02) !== 0;
}

function macKey(mac) { return (mac || '').toUpperCase(); }

return view.extend({
	load() {
		return getWirelessStatus().then(wstatus =>
			Promise.all([
				getDhcpLeases(),
				getArpTable(),
				getWifiStations(wstatus),
				getInterfaceInfo('guest'),
				getDhcpHosts(),
				getFirewallBlocks()
			]));
	},

	render(data) {
		this.leases = data[0];
		this.arp = data[1];
		this.stations = data[2];
		this.guestInfo = data[3];
		this.hosts = data[4];
		this.blocks = data[5];

		this.unregTable = E('div', { class: 'fn-table' });
		this.regTable = E('div', { class: 'fn-table' });
		this.blockedTable = E('div', { class: 'fn-table' });
		this.fillTables();

		poll.add(L.bind(this.refresh, this), 5);

		return E('div', { class: 'fn-dash' }, [
			E('div', { class: 'fn-card', style: 'grid-column: 1 / -1' }, [
				E('div', { class: 'fn-card-head' }, [ E('h3', {}, _('Client List')) ]),
				E('div', { class: 'fn-card-body' }, [
					E('p', { class: 'fn-info-empty' }, _('Devices seen on the network but without a saved reservation show up as unregistered. Registering a client keeps its name and address even while it\'s offline.')),

					E('div', { class: 'fn-client-section' }, [
						E('h4', { class: 'fn-clients-subhead' }, _('Unregistered clients')),
						this.unregTable
					]),
					E('div', { class: 'fn-client-section fn-client-section-registered' }, [
						E('h4', { class: 'fn-clients-subhead' }, _('Registered clients')),
						this.regTable
					]),
					E('div', { class: 'fn-client-section fn-client-section-blocked' }, [
						E('h4', { class: 'fn-clients-subhead' }, _('Blocked clients')),
						this.blockedTable
					])
				])
			])
		]);
	},

	refresh() {
		return getWirelessStatus().then(L.bind(function(wstatus) {
			return Promise.all([
				getDhcpLeases(), getArpTable(), getWifiStations(wstatus), getDhcpHosts(), getFirewallBlocks()
			]).then(L.bind(function(res) {
				this.leases = res[0];
				this.arp = res[1];
				this.stations = res[2];
				this.hosts = res[3];
				this.blocks = res[4];
				this.fillTables();
			}, this));
		}, this)).catch(() => {});
	},

	/* Merges every live sighting (DHCP lease, ARP entry, Wi-Fi station) into
	   one record per MAC — this is the same "who's actually on the network
	   right now" logic as the dashboard's Traffic Monitor / Client List v1. */
	buildLiveDevices() {
		const devices = {};

		this.leases.forEach(l => {
			const mac = macKey(l.macaddr);
			if (!mac)
				return;
			devices[mac] = { mac, ip: l.ipaddr, hostname: l.hostname || '' };
		});

		Object.keys(this.arp).forEach(ip => {
			const mac = macKey(this.arp[ip]);
			if (!devices[mac])
				devices[mac] = { mac, ip, hostname: '' };
			else if (!devices[mac].ip)
				devices[mac].ip = ip;
		});

		return devices;
	},

	describeConnection(mac, live) {
		if (!live)
			return { segment: _('Not in network'), connection: '–' };

		const wifi = this.stations[mac];
		const isGuest = wifi ? wifi.network === 'guest' : ipInLan(live.ip, this.guestInfo);
		const segment = isGuest ? _('Guest network') : _('Home network');
		const connection = wifi
			? (wifi.band === '5g' ? '5 GHz' : '2.4 GHz') + ' Wi-Fi' + (typeof wifi.signal === 'number' ? ' · ' + wifi.signal + ' dBm' : '')
			: _('Wired');

		return { segment, connection };
	},

	fillTables() {
		const live = this.buildLiveDevices();
		const hostsByMac = {};
		this.hosts.forEach(h => { hostsByMac[macKey(h.mac)] = h; });
		const blocksByMac = {};
		this.blocks.forEach(b => { blocksByMac[macKey(b.src_mac)] = b; });

		const unregistered = Object.keys(live)
			.filter(mac => !hostsByMac[mac])
			.map(mac => ({ mac, name: live[mac].hostname || mac, live: live[mac] }));

		const registered = this.hosts.map(h => {
			const mac = macKey(h.mac);
			return { mac, name: h.name || mac, live: live[mac], sectionName: h['.name'] };
		});

		unregistered.sort((a, b) => a.name.localeCompare(b.name));
		registered.sort((a, b) => a.name.localeCompare(b.name));

		this.fillTable(this.unregTable, unregistered, {
			empty: _('No unregistered clients.'),
			rowAction: (row) => E('button', {
				type: 'button', class: 'fn-settings-btn',
				click: () => this.registerClient(row.mac, row.live ? row.live.hostname : '', row.live ? row.live.ip : '')
			}, _('Register')),
			blockedByMac: blocksByMac
		});

		this.fillTable(this.regTable, registered, {
			empty: _('No registered clients.'),
			rowAction: (row) => E('button', {
				type: 'button', class: 'fn-settings-btn',
				click: () => this.deleteHost(row.sectionName)
			}, _('Forget')),
			blockedByMac: blocksByMac
		});

		const blockedRows = this.blocks.map(b => ({
			mac: macKey(b.src_mac), name: hostsByMac[macKey(b.src_mac)] ? hostsByMac[macKey(b.src_mac)].name : b.src_mac,
			live: live[macKey(b.src_mac)], sectionName: b['.name']
		}));
		this.fillTable(this.blockedTable, blockedRows, {
			empty: _('No blocked clients.'),
			rowAction: (row) => E('button', {
				type: 'button', class: 'fn-settings-btn',
				click: () => this.unblockClient(row.sectionName)
			}, _('Unblock'))
		});
	},

	fillTable(table, rows, opts) {
		dom_empty(table);

		table.appendChild(E('div', { class: 'fn-table-row fn-table-head' }, [
			E('div', {}, _('Client')),
			E('div', {}, _('Address')),
			E('div', {}, _('Segment')),
			E('div', {}, _('Connection')),
			E('div', {}, '')
		]));

		if (!rows.length) {
			table.appendChild(E('div', { class: 'fn-info-empty' }, opts.empty));
			return;
		}

		rows.forEach(row => {
			const { segment, connection } = this.describeConnection(row.mac, row.live);
			const online = !!row.live;
			const ip = row.live ? row.live.ip : (row.ip || '–');
			const isBlocked = opts.blockedByMac && opts.blockedByMac[row.mac];

			const actions = E('div', { class: 'fn-table-actions' }, [ opts.rowAction(row) ]);
			if (opts.blockedByMac && !isBlocked) {
				actions.appendChild(E('button', {
					type: 'button', class: 'fn-settings-btn',
					click: () => this.blockClient(row.mac)
				}, _('Block')));
			}

			table.appendChild(E('div', { class: 'fn-table-row' }, [
				E('div', {}, [
					E('span', { class: 'fn-client-dot ' + (online ? 'fn-client-online' : 'fn-client-offline') }),
					row.name
				]),
				E('div', {}, [
					E('div', {}, ip || '–'),
					E('div', { class: 'fn-table-sub' }, row.mac + (isPrivateMac(row.mac) ? ' (' + _('private') + ')' : ''))
				]),
				E('div', {}, segment),
				E('div', {}, connection),
				actions
			]));
		});
	},

	registerClient(mac, name, ip) {
		return uci.load('dhcp').then(() => {
			const section = uci.add('dhcp', 'host');
			uci.set('dhcp', section, 'mac', mac);
			if (name) uci.set('dhcp', section, 'name', name);
			if (ip) uci.set('dhcp', section, 'ip', ip);
			return uci.save();
		}).then(() => applyChanges()).then(() => {
			notify(_('Client registered.'), 'info');
			return this.refresh();
		}).catch(err => {
			notify(_('Failed to register client: %s').format(err.message || err), 'danger');
		});
	},

	deleteHost(sectionName) {
		return uci.load('dhcp').then(() => {
			uci.remove('dhcp', sectionName);
			return uci.save();
		}).then(() => applyChanges()).then(() => {
			notify(_('Client forgotten.'), 'info');
			return this.refresh();
		}).catch(err => {
			notify(_('Failed to forget client: %s').format(err.message || err), 'danger');
		});
	},

	blockClient(mac) {
		return uci.load('firewall').then(() => {
			const section = uci.add('firewall', 'rule');
			uci.set('firewall', section, 'name', 'freenetic_block_' + mac.replace(/:/g, ''));
			uci.set('firewall', section, 'src', 'lan');
			uci.set('firewall', section, 'dest', 'wan');
			uci.set('firewall', section, 'src_mac', mac);
			uci.set('firewall', section, 'target', 'REJECT');
			return uci.save();
		}).then(() => applyChanges()).then(() => {
			notify(_('Client blocked.'), 'info');
			return this.refresh();
		}).catch(err => {
			notify(_('Failed to block client: %s').format(err.message || err), 'danger');
		});
	},

	unblockClient(sectionName) {
		return uci.load('firewall').then(() => {
			uci.remove('firewall', sectionName);
			return uci.save();
		}).then(() => applyChanges()).then(() => {
			notify(_('Client unblocked.'), 'info');
			return this.refresh();
		}).catch(err => {
			notify(_('Failed to unblock client: %s').format(err.message || err), 'danger');
		});
	},

	addFooter() { return E([]); }
});
