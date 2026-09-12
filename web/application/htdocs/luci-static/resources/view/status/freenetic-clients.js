'use strict';
'require view';
'require poll';
'require ui';
'require uci';
'require freenetic-rpc as rpc';
'require freenetic-ui as uiHelper';

/* Same raw-fetch approach as the dashboard view for reads, and the same
   reasoning: headless/backgrounded tabs never fire requestAnimationFrame,
   which the 'rpc'/'network' modules wait on. Writes (register/block below)
   use the real 'uci' module instead, same as the dashboard's guest-network
   provisioning — that's a real (non-headless) browser interaction, and the
   session-staged apply() is what correctly cascades a dnsmasq/firewall
   reload after the change. */
const ubusCall = rpc.call;

const dom_empty = uiHelper.empty;
const notify = uiHelper.notify;
const applyChanges = uiHelper.applyChanges;

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

function getActiveArpMacs() {
	return ubusCall('file', 'read', { path: '/proc/net/arp' }).then(result => {
		const active = {};
		(result.data || '').split('\n').slice(1).forEach(line => {
			const columns = line.trim().split(/\s+/);
			const mac = columns.length >= 4 ? macKey(columns[3]) : '';
			if (mac && (parseInt(columns[2], 16) & 0x2))
				active[mac] = true;
		});
		return active;
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

/* network.wireless status is not a reliable source of AP interfaces across
   supported OpenWrt versions: it may transiently fail or omit stations.
   Discover interfaces and their bands directly through iwinfo, then index
   every current association by MAC. */
function getWifiStations() {
	const map = {};

	return ubusCall('iwinfo', 'devices').then(result =>
		Promise.all((result.devices || []).map(device =>
			Promise.all([
				ubusCall('iwinfo', 'info', { device }).catch(() => ({})),
				ubusCall('iwinfo', 'assoclist', { device }).catch(() => ({ results: [] }))
			]).then(([info, associations]) => {
				const band = Number(info.frequency) >= 5000 ? '5g' : '2g';
				(associations.results || []).forEach(station => {
					const mac = macKey(station.mac);
					if (mac)
						map[mac] = { band, signal: station.signal };
				});
			})
		)).then(() => map)
	).catch(() => map);
}

/* Bit 1 of the first octet marks a locally-administered (i.e. randomized,
   not the manufacturer's burned-in) address — the standard "private MAC"
   signal modern phones/laptops use, same thing Keenetic flags as "(частный)". */
function isPrivateMac(mac) {
	if (typeof mac !== 'string' || !mac)
		return false;

	const first = parseInt(mac.split(':')[0], 16);
	return !isNaN(first) && (first & 0x02) !== 0;
}

/* A few LuCI/rpcd combinations return a MAC as a one-item list or wrap it in
   an object. Never call String.prototype methods on the raw ubus value: an
   unexpected shape must hide that record, not prevent the whole page from
   rendering. */
function macKey(mac) {
	if (Array.isArray(mac))
		mac = mac[0];
	if (mac && typeof mac === 'object')
		mac = mac.macaddr || mac.mac || mac.address;
	return typeof mac === 'string' ? mac.trim().toUpperCase() : '';
}

return view.extend({
	load() {
		return Promise.all([
			getDhcpLeases(),
			getArpTable(),
			getWifiStations(),
			getInterfaceInfo('guest'),
			getDhcpHosts(),
			getFirewallBlocks(),
			getActiveArpMacs()
		]);
	},

	render(data) {
		this.leases = data[0];
		this.arp = data[1];
		this.stations = data[2];
		this.guestInfo = data[3];
		this.hosts = data[4];
		this.blocks = data[5];
		this.activeArpMacs = data[6];

		this.unregTable = E('div', { class: 'fn-table fn-client-table' });
		this.regTable = E('div', { class: 'fn-table fn-client-table' });
		this.blockedTable = E('div', { class: 'fn-table fn-client-table' });
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
		return Promise.all([
			getDhcpLeases(), getArpTable(), getWifiStations(), getDhcpHosts(), getFirewallBlocks(), getActiveArpMacs()
		]).then(L.bind(function(res) {
			this.leases = res[0];
			this.arp = res[1];
			this.stations = res[2];
			this.hosts = res[3];
			this.blocks = res[4];
			this.activeArpMacs = res[5];
			this.fillTables();
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
			devices[mac] = { mac, ip: l.ipaddr, hostname: l.hostname || '', online: !!this.activeArpMacs[mac] };
		});

		Object.keys(this.arp).forEach(ip => {
			const mac = macKey(this.arp[ip]);
			if (!devices[mac])
				devices[mac] = { mac, ip, hostname: '', online: !!this.activeArpMacs[mac] };
			else if (!devices[mac].ip)
				devices[mac].ip = ip;
		});
		Object.keys(this.stations).forEach(mac => {
			if (devices[mac])
				devices[mac].online = true;
		});

		return devices;
	},

	describeConnection(mac, live) {
		if (!live)
			return { segment: _('Not in network'), connection: '–' };

		const wifi = this.stations[mac];
		const isGuest = ipInLan(live.ip, this.guestInfo);
		const segment = isGuest ? _('Guest network') : _('Home network');
		const connection = wifi
			? (wifi.band === '5g' ? '5 GHz' : '2.4 GHz') + ' Wi-Fi' + (typeof wifi.signal === 'number' ? ' · ' + wifi.signal + ' dBm' : '')
			: (live.online ? _('Wired') : _('Not connected'));

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
			const online = !!(row.live && row.live.online);
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
