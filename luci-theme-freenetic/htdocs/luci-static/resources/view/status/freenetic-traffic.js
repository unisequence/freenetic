'use strict';
'require view';
'require poll';

/* Same raw-fetch ubus approach as the rest of this theme's custom views —
   see freenetic-dashboard.js for why (headless-tab requestAnimationFrame
   hang). This page reuses the exact bandwidth-sparkline and per-client
   traffic-donut tools already built for the Dashboard's "Internet" and
   "Traffic Monitor" cards, just promoted to a dedicated full-width page
   instead of a small dashboard card — replaces stock LuCI's Realtime
   Graphs (admin/status/realtime) in the sidebar. */
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
function dom_content(node, text) { dom_empty(node); node.appendChild(document.createTextNode(text)); }

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

function svgIcon(d, size) {
	size = size || 18;
	const span = E('span', { class: 'fn-icon' });
	span.innerHTML = '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">' +
		'<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2" ' +
		'stroke-linecap="round" stroke-linejoin="round"/></svg>';
	return span;
}

function donutIcon(size) {
	size = size || 18;
	const span = E('span', { class: 'fn-icon' });
	span.innerHTML = '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">' +
		'<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/>' +
		'<circle cx="12" cy="12" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
	return span;
}

const HISTORY_LEN = 40;
const POLL_INTERVAL = 3; /* seconds */
const TRAFFIC_COLORS = [ 'fn-tc-0', 'fn-tc-1', 'fn-tc-2', 'fn-tc-3', 'fn-tc-4', 'fn-tc-other' ];

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

/* "WAN" = any interface routed through a masquerading (NAT) firewall zone —
   same detection as the Dashboard's Internet card, so a second uplink (VLAN
   PPPoE, WISP repeater, etc.) shows as its own bandwidth block. */
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

function mergeWanGroup(group) {
	const ifaces = group.ifaces;
	const up = ifaces.some(e => e.up);
	const proto = (ifaces.find(e => e.up) || ifaces[0]).proto;
	return { name: group.name, device: group.device, up, proto, l3_device: group.device };
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

return view.extend({
	load() {
		return Promise.all([ getWanConnections(), getLanInfo() ]);
	},

	render(data) {
		const connections = data[0];
		const lan = data[1];

		this.lanInfo = lan;
		this.trafficHistory = {};
		this.connections = [];

		const blocks = connections.length
			? connections.map((group, i) => this.renderConnectionBlock(group, i))
			: [ E('div', { class: 'fn-info-empty' }, _('No WAN interface configured.')) ];

		const container = E('div', { class: 'fn-dash' }, [
			E('div', { class: 'fn-card', style: 'grid-column: 1 / -1' }, [
				E('div', { class: 'fn-card-head' }, [
					svgIcon('M3 17l6-6 4 4 8-8M21 3v6h-6', 20),
					E('h3', {}, _('Bandwidth'))
				]),
				E('div', { class: 'fn-card-body fn-conn-list' }, blocks)
			]),
			this.renderTrafficCard(lan)
		]);

		poll.add(L.bind(this.pollWan, this), POLL_INTERVAL);
		if (lan) {
			this.pollTraffic();
			poll.add(L.bind(this.pollTraffic, this), POLL_INTERVAL);
		}

		return container;
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
		const grid = conn.infoGrid;
		dom_empty(grid);

		conn.statusPill.className = 'fn-status-pill ' + (wan.up ? 'fn-status-ok' : 'fn-status-off');
		dom_content(conn.statusPill, wan.up ? _('Connected') : _('Not connected'));

		conn.macEl = E('div', { class: 'fn-info-value' }, '–');
		conn.rxTotalEl = E('div', { class: 'fn-info-value' }, '–');
		conn.txTotalEl = E('div', { class: 'fn-info-value' }, '–');
		[ [_('MAC address'), conn.macEl], [_('Received'), conn.rxTotalEl], [_('Sent'), conn.txTotalEl] ]
			.forEach(([label, valueEl]) => grid.appendChild(E('div', { class: 'fn-info-item' }, [
				E('div', { class: 'fn-info-label' }, label),
				valueEl
			])));
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

	renderTrafficCard(lan) {
		if (!lan)
			return E([]);

		const donut = E('div', { class: 'fn-donut' });
		const legend = E('div', { class: 'fn-traffic-legend' });
		this.trafficDonut = donut;
		this.trafficLegend = legend;

		return E('div', { class: 'fn-card', style: 'grid-column: 1 / -1' }, [
			E('div', { class: 'fn-card-head' }, [
				donutIcon(20),
				E('h3', {}, _('Traffic by device'))
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

	addFooter() { return E([]); }
});
