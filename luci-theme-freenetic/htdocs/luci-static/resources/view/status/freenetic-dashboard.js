'use strict';
'require view';
'require poll';
'require ui';
'require uci';
'require fs';
'require freenetic-qrcode as qrcode';

/*
 * Most of this view talks to ubus through a hand-rolled fetch() (see
 * ubusCall below) rather than rpc.declare()/the 'network' module: on this
 * build, headless/backgrounded tabs never fire requestAnimationFrame, which
 * is what Request.request() in luci.js waits on to flush its ubus batch —
 * so rpc-based calls can hang forever in that specific situation. A raw
 * fetch() to the same /cgi-bin/luci/admin/ubus endpoint sidesteps it.
 *
 * The guest-network provisioning flow below is the exception: it's a
 * multi-section uci add/set/save/apply sequence, which the 'uci' module's
 * session-staged apply() already does correctly (cascading reloads to
 * network/wireless/dhcp/firewall). settings-freenetic.js already uses the
 * same 'uci' module successfully in this real (non-headless) browser
 * context, so there's no hang risk here — just reuse it instead of
 * hand-rolling multi-step raw ubus add/set/commit calls.
 */
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

const HISTORY_LEN = 40;
const POLL_INTERVAL = 3; /* seconds */

function svgIcon(d, size) {
	size = size || 18;
	const span = E('span', { class: 'fn-icon' });
	span.innerHTML = '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">' +
		'<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2" ' +
		'stroke-linecap="round" stroke-linejoin="round"/></svg>';
	return span;
}

function qrGlyph(size) {
	size = size || 16;
	const span = E('span', { class: 'fn-icon' });
	span.innerHTML = '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">' +
		'<rect x="3" y="3" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
		'<rect x="14" y="3" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
		'<rect x="3" y="14" width="7" height="7" fill="none" stroke="currentColor" stroke-width="1.8"/>' +
		'<rect x="14" y="14" width="3" height="3" fill="currentColor"/>' +
		'<rect x="18" y="14" width="3" height="3" fill="currentColor"/>' +
		'<rect x="14" y="18" width="3" height="3" fill="currentColor"/>' +
		'<rect x="18" y="18" width="3" height="3" fill="currentColor"/>' +
		'</svg>';
	return span;
}

/* Escapes ;,":\ per the WIFI: QR payload spec (each must be backslash-escaped). */
function wifiQrPayload(ssid, key, isOpen) {
	const esc = s => String(s).replace(/([\\;,":])/g, '\\$1');
	return 'WIFI:T:' + (isOpen ? 'nopass' : 'WPA') + ';S:' + esc(ssid) + ';' +
		(isOpen ? '' : 'P:' + esc(key || '') + ';') + ';';
}

function fmtBps(bytesPerSec) {
	const bits = (bytesPerSec || 0) * 8;
	if (bits >= 1000000)
		return (bits / 1000000).toFixed(1) + ' Mbit/s';
	if (bits >= 1000)
		return (bits / 1000).toFixed(0) + ' kbit/s';
	return bits.toFixed(0) + ' bit/s';
}

function fmtBytes(bytes) {
	bytes = bytes || 0;
	if (bytes >= 1e9)
		return (bytes / 1e9).toFixed(2) + ' GB';
	if (bytes >= 1e6)
		return (bytes / 1e6).toFixed(1) + ' MB';
	if (bytes >= 1e3)
		return (bytes / 1e3).toFixed(0) + ' KB';
	return bytes + ' B';
}

function fmtUptime(seconds) {
	seconds = seconds || 0;
	const d = Math.floor(seconds / 86400);
	const h = Math.floor((seconds % 86400) / 3600);
	const m = Math.floor((seconds % 3600) / 60);
	const s = Math.floor(seconds % 60);
	if (d > 0)
		return '%d d %02d:%02d:%02d'.format(d, h, m, s);
	return '%02d:%02d:%02d'.format(h, m, s);
}

function dom_empty(node) { while (node.firstChild) node.removeChild(node.firstChild); }
function dom_content(node, text) { dom_empty(node); node.appendChild(document.createTextNode(text)); }

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

/* Self-contained rx/tx sparkline, driven by our own polling below —
 * no luci-bwc/rrd dependency, starts empty and fills in over ~2 minutes. */
function renderSparkline() {
	const wrap = E('div', { class: 'fn-spark' });
	wrap.innerHTML =
		'<svg viewBox="0 0 400 100" preserveAspectRatio="none" class="fn-spark-svg">' +
		'<polygon class="fn-spark-area" points=""/>' +
		'<polyline class="fn-spark-line-rx" points=""/>' +
		'<polyline class="fn-spark-line-tx" points=""/>' +
		'</svg>';
	return wrap;
}

function updateSparkline(el, rxSamples, txSamples) {
	const svg = el.querySelector('svg');
	const max = Math.max(1, ...rxSamples, ...txSamples);
	const n = HISTORY_LEN;
	const toPoints = (samples) => {
		const pts = [];
		for (let i = 0; i < n; i++) {
			const v = samples[i] != null ? samples[i] : 0;
			const x = (i / (n - 1)) * 400;
			const y = 100 - (v / max) * 96;
			pts.push(x.toFixed(1) + ',' + y.toFixed(1));
		}
		return pts.join(' ');
	};

	const rxLine = toPoints(rxSamples);
	const txLine = toPoints(txSamples);
	const area = rxLine + ' 400,100 0,100';

	svg.querySelector('.fn-spark-area').setAttribute('points', area);
	svg.querySelector('.fn-spark-line-rx').setAttribute('points', rxLine);
	svg.querySelector('.fn-spark-line-tx').setAttribute('points', txLine);
}

function getFirewallConfig() {
	return ubusCall('uci', 'get', { config: 'firewall' }).then(r => r.values || {}).catch(() => ({}));
}

function getInterfaceDump() {
	return ubusCall('network.interface', 'dump').then(r => r.interface || []).catch(() => []);
}

/* "WAN" here means any interface routed through a masquerading (NAT) firewall
   zone — that's the actual OpenWrt signal for "this uplinks to the internet",
   as opposed to hardcoding the interface name 'wan'. Interfaces sharing one
   physical device (e.g. 'wan' + 'wan6' on the same Ethernet link) are merged
   into a single connection; genuinely different devices (a second uplink —
   4G modem, PPPoE over a VLAN, a WISP repeater) become separate connections,
   matching how Keenetic lists distinct connections rather than protocols. */
function getWanConnections() {
	return Promise.all([ getFirewallConfig(), getInterfaceDump() ]).then(([firewall, dump]) => {
		const wanNames = [];
		Object.keys(firewall).forEach(k => {
			const z = firewall[k];
			if (z['.type'] !== 'zone' || z.masq !== '1')
				return;
			const net = z.network;
			(Array.isArray(net) ? net : net ? [net] : []).forEach(n => {
				if (wanNames.indexOf(n) === -1)
					wanNames.push(n);
			});
		});

		const entries = dump.filter(e => wanNames.indexOf(e.interface) !== -1);
		const groups = [];
		entries.forEach(e => {
			const dev = e.l3_device || e.device || e.interface;
			let g = groups.find(g => g.device === dev);
			if (!g) {
				g = { device: dev, name: e.interface, ifaces: [] };
				groups.push(g);
			}
			g.ifaces.push(e);
		});
		return groups;
	});
}

/* Merges the v4/v6 sibling interfaces of one connection group into a single
   display record — same shape fillWanInfo() already expects. */
function mergeWanGroup(group) {
	const ifaces = group.ifaces;
	const up = ifaces.some(e => e.up);
	const uptime = Math.max(0, ...ifaces.map(e => e.uptime || 0));
	const proto = (ifaces.find(e => e.up) || ifaces[0]).proto;
	const v4addrs = [].concat(...ifaces.map(e => e['ipv4-address'] || []));
	const v6addrs = [].concat(...ifaces.map(e => e['ipv6-address'] || []));
	const dns = [].concat(...ifaces.map(e => e['dns-server'] || []));
	const routes = [].concat(...ifaces.map(e => e.route || []));

	return {
		name: group.name,
		device: group.device,
		up,
		uptime,
		proto,
		'ipv4-address': v4addrs,
		'ipv6-address': v6addrs,
		'dns-server': dns,
		route: routes,
		l3_device: group.device
	};
}

function connectionLabel(wan) {
	switch (wan.proto) {
	case 'pppoe': return _('PPPoE connection');
	case 'pppoa': return _('PPPoA connection');
	case 'dhcpv6': return _('IPv6 connection');
	case 'dhcp':
	case 'static': return _('Ethernet connection');
	default: return wan.name ? wan.name.toUpperCase() : _('Connection');
	}
}

function getWirelessConfig() {
	return ubusCall('uci', 'get', { config: 'wireless' }).then(r => r.values || {});
}

function getPorts() {
	return ubusCall('luci', 'getBuiltinEthernetPorts').then(r => r.result || []).catch(() => []);
}

function getWifiRadios(wireless) {
	const radios = Object.keys(wireless)
		.map(k => wireless[k])
		.filter(s => s['.type'] === 'wifi-device');

	return Promise.all([
		ubusCall('iwinfo', 'devices').then(r => r.devices || []).catch(() => []),
		Promise.all(radios.map(r =>
			ubusCall('iwinfo', 'phyname', { section: r['.name'] }).then(p => p.phyname).catch(() => null)))
	]).then(([activeDevices, phynames]) => radios.map((r, i) => {
		const phy = phynames[i];
		const dev = phy ? activeDevices.find(d => d.indexOf(phy + '-') === 0) : null;
		return { name: r['.name'], band: r.band, disabled: r.disabled === '1', device: dev || null };
	}));
}

function mhzToChannel(mhz, band) {
	return band === '5g' ? Math.round((mhz - 5000) / 5) : Math.round((mhz - 2407) / 5);
}

function getLanInfo() {
	return ubusCall('network.interface', 'status', { interface: 'lan' }).then(r => {
		const addr = (r['ipv4-address'] || [])[0];
		return addr ? { address: addr.address, mask: addr.mask } : null;
	}).catch(() => null);
}

function getConntrack() {
	return ubusCall('luci', 'getConntrackList').then(r => r.result || []).catch(() => []);
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

function getSystemBoard() {
	return ubusCall('system', 'board').catch(() => ({}));
}

function getSystemInfo() {
	return ubusCall('system', 'info').catch(() => ({}));
}

/* Overall CPU usage %, computed from consecutive /proc/stat samples (same
   delta-over-time idea as the WAN rx/tx counters above). The aggregate
   "cpu" line sums jiffies across all cores, so idle/total ratio already
   gives a whole-device busy percentage without needing the core count. */
function getProcStatCpu() {
	return ubusCall('file', 'read', { path: '/proc/stat' }).then(r => {
		const line = (r.data || '').split('\n')[0] || '';
		const nums = line.trim().split(/\s+/).slice(1).map(Number);
		const idle = (nums[3] || 0) + (nums[4] || 0);
		const total = nums.reduce((a, b) => a + b, 0);
		return { idle, total };
	}).catch(() => null);
}

function getConntrackCounts() {
	return Promise.all([
		ubusCall('file', 'read', { path: '/proc/sys/net/netfilter/nf_conntrack_count' }).then(r => parseInt(r.data, 10)).catch(() => null),
		ubusCall('file', 'read', { path: '/proc/sys/net/netfilter/nf_conntrack_max' }).then(r => parseInt(r.data, 10)).catch(() => null)
	]).then(([count, max]) => ({ count, max }));
}

/* attendedsysupgrade's uci section is named 'client' (see luci-app-
   attendedsysupgrade); auto_search is its "check for updates" toggle. */
function getSysupgradeConfig() {
	return ubusCall('uci', 'get', { config: 'attendedsysupgrade' }).then(r => (r.values || {}).client || null).catch(() => null);
}

function fmtMB(bytes) {
	return Math.round((bytes || 0) / 1e6) + ' MB';
}

/* Fixed dd.mm.yyyy HH:MM:SS regardless of browser locale. ubus system info's
   "localtime" is the router's wall-clock time expressed as a raw epoch
   (already local, not a true UTC instant), so read it back with the UTC
   getters to avoid a second, unwanted timezone shift from the browser. */
function fmtDateTime(epochSeconds) {
	const d = new Date((epochSeconds || 0) * 1000);
	const p = n => String(n).padStart(2, '0');
	return p(d.getUTCDate()) + '.' + p(d.getUTCMonth() + 1) + '.' + d.getUTCFullYear() + ' ' +
		p(d.getUTCHours()) + ':' + p(d.getUTCMinutes()) + ':' + p(d.getUTCSeconds());
}

const TRAFFIC_COLORS = [ 'fn-tc-0', 'fn-tc-1', 'fn-tc-2', 'fn-tc-3', 'fn-tc-4', 'fn-tc-other' ];

function getWirelessStatus() {
	return ubusCall('network.wireless', 'status').catch(() => ({}));
}

function getIwinfoInfos(wstatus) {
	const names = [];
	Object.keys(wstatus).forEach(r => (wstatus[r].interfaces || []).forEach(i => {
		if (i.ifname && names.indexOf(i.ifname) === -1)
			names.push(i.ifname);
	}));
	return Promise.all(names.map(name =>
		ubusCall('iwinfo', 'info', { device: name }).then(info => [ name, info ]).catch(() => [ name, null ])
	)).then(pairs => {
		const map = {};
		pairs.forEach(p => { map[p[0]] = p[1]; });
		return map;
	});
}

function findIfaceEntry(wstatus, sectionName) {
	for (const r in wstatus)
		for (const i of (wstatus[r].interfaces || []))
			if (i.section === sectionName)
				return i;
	return null;
}

function stationCountFor(wstatus, sectionName) {
	const entry = findIfaceEntry(wstatus, sectionName);
	return entry ? (entry.stations || []).length : 0;
}

function getNetworkConfig() {
	return ubusCall('uci', 'get', { config: 'network' }).then(r => r.values || {}).catch(() => ({}));
}

function getDhcpConfig() {
	return ubusCall('uci', 'get', { config: 'dhcp' }).then(r => r.values || {}).catch(() => ({}));
}

function getDhcpLeases() {
	return ubusCall('luci-rpc', 'getDHCPLeases').then(r => r.dhcp_leases || []).catch(() => []);
}

function getInterfaceInfo(name) {
	return ubusCall('network.interface', 'status', { interface: name }).then(r => {
		const addr = (r['ipv4-address'] || [])[0];
		return {
			up: !!r.up,
			address: addr ? addr.address : null,
			mask: addr ? addr.mask : null,
			ipv6: (r['ipv6-address'] || []).map(a => a.address)
		};
	}).catch(() => null);
}

function formatWifiMeta(iface, radio, info) {
	const band = radio.band === '5g' ? '5 GHz' : '2.4 GHz';
	const parts = [ band ];
	if (radio.channel)
		parts.push(_('Channel: %s').format(radio.channel));
	if (info && info.htmode)
		parts.push(info.htmode);
	if (info && info.hwmodes_text)
		parts.push('802.11' + info.hwmodes_text);
	if (info && typeof info.txpower === 'number')
		parts.push(info.txpower + ' dBm');
	parts.push(iface.encryption && iface.encryption !== 'none' ? iface.encryption.toUpperCase() : _('Open'));
	return parts.join(', ');
}

return view.extend({
	load() {
		return getWirelessConfig().then(wireless =>
			getWirelessStatus().then(wstatus =>
				Promise.all([
					getWanConnections(),
					wireless,
					getPorts(),
					getWifiRadios(wireless),
					getInterfaceInfo('lan'),
					wstatus,
					getIwinfoInfos(wstatus),
					getNetworkConfig(),
					getDhcpConfig(),
					getDhcpLeases(),
					getInterfaceInfo('guest'),
					getSystemBoard(),
					getSysupgradeConfig()
				])));
	},

	render(data) {
		const connections = data[0];
		const wireless = data[1];
		const ports = data[2];
		const radios = data[3];
		const lan = data[4];
		const wstatus = data[5];
		const ifaceInfos = data[6];
		const netConfig = data[7];
		const dhcpConfig = data[8];
		const leases = data[9];
		const guestInfo = data[10];
		const board = data[11];
		const sysupgradeCfg = data[12];

		this.lanInfo = lan;
		this.trafficHistory = {};
		this.wstatus = wstatus;
		this.ifaceInfos = ifaceInfos;

		const container = E('div', { class: 'fn-dash' }, [
			E('div', { class: 'fn-dash-col' }, [
				this.renderInternetCard(connections),
				this.renderTrafficCard(lan),
				this.renderSystemCard(board, sysupgradeCfg)
			]),
			E('div', { class: 'fn-dash-col' }, [
				this.renderNetworksCard(wireless, ports, netConfig, dhcpConfig, leases, guestInfo),
				this.renderPortsCard(ports),
				this.renderWifiMonitorCard(radios)
			])
		]);

		poll.add(L.bind(this.pollWan, this), POLL_INTERVAL);
		if (ports.length)
			poll.add(L.bind(this.pollPorts, this, ports), POLL_INTERVAL);
		if (radios.length) {
			this.pollSurvey();
			poll.add(L.bind(this.pollSurvey, this), 5);
		}
		if (lan) {
			this.pollTraffic();
			poll.add(L.bind(this.pollTraffic, this), POLL_INTERVAL);
		}
		this.pollSystem();
		poll.add(L.bind(this.pollSystem, this), POLL_INTERVAL);

		return container;
	},

	renderInternetCard(groups) {
		this.connections = [];

		const blocks = groups.length
			? groups.map((group, i) => this.renderConnectionBlock(group, i))
			: [ E('div', { class: 'fn-info-empty' }, _('No WAN interface configured.')) ];

		return E('div', { class: 'fn-card' }, [
			E('div', { class: 'fn-card-head' }, [
				svgIcon('M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2ZM2 12h20M12 2c2.5 2.7 4 6.2 4 10s-1.5 7.3-4 10c-2.5-2.7-4-6.2-4-10s1.5-7.3 4-10Z', 20),
				E('h3', {}, _('Internet'))
			]),
			E('div', { class: 'fn-card-body fn-conn-list' }, blocks)
		]);
	},

	renderConnectionBlock(group, index) {
		const wan = mergeWanGroup(group);
		const spark = renderSparkline();
		const rxLabel = E('span', {}, '–');
		const txLabel = E('span', {}, '–');
		const infoGrid = E('div', { class: 'fn-info-grid' });
		const statusPill = E('span', { class: 'fn-status-pill' });

		const conn = {
			device: group.device, spark, rxLabel, txLabel, infoGrid, statusPill,
			rxHistory: [], txHistory: [], lastSample: null,
			macEl: null, rxTotalEl: null, txTotalEl: null
		};
		this.connections.push(conn);
		this.fillConnectionInfo(conn, wan);

		return E('div', { class: 'fn-conn-block' + (index === 0 ? '' : ' fn-conn-block-secondary') }, [
			E('div', { class: 'fn-conn-head' }, [
				E('h4', { class: 'fn-conn-title' }, connectionLabel(wan)),
				statusPill
			]),
			spark,
			E('div', { class: 'fn-spark-legend' }, [
				E('span', { class: 'fn-legend-dot fn-legend-rx' }), _('Download: '), rxLabel,
				E('span', { class: 'fn-legend-dot fn-legend-tx' }), _('Upload: '), txLabel
			]),
			infoGrid
		]);
	},

	fillConnectionInfo(conn, wan) {
		conn.statusPill.className = 'fn-status-pill ' + (wan.up ? 'fn-status-ok' : 'fn-status-off');
		dom_content(conn.statusPill, wan.up ? _('Connected') : _('Not connected'));

		const addrs = (wan['ipv4-address'] || []).map(a => a.address + '/' + a.mask)
			.concat((wan['ipv6-address'] || []).map(a => a.address + '/' + a.mask));
		const dns = wan['dns-server'] || [];
		const gw = (wan.route || []).find(r => r.target == '0.0.0.0' && r.mask == 0);

		const values = {
			proto: wan.proto || '–',
			addr: addrs.length ? addrs.join(', ') : '–',
			gw: gw ? gw.nexthop : '–',
			dns: dns.length ? dns.join(', ') : '–',
			connected: wan.uptime > 0 ? fmtUptime(wan.uptime) : '–',
			device: wan.l3_device || wan.device || '–'
		};

		/* Build the grid once, then just update each value cell's text on
		   every poll — rebuilding the whole grid (dom_empty + re-append) each
		   tick made every value flash blank/reappear instead of updating in
		   place, MAC/Received/Sent included since they were recreated too. */
		if (!conn.infoBuilt) {
			const grid = conn.infoGrid;
			const makeItem = label => {
				const valueEl = E('div', { class: 'fn-info-value' }, '–');
				grid.appendChild(E('div', { class: 'fn-info-item' }, [
					E('div', { class: 'fn-info-label' }, label),
					valueEl
				]));
				return valueEl;
			};

			conn.protoEl = makeItem(_('Protocol'));
			conn.addrEl = makeItem(_('Address'));
			conn.gwEl = makeItem(_('Gateway'));
			conn.dnsEl = makeItem(_('DNS'));
			conn.connectedEl = makeItem(_('Connected'));
			conn.deviceEl = makeItem(_('Device'));
			/* filled in once network.device status resolves, in pollWan() below */
			conn.macEl = makeItem(_('MAC address'));
			conn.rxTotalEl = makeItem(_('Received'));
			conn.txTotalEl = makeItem(_('Sent'));
			conn.infoBuilt = true;
		}

		dom_content(conn.protoEl, values.proto);
		dom_content(conn.addrEl, values.addr);
		dom_content(conn.gwEl, values.gw);
		dom_content(conn.dnsEl, values.dns);
		dom_content(conn.connectedEl, values.connected);
		dom_content(conn.deviceEl, values.device);
	},

	pollWan() {
		const now = Date.now();

		return getWanConnections().then(L.bind(function(groups) {
			return Promise.all(groups.map(L.bind(function(group) {
				const conn = this.connections.find(c => c.device === group.device);
				if (!conn)
					return Promise.resolve();

				this.fillConnectionInfo(conn, mergeWanGroup(group));

				return ubusCall('network.device', 'status', { name: group.device }).then(L.bind(function(dev) {
					const stats = dev.statistics || {};
					let rxRate = 0, txRate = 0;

					if (conn.lastSample) {
						const dt = (now - conn.lastSample.time) / 1000;
						if (dt > 0) {
							rxRate = Math.max(0, (stats.rx_bytes - conn.lastSample.rx) / dt);
							txRate = Math.max(0, (stats.tx_bytes - conn.lastSample.tx) / dt);
						}
					}

					conn.lastSample = { time: now, rx: stats.rx_bytes, tx: stats.tx_bytes };

					conn.rxHistory.push(rxRate);
					conn.txHistory.push(txRate);
					if (conn.rxHistory.length > HISTORY_LEN) conn.rxHistory.shift();
					if (conn.txHistory.length > HISTORY_LEN) conn.txHistory.shift();

					updateSparkline(conn.spark, conn.rxHistory, conn.txHistory);
					dom_content(conn.rxLabel, fmtBps(rxRate));
					dom_content(conn.txLabel, fmtBps(txRate));

					if (conn.macEl) dom_content(conn.macEl, dev.macaddr ? dev.macaddr.toUpperCase() : '–');
					if (conn.rxTotalEl) dom_content(conn.rxTotalEl, fmtBytes(stats.rx_bytes));
					if (conn.txTotalEl) dom_content(conn.txTotalEl, fmtBytes(stats.tx_bytes));
				}, this)).catch(() => {});
			}, this)));
		}, this)).catch(() => {});
	},

	renderNetworksCard(wireless, ports, netConfig, dhcpConfig, leases, guestInfo) {
		const body = E('div', { class: 'fn-card-body fn-networks-body' });
		this.networksBody = body;
		this.buildNetworksBody(wireless, ports, netConfig, dhcpConfig, leases, guestInfo);

		return E('div', { class: 'fn-card' }, [
			E('div', { class: 'fn-card-head' }, [
				svgIcon('M12 20h.01M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 14 0', 20),
				E('h3', {}, _('My Networks & Wi-Fi'))
			]),
			body
		]);
	},

	buildNetworksBody(wireless, ports, netConfig, dhcpConfig, leases, guestInfo) {
		const body = this.networksBody;
		dom_empty(body);

		const homeIfaces = Object.keys(wireless).map(k => wireless[k])
			.filter(s => s['.type'] === 'wifi-iface' && (s.mode || 'ap') === 'ap' && (s.network || 'lan') !== 'guest');
		const guestIfaces = Object.keys(wireless).map(k => wireless[k])
			.filter(s => s['.type'] === 'wifi-iface' && (s.mode || 'ap') === 'ap' && s.network === 'guest');

		const radios = {};
		Object.keys(wireless).forEach(k => {
			const s = wireless[k];
			if (s['.type'] === 'wifi-device')
				radios[s['.name']] = s;
		});

		const portsLabel = ports.filter(p => p.role !== 'wan').map(p => p.device.replace(/^lan/, '')).join(', ');

		body.appendChild(this.renderNetSection({
			title: _('Home network'),
			expanded: true,
			ifaces: homeIfaces,
			radios: radios,
			ipInfo: this.lanInfo,
			dhcp: dhcpConfig.lan,
			leases: leases,
			portsLabel: portsLabel,
			showInfoGrid: true,
			editPath: [ 'admin', 'network', 'home_network' ]
		}));

		body.appendChild(this.renderNetSection({
			title: _('Guest network'),
			expanded: false,
			ifaces: guestIfaces,
			radios: radios,
			ipInfo: guestInfo,
			dhcp: dhcpConfig.guest,
			leases: leases,
			showInfoGrid: guestIfaces.length > 0,
			provisionForm: guestIfaces.length ? null : this.renderGuestForm(),
			editPath: [ 'admin', 'network', 'guest_network' ]
		}));
	},

	renderNetSection(opts) {
		const body = E('div', { class: 'fn-net-section-body' + (opts.expanded ? '' : ' fn-collapsed') });
		const chevron = E('span', { class: 'fn-net-chevron' + (opts.expanded ? ' fn-net-chevron-open' : '') });

		const head = E('div', {
			class: 'fn-net-section-head',
			click: () => {
				const open = !body.classList.toggle('fn-collapsed');
				chevron.classList.toggle('fn-net-chevron-open', open);
			}
		}, [
			E('span', { class: 'fn-net-section-title' }, opts.title),
			chevron
		]);

		if (opts.provisionForm) {
			body.appendChild(opts.provisionForm);
		} else {
			const leases = opts.leases;
			const wifiCount = opts.ifaces.reduce((sum, ifc) => sum + stationCountFor(this.wstatus, ifc['.name']), 0);

			let wiredCount = 0;
			if (opts.ipInfo && opts.ipInfo.address) {
				const wifiMacs = {};
				opts.ifaces.forEach(ifc => {
					const entry = findIfaceEntry(this.wstatus, ifc['.name']);
					(entry ? entry.stations : []).forEach(st => { if (st.mac) wifiMacs[st.mac.toUpperCase()] = true; });
				});
				wiredCount = leases.filter(l => ipInLan(l.ipaddr, opts.ipInfo) && !wifiMacs[(l.macaddr || '').toUpperCase()]).length;
			}

			body.appendChild(E('div', { class: 'fn-net-counts' }, [
				_('Wi-Fi') + ': ', E('b', {}, String(wifiCount)), ' ',
				_('Wired') + ': ', E('b', {}, String(wiredCount))
			]));

			if (opts.showInfoGrid) {
				const grid = E('div', { class: 'fn-info-list' });
				const rows = [];
				if (opts.portsLabel)
					rows.push([ _('Ports'), opts.portsLabel ]);
				if (opts.ipInfo && opts.ipInfo.address)
					rows.push([ _('IPv4 address'), opts.ipInfo.address + '/' + opts.ipInfo.mask ]);
				if (opts.dhcp)
					rows.push([ _('DHCP pool usage'), leases.filter(l => ipInLan(l.ipaddr, opts.ipInfo)).length + ' / ' + opts.dhcp.limit ]);
				if (opts.ipInfo && opts.ipInfo.ipv6 && opts.ipInfo.ipv6.length)
					rows.push([ _('IPv6 address'), opts.ipInfo.ipv6.join(', ') ]);

				rows.forEach(([label, value]) => grid.appendChild(E('div', { class: 'fn-info-row' }, [
					E('div', { class: 'fn-info-label' }, label),
					E('div', { class: 'fn-info-value' }, value)
				])));
				body.appendChild(grid);
			}

			const list = E('div', { class: 'fn-wifi-list' });
			if (!opts.ifaces.length) {
				list.appendChild(E('div', { class: 'fn-info-empty' }, _('No wireless networks configured.')));
			} else {
				opts.ifaces.forEach(iface => {
					const radio = opts.radios[iface.device] || {};
					const entry = findIfaceEntry(this.wstatus, iface['.name']);
					const info = entry && entry.ifname ? this.ifaceInfos[entry.ifname] : null;
					const disabled = iface.disabled === '1';
					const ssid = iface.ssid || _('(hidden)');

					const toggle = E('input', { type: 'checkbox', class: 'fn-switch-input' });
					toggle.checked = !disabled;
					toggle.addEventListener('change', () => this.toggleWifi(iface['.name'], toggle));

					const mainChildren = [
						E('div', { class: 'fn-wifi-ssid' }, ssid),
						E('div', { class: 'fn-wifi-meta' }, formatWifiMeta(iface, radio, info) + (disabled ? ' · ' + _('disabled') : ''))
					];
					if (info && info.bssid)
						mainChildren.push(E('div', { class: 'fn-wifi-meta' }, 'MAC: ' + info.bssid));

					const bandLabel = radio.band === '5g' ? '5 GHz' : '2.4 GHz';
					const qrBtn = E('button', {
						type: 'button', class: 'fn-icon-btn fn-wifi-qr', 'aria-label': _('Wi-Fi QR code'),
						click: () => this.showQrDialog(ssid, bandLabel, iface.key, iface.encryption)
					}, qrGlyph(16));

					list.appendChild(E('div', { class: 'fn-wifi-row' }, [
						E('label', { class: 'fn-switch' }, [ toggle, E('span', { class: 'fn-switch-slider' }) ]),
						E('div', { class: 'fn-wifi-main' }, mainChildren),
						qrBtn,
						E('a', { class: 'fn-wifi-edit', href: L.url.apply(L, opts.editPath || [ 'admin', 'network', 'wireless' ]) }, _('Edit'))
					]));
				});
			}
			body.appendChild(list);
		}

		return E('div', { class: 'fn-net-section' }, [ head, body ]);
	},

	renderGuestForm() {
		const ssidInput = E('input', { type: 'text', class: 'fn-input', placeholder: _('Guest network name') });
		const keyInput = E('input', { type: 'password', class: 'fn-input', placeholder: _('Password (min. 8 characters)') });
		const saveBtn = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary' }, _('Enable guest network'));

		saveBtn.addEventListener('click', () => this.saveGuestNetwork(ssidInput.value.trim(), keyInput.value, saveBtn));

		return E('div', { class: 'fn-guest-form' }, [
			E('p', { class: 'fn-info-empty' }, _('Guests get internet access but can\'t see your other devices.')),
			E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Name (SSID)')), ssidInput ]),
			E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Password')), keyInput ]),
			saveBtn
		]);
	},

	saveGuestNetwork(ssid, key, btn) {
		if (!ssid) {
			notify(_('Please enter a guest network name.'), 'warning');
			return;
		}
		if (!key || key.length < 8) {
			notify(_('Please enter a guest password of at least 8 characters.'), 'warning');
			return;
		}

		btn.disabled = true;

		return uci.load([ 'wireless', 'network', 'dhcp', 'firewall' ]).then(() => {
			const radios = uci.sections('wireless', 'wifi-device');

			radios.forEach(dev => {
				const name = 'guest_' + dev['.name'];
				if (uci.get('wireless', name, 'device') == null) {
					uci.add('wireless', 'wifi-iface', name);
					uci.set('wireless', name, 'device', dev['.name']);
					uci.set('wireless', name, 'mode', 'ap');
					uci.set('wireless', name, 'network', 'guest');
					uci.set('wireless', name, 'isolate', '1');
				}
				uci.set('wireless', name, 'disabled', '0');
				uci.set('wireless', name, 'ssid', ssid);
				uci.set('wireless', name, 'encryption', 'psk2');
				uci.set('wireless', name, 'key', key);
			});

			/* two radios both binding to network 'guest' need an explicit bridge —
			   netifd won't auto-combine multiple wifi-iface devices otherwise.
			   bridge_empty lets it come up with zero static ports; the guest
			   AP vifs attach to it dynamically once hostapd starts them.
			   uci 'device' sections are conventionally anonymous (identified by
			   their 'name' option, not a named uci section — same as the stock
			   br-lan) — uci.get('network','br-guest',...) never matches even
			   after creation, and re-requesting a *named* add for an
			   already-anonymous-only section type fails with EINVAL. Search by
			   the option value instead, and create anonymously. */
			if (!uci.sections('network', 'device').some(s => s.name === 'br-guest')) {
				const sid = uci.add('network', 'device');
				uci.set('network', sid, 'name', 'br-guest');
				uci.set('network', sid, 'type', 'bridge');
				uci.set('network', sid, 'bridge_empty', '1');
			}

			if (uci.get('network', 'guest', 'proto') == null) {
				uci.add('network', 'interface', 'guest');
				uci.set('network', 'guest', 'proto', 'static');
				uci.set('network', 'guest', 'device', 'br-guest');
				uci.set('network', 'guest', 'ipaddr', '192.168.3.1');
				uci.set('network', 'guest', 'netmask', '255.255.255.0');
			}

			if (uci.get('dhcp', 'guest', 'interface') == null) {
				uci.add('dhcp', 'dhcp', 'guest');
				uci.set('dhcp', 'guest', 'interface', 'guest');
				uci.set('dhcp', 'guest', 'start', '100');
				uci.set('dhcp', 'guest', 'limit', '150');
				uci.set('dhcp', 'guest', 'leasetime', '12h');
			}
			uci.set('dhcp', 'guest', 'dhcpv4', 'server');

			if (uci.get('firewall', 'guest', 'name') == null) {
				uci.add('firewall', 'zone', 'guest');
				uci.set('firewall', 'guest', 'name', 'guest');
				uci.set('firewall', 'guest', 'network', 'guest');
				uci.set('firewall', 'guest', 'output', 'ACCEPT');
				uci.set('firewall', 'guest', 'forward', 'REJECT');
			}
			/* input stays ACCEPT so the router can answer guest DHCP/DNS;
			   isolation comes from no guest->lan forwarding rule below. */
			uci.set('firewall', 'guest', 'input', 'ACCEPT');

			if (uci.get('firewall', 'guest_wan_fwd', 'src') == null) {
				uci.add('firewall', 'forwarding', 'guest_wan_fwd');
				uci.set('firewall', 'guest_wan_fwd', 'src', 'guest');
				uci.set('firewall', 'guest_wan_fwd', 'dest', 'wan');
			}

			return uci.save();
		}).then(() => applyChanges()).then(() => fs.exec('/sbin/ifup', [ 'guest' ])).then(() => {
			notify(_('Guest network enabled.'), 'info');
			return this.refreshNetworks();
		}).catch(err => {
			btn.disabled = false;
			notify(_('Failed to enable guest network: %s').format(err.message || err), 'danger');
		});
	},

	refreshNetworks() {
		return Promise.all([
			getWirelessConfig(),
			getPorts(),
			getNetworkConfig(),
			getDhcpConfig(),
			getDhcpLeases(),
			getInterfaceInfo('guest')
		]).then(([wireless, ports, netConfig, dhcpConfig, leases, guestInfo]) =>
			getWirelessStatus().then(wstatus =>
				getIwinfoInfos(wstatus).then(L.bind(function(ifaceInfos) {
					this.wstatus = wstatus;
					this.ifaceInfos = ifaceInfos;
					this.buildNetworksBody(wireless, ports, netConfig, dhcpConfig, leases, guestInfo);
				}, this))
			)
		);
	},

	toggleWifi(sectionName, toggleEl) {
		const disabled = toggleEl.checked ? '' : '1';
		return ubusCall('uci', 'set', { config: 'wireless', section: sectionName, values: { disabled } })
			.then(() => ubusCall('uci', 'commit', { config: 'wireless' }))
			.then(() => ubusCall('network', 'reload', {}))
			.catch(err => {
				toggleEl.checked = !toggleEl.checked;
				notify([ _('Failed to apply Wi-Fi change: %s').format(err.message) ], 'danger');
			});
	},

	showQrDialog(ssid, bandLabel, key, encryption) {
		const isOpen = !encryption || encryption === 'none';

		if (!this.qrOverlay) {
			this.qrOverlay = E('div', {
				class: 'fn-qr-overlay',
				click: (ev) => { if (ev.target === this.qrOverlay) this.hideQrDialog(); }
			});
			document.body.appendChild(this.qrOverlay);
			document.addEventListener('keydown', (ev) => {
				if (ev.key === 'Escape' && this.qrOverlay.classList.contains('fn-qr-open'))
					this.hideQrDialog();
			});
		}

		const canvas = E('canvas');
		const fields = [
			E('div', {}, [
				E('div', { class: 'fn-qr-field-label' }, _('Name (SSID)')),
				E('div', { class: 'fn-qr-field-value' }, ssid)
			])
		];
		if (!isOpen) {
			fields.push(E('div', {}, [
				E('div', { class: 'fn-qr-field-label' }, _('Password')),
				E('div', { class: 'fn-qr-field-value' }, [
					E('span', {}, key || ''),
					E('button', {
						type: 'button', class: 'fn-qr-copy', 'aria-label': _('Copy'),
						click: () => this.copyToClipboard(key)
					}, svgIcon('M8 8h11v11H8zM4 4h11v4M4 8v11h4', 16))
				])
			]));
		}

		dom_empty(this.qrOverlay);
		this.qrOverlay.appendChild(E('div', { class: 'fn-qr-box' }, [
			E('div', { class: 'fn-qr-head' }, [
				E('div', {}, [
					E('h3', { class: 'fn-qr-title' }, _('Wireless network information')),
					E('div', { class: 'fn-qr-subtitle' }, _('"%s" in the %s band').format(ssid, bandLabel))
				]),
				E('button', {
					type: 'button', class: 'fn-qr-close', 'aria-label': _('Close'),
					click: () => this.hideQrDialog()
				}, svgIcon('M6 6l12 12M18 6L6 18', 16))
			]),
			E('p', { class: 'fn-qr-desc' }, _('Scan this QR code with your phone\'s camera to connect to the wireless network.')),
			E('div', { class: 'fn-qr-body' }, [
				E('div', { class: 'fn-qr-canvas-wrap' }, [ canvas ]),
				E('div', { class: 'fn-qr-fields' }, fields)
			])
		]));

		qrcode.renderToCanvas(canvas, wifiQrPayload(ssid, key, isOpen), 4);

		requestAnimationFrame(() => this.qrOverlay.classList.add('fn-qr-open'));
	},

	hideQrDialog() {
		if (this.qrOverlay)
			this.qrOverlay.classList.remove('fn-qr-open');
	},

	copyToClipboard(text) {
		if (navigator.clipboard && navigator.clipboard.writeText)
			navigator.clipboard.writeText(text || '').then(() => {
				notify(_('Copied to clipboard.'), 'info');
			}).catch(() => {});
	},

	renderPortsCard(ports) {
		if (!ports.length)
			return E([]);

		this.portEls = {};

		const row = E('div', { class: 'fn-ports-row' });
		ports.forEach(port => {
			const isWan = port.role === 'wan';
			const label = isWan
				? svgIcon('M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2ZM2 12h20M12 2c2.5 2.7 4 6.2 4 10s-1.5 7.3-4 10c-2.5-2.7-4-6.2-4-10s1.5-7.3 4-10Z', 16)
				: E('span', {}, port.device.replace(/^lan/, ''));

			const dot = E('span', { class: 'fn-port-dot' });
			const speedLabel = E('div', { class: 'fn-port-speed' }, '–');

			const box = E('div', { class: 'fn-port' + (isWan ? ' fn-port-wan' : '') }, [
				E('div', { class: 'fn-port-icon' }, [ label, dot ]),
				speedLabel
			]);

			this.portEls[port.device] = { dot, speedLabel };
			row.appendChild(box);
		});

		return E('div', { class: 'fn-card' }, [
			E('div', { class: 'fn-card-head' }, [
				svgIcon('M4 9h16v10H4zM8 9V6a4 4 0 0 1 8 0v3', 20),
				E('h3', {}, _('Network Ports'))
			]),
			E('div', { class: 'fn-card-body' }, [ row ])
		]);
	},

	pollPorts(ports) {
		return Promise.all(ports.map(port =>
			ubusCall('network.device', 'status', { name: port.device }).catch(() => null)
		)).then(L.bind(function(statuses) {
			ports.forEach((port, i) => {
				const st = statuses[i];
				const els = this.portEls[port.device];
				if (!els)
					return;

				const active = !!(st && st.carrier);
				els.dot.classList.toggle('fn-port-dot-active', active);

				if (active && st.speed) {
					const m = /^(\d+)([HF])$/.exec(st.speed);
					dom_content(els.speedLabel, m ? '%s %s'.format(m[2] === 'F' ? 'FDX' : 'HDX', m[1] >= 1000 ? (m[1] / 1000) + 'G' : m[1] + 'M') : st.speed);
				} else {
					dom_content(els.speedLabel, '–');
				}
			});
		}, this));
	},

	renderWifiMonitorCard(radios) {
		if (!radios.length)
			return E([]);

		this.wifiRadios = radios;
		const chart = E('div', { class: 'fn-survey-chart' });
		this.surveyChart = chart;

		const tabs = E('div', { class: 'fn-survey-tabs' });
		radios.forEach((radio, i) => {
			const label = radio.band === '5g' ? '5 GHz' : '2.4 GHz';
			const btn = E('button', {
				type: 'button',
				class: 'fn-survey-tab' + (i === 0 ? ' fn-active' : ''),
				click: (ev) => {
					tabs.querySelectorAll('.fn-survey-tab').forEach(b => b.classList.remove('fn-active'));
					ev.target.classList.add('fn-active');
					this.activeRadio = radio;
					this.pollSurvey();
				}
			}, label);
			tabs.appendChild(btn);
		});

		this.activeRadio = radios[0];

		return E('div', { class: 'fn-card' }, [
			E('div', { class: 'fn-card-head' }, [
				svgIcon('M3 3v18h18M7 16v-4M11 16V8M15 16v-7M19 16v-2', 20),
				E('h3', {}, _('Wi-Fi Monitor'))
			]),
			E('div', { class: 'fn-card-body' }, [ tabs, chart ])
		]);
	},

	pollSurvey() {
		const radio = this.activeRadio;
		const chart = this.surveyChart;

		if (!radio || !radio.device) {
			dom_empty(chart);
			chart.appendChild(E('div', { class: 'fn-info-empty' },
				radio && radio.disabled ? _('This radio is disabled.') : _('No data yet.')));
			return Promise.resolve();
		}

		return ubusCall('iwinfo', 'survey', { device: radio.device }).then(L.bind(function(res) {
			if (this.activeRadio !== radio)
				return;

			dom_empty(chart);
			(res.results || []).forEach(entry => {
				const channel = mhzToChannel(entry.mhz, radio.band);
				if (channel < 1)
					return;
				const busy = entry.active_time > 0 ? (entry.busy_time / entry.active_time) * 100 : 0;
				const level = busy > 70 ? 'fn-survey-high' : busy > 30 ? 'fn-survey-mid' : 'fn-survey-low';

				chart.appendChild(E('div', { class: 'fn-survey-bar' }, [
					E('div', { class: 'fn-survey-bar-track' }, [
						E('div', { class: 'fn-survey-bar-fill ' + level, style: 'height:' + Math.max(2, busy) + '%' })
					]),
					E('div', { class: 'fn-survey-bar-label' }, String(channel))
				]));
			});
		}, this)).catch(() => {
			dom_empty(chart);
			chart.appendChild(E('div', { class: 'fn-info-empty' }, _('Failed to read channel survey.')));
		});
	},

	renderTrafficCard(lan) {
		if (!lan)
			return E([]);

		const donut = E('div', { class: 'fn-donut' });
		const legend = E('div', { class: 'fn-traffic-legend' });
		this.trafficDonut = donut;
		this.trafficLegend = legend;

		return E('div', { class: 'fn-card' }, [
			E('div', { class: 'fn-card-head' }, [
				svgIcon('M3 17l6-6 4 4 8-8M21 3v6h-6', 20),
				E('h3', {}, _('Traffic Monitor'))
			]),
			E('div', { class: 'fn-card-body fn-traffic-body' }, [
				E('div', { class: 'fn-donut-wrap' }, [ donut, E('div', { class: 'fn-donut-hole' }) ]),
				legend
			])
		]);
	},

	pollTraffic() {
		const lan = this.lanInfo;
		if (!lan)
			return Promise.resolve();

		return Promise.all([ getConntrack(), getArpTable() ]).then(L.bind(function(res) {
			const conns = res[0], arp = res[1];
			const now = Date.now();
			const totals = {};

			conns.forEach(c => {
				[ c.src, c.dst ].forEach(ip => {
					if (ip && ip !== lan.address && ipInLan(ip, lan))
						totals[ip] = (totals[ip] || 0) + (c.bytes || 0);
				});
			});

			const rates = {};
			let anyRate = false;
			Object.keys(totals).forEach(ip => {
				const prev = this.trafficHistory[ip];
				let rate = 0;
				if (prev && now > prev.ts) {
					const db = totals[ip] - prev.bytes;
					rate = db > 0 ? db / ((now - prev.ts) / 1000) : 0;
				}
				if (rate > 0)
					anyRate = true;
				rates[ip] = rate;
			});

			this.trafficHistory = {};
			Object.keys(totals).forEach(ip => { this.trafficHistory[ip] = { bytes: totals[ip], ts: now }; });

			this.renderTrafficChart(anyRate ? rates : totals, arp, anyRate);
		}, this)).catch(L.bind(function() {
			this.renderTrafficChart({}, {}, false);
		}, this));
	},

	renderTrafficChart(values, arp, isRate) {
		const donut = this.trafficDonut;
		const legend = this.trafficLegend;
		if (!donut || !legend)
			return;

		dom_empty(donut);
		dom_empty(legend);

		const entries = Object.keys(values)
			.map(ip => ({ ip: ip, value: values[ip] }))
			.filter(e => e.value > 0)
			.sort((a, b) => b.value - a.value);

		if (!entries.length) {
			donut.style.background = 'var(--fn-border)';
			legend.appendChild(E('div', { class: 'fn-info-empty' }, _('No active connections.')));
			return;
		}

		const top = entries.slice(0, 5);
		const restTotal = entries.slice(5).reduce((s, e) => s + e.value, 0);
		if (restTotal > 0)
			top.push({ ip: null, value: restTotal, other: true });

		const total = top.reduce((s, e) => s + e.value, 0) || 1;

		let acc = 0;
		const stops = top.map((e, i) => {
			const from = (acc / total) * 100;
			acc += e.value;
			const to = (acc / total) * 100;
			const cls = TRAFFIC_COLORS[e.other ? 5 : i];
			return 'var(--' + cls + ') ' + from.toFixed(2) + '% ' + to.toFixed(2) + '%';
		});
		donut.style.background = 'conic-gradient(' + stops.join(', ') + ')';

		top.forEach((e, i) => {
			const cls = TRAFFIC_COLORS[e.other ? 5 : i];
			const label = e.other ? _('Other devices') : (e.ip + (arp[e.ip] ? ' (' + arp[e.ip].toUpperCase() + ')' : ''));
			legend.appendChild(E('div', { class: 'fn-traffic-row' }, [
				E('span', { class: 'fn-traffic-dot', style: 'background:var(--' + cls + ')' }),
				E('span', { class: 'fn-traffic-label' }, label),
				E('span', { class: 'fn-traffic-value' }, isRate ? fmtBps(e.value) : (Math.round(e.value / 1024) + ' KB'))
			]));
		});
	},

	renderSystemCard(board, sysupgradeCfg) {
		const release = board.release || {};

		const cpuFill = E('div', { class: 'fn-meter-fill' });
		const cpuValue = E('div', { class: 'fn-meter-value' }, '–');
		const ramFill = E('div', { class: 'fn-meter-fill' });
		const ramValue = E('div', { class: 'fn-meter-value' }, '–');
		const uptimeValue = E('div', { class: 'fn-info-value' }, '–');
		const timeValue = E('div', { class: 'fn-info-value' }, '–');
		const connValue = E('div', { class: 'fn-info-value' }, '–');
		this.sysEls = { cpuFill, cpuValue, ramFill, ramValue, uptimeValue, timeValue, connValue };

		const row = (label, valueEl) => E('div', { class: 'fn-info-row' }, [
			E('div', { class: 'fn-info-label' }, label),
			valueEl
		]);
		const meterRow = (label, fillEl, valueEl) => E('div', { class: 'fn-info-row' }, [
			E('div', { class: 'fn-info-label' }, label),
			E('div', { class: 'fn-meter-wrap' }, [ E('div', { class: 'fn-meter' }, [ fillEl ]), valueEl ])
		]);
		const groupTitle = text => E('div', { class: 'fn-info-group-title' }, text);

		/* No exact device profile id is available client-side (board.json's
		   comma-form id doesn't reliably match firmware-selector's dataset),
		   so link to the selector pre-filtered by branch/target only and let
		   the user pick their exact device from its dropdown. */
		const selectorUrl = 'https://firmware-selector.openwrt.org/?version=' +
			encodeURIComponent(release.version || 'SNAPSHOT') +
			'&target=' + encodeURIComponent(release.target || '');
		const channelLink = E('a', { href: selectorUrl, target: '_blank', rel: 'noopener' },
			(release.target || '–') + (release.version ? ' · ' + release.version : ''));

		const autoUpdateText = sysupgradeCfg
			? (sysupgradeCfg.auto_search === '1' ? _('Enabled') : _('Disabled'))
			: '–';

		const body = E('div', { class: 'fn-card-body fn-info-list' }, [
			groupTitle(_('System')),
			meterRow(_('CPU'), cpuFill, cpuValue),
			meterRow(_('RAM'), ramFill, ramValue),
			row(_('Uptime'), uptimeValue),
			row(_('Current time'), timeValue),
			row(_('Active connections'), connValue),

			groupTitle(_('System updates')),
			row(_('OS version'), E('div', { class: 'fn-info-value' }, release.description || '–')),
			row(_('Update channel'), E('div', { class: 'fn-info-value' }, [ channelLink ])),
			row(_('Auto-update'), E('div', { class: 'fn-info-value' }, autoUpdateText)),

			groupTitle(_('Device')),
			row(_('Model'), E('div', { class: 'fn-info-value' }, board.model || board.board_name || '–')),
			row(_('Kernel version'), E('div', { class: 'fn-info-value' }, board.kernel || '–'))
		]);

		return E('div', { class: 'fn-card' }, [
			E('div', { class: 'fn-card-head' }, [
				svgIcon('M9 3h6v4H9zM4 9h16v10H4zM9 21v-2h6v2', 20),
				E('h3', {}, _('About System'))
			]),
			body
		]);
	},

	pollSystem() {
		return Promise.all([ getSystemInfo(), getProcStatCpu(), getConntrackCounts() ]).then(L.bind(function(res) {
			const info = res[0], stat = res[1], conn = res[2];
			const els = this.sysEls;
			if (!els)
				return;

			if (stat) {
				if (this.cpuLastSample) {
					const dIdle = stat.idle - this.cpuLastSample.idle;
					const dTotal = stat.total - this.cpuLastSample.total;
					const pct = dTotal > 0 ? Math.max(0, Math.min(100, Math.round(100 * (1 - dIdle / dTotal)))) : 0;
					els.cpuFill.style.width = pct + '%';
					dom_content(els.cpuValue, pct + '%');
				}
				this.cpuLastSample = stat;
			}

			if (info.memory) {
				const total = info.memory.total || 1;
				const used = total - (info.memory.available || 0);
				const pct = Math.round((used / total) * 100);
				els.ramFill.style.width = pct + '%';
				dom_content(els.ramValue, pct + '% (' + fmtMB(used) + ' / ' + fmtMB(total) + ')');
			}

			if (info.uptime != null)
				dom_content(els.uptimeValue, fmtUptime(info.uptime));
			if (info.localtime != null)
				dom_content(els.timeValue, fmtDateTime(info.localtime));

			dom_content(els.connValue, (conn.count != null ? conn.count : '–') + ' / ' + (conn.max != null ? conn.max : '–'));
		}, this)).catch(() => {});
	},

	addFooter() { return E([]); }
});
