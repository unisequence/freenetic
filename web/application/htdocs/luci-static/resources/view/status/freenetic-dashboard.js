'use strict';
'require view';
'require poll';
'require ui';
'require uci';
'require fs';
'require freenetic-qrcode as qrcode';
'require freenetic-network as networkHelper';
'require freenetic-rpc as rpc';
'require freenetic-ui as uiHelper';

/*
 * Most of this view talks to ubus through the shared raw-fetch helper rather
 * than rpc.declare()/the 'network' module: on this
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
const ubusCall = rpc.call;

const HISTORY_LEN = 40;
const POLL_INTERVAL = 3; /* seconds */
const MIN_CPU_SAMPLE_INTERVAL = 1000; /* milliseconds */
const FREENETIC_REPOSITORY = 'https://github.com/unisequence/freenetic';
const FREENETIC_RELEASES_API = 'https://api.github.com/repos/unisequence/freenetic/releases?per_page=30';
const FREENETIC_UPDATE_HELPER = '/usr/libexec/freenetic-self-update';
const FREENETIC_PACKAGE_NAMES = [ 'luci-theme-freenetic', 'luci-app-freenetic' ];
const FREENETIC_RELEASE_PACKAGES = [
	'luci-theme-freenetic',
	'luci-app-freenetic',
	'luci-i18n-theme-freenetic-ru',
	'luci-i18n-freenetic-ru'
];

function freeneticBuildVersion(value) {
	const match = String(value || '').replace(/~/g, '.').match(/^(\d+)\.(\d+)\.(\d+)/);
	return match ? match.slice(1).map(Number) : null;
}

function compareFreeneticBuilds(left, right) {
	for (let i = 0; i < 3; i++) {
		if (left[i] !== right[i])
			return left[i] > right[i] ? 1 : -1;
	}
	return 0;
}

/* A release is installable only when all four LuCI archives and the matching
 * fnc binary exist for this router. This keeps a partially uploaded GitHub
 * release from turning an application/theme pair into a mixed revision. */
function freeneticReleasePlan(release, updater, installedPackages) {
	const tag = release && release.tag_name;
	if (!/^v\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?$/.test(String(tag || '')))
		return { compatible: false, reason: 'tag' };
	if (!updater || updater.can_update !== true)
		return { compatible: false, reason: 'updater' };

	const packageManager = updater.package_manager;
	const assetSuffix = updater.asset_suffix;
	if ((packageManager !== 'apk' && packageManager !== 'opkg') ||
		(assetSuffix !== 'aarch64_cortex-a53' && assetSuffix !== 'mipsel_24kc'))
		return { compatible: false, reason: 'target' };

	const names = new Set((Array.isArray(release.assets) ? release.assets : [])
		.map(asset => asset && asset.name).filter(Boolean));
	const packageSuffix = packageManager === 'apk' ? '-' + assetSuffix + '.apk' : '-all.ipk';
	const appPrefix = 'luci-app-freenetic-';
	const appAsset = Array.from(names).find(name =>
		name.startsWith(appPrefix) && name.endsWith(packageSuffix));
	if (!appAsset)
		return { compatible: false, reason: 'assets' };

	const version = appAsset.slice(appPrefix.length, -packageSuffix.length);
	if (!/^[0-9][0-9A-Za-z._-]*$/.test(version))
		return { compatible: false, reason: 'assets' };

	const required = FREENETIC_RELEASE_PACKAGES.map(name => name + '-' + version + packageSuffix);
	required.push('fnc-' + version + '-' + assetSuffix);
	if (!required.every(name => names.has(name)))
		return { compatible: false, reason: 'assets', version, required };

	const releaseBuild = freeneticBuildVersion(version);
	const installedBuilds = (Array.isArray(installedPackages) ? installedPackages : [])
		.filter(pkg => pkg && FREENETIC_PACKAGE_NAMES.indexOf(pkg.name) !== -1)
		.map(pkg => freeneticBuildVersion(pkg.version)).filter(Boolean);
	let comparison = null;
	if (releaseBuild && installedBuilds.length) {
		const comparisons = installedBuilds.map(current => compareFreeneticBuilds(releaseBuild, current));
		comparison = comparisons.some(value => value > 0) ? 1 :
			(comparisons.every(value => value === 0) ? 0 : -1);
	}

	return { compatible: true, tag, version, comparison, required };
}

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

function dialogFocusable(root) {
	return Array.from(root.querySelectorAll('a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'))
		.filter(element => !element.disabled && !element.hidden && element.getAttribute('aria-hidden') !== 'true');
}

function trapDialogFocus(event, dialog) {
	if (event.key !== 'Tab' || !dialog)
		return;

	const focusable = dialogFocusable(dialog);
	if (!focusable.length) {
		event.preventDefault();
		dialog.focus();
		return;
	}

	const first = focusable[0];
	const last = focusable[focusable.length - 1];
	if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) {
		event.preventDefault();
		last.focus();
	}
	else if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) {
		event.preventDefault();
		first.focus();
	}
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

function upperString(value) {
	if (Array.isArray(value))
		value = value[0];
	return typeof value === 'string' ? value.trim().toUpperCase() : '';
}

const dom_empty = uiHelper.empty;
const dom_content = uiHelper.content;
const notify = uiHelper.notify;
const applyChanges = uiHelper.applyChanges;

/* Dashboard cards are summaries, not dead ends. Keep the action in the
 * header so live controls inside each card (Wi-Fi toggles, QR buttons and
 * update controls) retain their own click targets while the card still has a
 * clear path to its full settings view. The theme navigation layer upgrades
 * these same-origin links to in-place SPA transitions. */
function cardAction(path, title) {
	const label = _('Details');
	return E('a', {
		class: 'fn-card-link',
		href: L.url.apply(L, path),
		title: label + ': ' + title,
		'aria-label': label + ': ' + title
	}, [
		E('span', { class: 'fn-card-link-text' }, label),
		E('span', { class: 'fn-card-link-arrow', 'aria-hidden': 'true' }, '→')
	]);
}

function cardHead(iconPath, title, path) {
	const children = [ svgIcon(iconPath, 20), E('h3', {}, title) ];
	if (path)
		children.push(cardAction(path, title));
	return E('div', { class: 'fn-card-head' }, children);
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
	default: return upperString(wan.name) || _('Connection');
	}
}

function connectionInterfaceLabel(wan) {
	const name = wan.name || '';

	switch (name) {
	case 'wan': return _('Internet (WAN)');
	case 'wan6': return _('Internet (IPv6)');
	default: return name || wan.l3_device || wan.device || '–';
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

function getFreeneticInstalledPackages() {
	return fs.exec_direct('/usr/libexec/package-manager-call', [ 'list-installed' ], 'json')
		.then(list => (Array.isArray(list) ? list : []).filter(pkg =>
			pkg && FREENETIC_PACKAGE_NAMES.indexOf(pkg.name) !== -1))
		.catch(() => []);
}

function getFreeneticUpdaterStatus() {
	return fs.exec_direct(FREENETIC_UPDATE_HELPER, [ 'status' ], 'json')
		.then(result => result || { can_update: false })
		.catch(error => ({ can_update: false, error: error.message || String(error) }));
}

function getFreeneticUpdateState() {
	return Promise.all([
		uci.load('freenetic').catch(() => []),
		getFreeneticInstalledPackages(),
		getFreeneticUpdaterStatus()
	]).then(([, packages, updater]) => ({
		channel: uci.get('freenetic', 'updates', 'channel') || 'stable',
		packages,
		updater
	}));
}

function formatFreeneticVersion(packages) {
	const versions = packages
		.filter(pkg => pkg.version)
		.map(pkg => pkg.name.replace(/^luci-/, '') + ' ' + pkg.version);

	return versions.length ? versions.join(' · ') : _('Development build');
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
	const encryption = upperString(iface.encryption);
	parts.push(encryption && encryption !== 'NONE' ? encryption : _('Open'));
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
					getSysupgradeConfig(),
					getFreeneticUpdateState()
				])));
	},

	render(data) {
		window.__freeneticActiveView = this;

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
		const freeneticUpdateState = data[13];

		this.lanInfo = lan;
		this.trafficHistory = {};
		this.wstatus = wstatus;
		this.ifaceInfos = ifaceInfos;
		this.ports = ports;

		const container = E('div', { class: 'fn-dash' }, [
			E('div', { class: 'fn-dash-col' }, [
				this.renderInternetCard(connections),
				this.renderTrafficCard(lan),
				this.renderSystemCard(board, sysupgradeCfg, freeneticUpdateState)
			]),
			E('div', { class: 'fn-dash-col' }, [
				this.renderNetworksCard(wireless, ports, netConfig, dhcpConfig, leases, guestInfo),
				this.renderPortsCard(ports),
				this.renderWifiMonitorCard(radios)
			])
		]);

		/* The live counters now arrive through one authenticated SSE stream.
		 * Keep the old pollers as a delayed fallback for older router images or
		 * browsers without EventSource support. */
		this.streamReady = false;
		this.pollingFallbackStarted = false;
		this.fallbackPollers = [];
		const startPollingFallback = () => {
			if (this.streamReady || this.pollingFallbackStarted)
				return;
			this.pollingFallbackStarted = true;
			const addFallback = (fn, interval) => {
				const bound = L.bind(fn, this);
				this.fallbackPollers.push(bound);
				poll.add(bound, interval);
			};
			addFallback(this.pollWan, POLL_INTERVAL);
			if (ports.length)
				addFallback(L.bind(this.pollPorts, this, ports), POLL_INTERVAL);
			if (lan)
				addFallback(this.pollTraffic, POLL_INTERVAL);
			addFallback(this.pollSystem, POLL_INTERVAL);
		};
		this.startPollingFallback = startPollingFallback;

		this.liveStream = rpc.stream(L.bind(this.applyLiveSnapshot, this), () => {
			/* If an established stream loses authentication or the network, keep
			 * the page live while EventSource attempts its reconnect. */
			if (this.streamReady) {
				this.streamReady = false;
				this.startPollingFallback();
			}
		});
		if (this.liveStream)
			this.streamFallbackTimer = setTimeout(startPollingFallback, 6000);
		else
			startPollingFallback();

		if (radios.length) {
			this.pollSurvey();
			poll.add(L.bind(this.pollSurvey, this), 5);
		}
		if (lan) {
			this.pollTraffic();
		}
		this.pollSystem();

		return container;
	},

	applyLiveSnapshot(snapshot) {
		this.streamReady = true;
		if (this.streamFallbackTimer) {
			clearTimeout(this.streamFallbackTimer);
			this.streamFallbackTimer = null;
		}
		if (this.fallbackPollers.length) {
			this.fallbackPollers.forEach(fn => poll.remove(fn));
			this.fallbackPollers = [];
		}

		const devices = snapshot.devices || {};
		this.applyWanSnapshot(snapshot.interfaces || [], devices);
		this.applyPortsSnapshot(devices);
		this.applyTrafficSnapshot(snapshot.conntrack || [], snapshot.arp || {});
		this.applySystemSnapshot(snapshot.system || {}, snapshot.cpu, snapshot.connections || {});
	},

	renderInternetCard(groups) {
		this.connections = [];

		const blocks = groups.length
			? groups.map((group, i) => this.renderConnectionBlock(group, i))
			: [ E('div', { class: 'fn-info-empty' }, _('No WAN interface configured.')) ];

		return E('div', { class: 'fn-card' }, [
			cardHead('M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2ZM2 12h20M12 2c2.5 2.7 4 6.2 4 10s-1.5 7.3-4 10c-2.5-2.7-4-6.2-4-10s1.5-7.3 4-10Z', _('Internet'), [ 'admin', 'network', 'internet' ]),
			E('div', { class: 'fn-card-body fn-conn-list' }, blocks)
		]);
	},

	renderConnectionBlock(group, index) {
		const wan = mergeWanGroup(group);
		const spark = renderSparkline();
		const rxLabel = E('span', {}, '–');
		const txLabel = E('span', {}, '–');
		const infoGrid = E('div', { class: 'fn-info-grid' });
		const ipv6AddressesEl = E('div', { class: 'fn-conn-ipv6-value' }, '–');
		const ipv6DnsEl = E('div', { class: 'fn-conn-ipv6-value' }, '–');
		const ipv6Details = E('details', { class: 'fn-conn-ipv6' });
		ipv6Details.hidden = true;
		ipv6Details.appendChild(E('summary', {}, _('IPv6 details')));
		ipv6Details.appendChild(E('div', { class: 'fn-conn-ipv6-body' }, [
			E('div', { class: 'fn-conn-ipv6-field' }, [
				E('div', { class: 'fn-conn-ipv6-label' }, _('Addresses')),
				ipv6AddressesEl
			]),
			E('div', { class: 'fn-conn-ipv6-field' }, [
				E('div', { class: 'fn-conn-ipv6-label' }, _('DNS')),
				ipv6DnsEl
			])
		]));
		const statusPill = E('span', { class: 'fn-status-pill' });

		const conn = {
			device: group.device, spark, rxLabel, txLabel, infoGrid, statusPill,
			ipv6Details, ipv6AddressesEl, ipv6DnsEl,
			name: group.name,
			ifaceNames: group.ifaces.map(e => e.interface),
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
				E('span', { class: 'fn-legend-dot fn-legend-rx' }), _('Download:'), ' ', rxLabel,
				E('span', { class: 'fn-legend-dot fn-legend-tx' }), _('Upload:'), ' ', txLabel
			]),
			infoGrid,
			ipv6Details
		]);
	},

	fillConnectionInfo(conn, wan) {
		conn.statusPill.className = 'fn-status-pill ' + (wan.up ? 'fn-status-ok' : 'fn-status-off');
		dom_content(conn.statusPill, wan.up ? _('Connected') : _('Not connected'));

		const v4addrs = (wan['ipv4-address'] || []).map(a => a.address + '/' + a.mask);
		const v6addrs = (wan['ipv6-address'] || []).map(a => a.address + '/' + a.mask);
		const dns = wan['dns-server'] || [];
		const v4dns = dns.filter(address => address.indexOf(':') === -1);
		const v6dns = dns.filter(address => address.indexOf(':') !== -1);
		const gw = (wan.route || []).find(r => r.target == '0.0.0.0' && r.mask == 0);
		const hasIpv6 = v6addrs.length > 0 || v6dns.length > 0;

		const values = {
			proto: wan.proto ? String(wan.proto).toUpperCase() : '–',
			/* Keep the high-level card focused on the primary IPv4 connection.
			   IPv6 can contain several long addresses and is available from the
			   compact disclosure immediately below the grid. */
			addr: v4addrs.length ? v4addrs.join(', ') : (hasIpv6 ? _('IPv6 active') : '–'),
			gw: gw ? gw.nexthop : '–',
			dns: v4dns.length ? v4dns.join(', ') : (v6dns.length ? _('IPv6 DNS') : '–'),
			connected: wan.uptime > 0 ? fmtUptime(wan.uptime) : '–',
			interface: connectionInterfaceLabel(wan)
		};

		/* Build the grid once, then just update each value cell's text on
		   every poll — rebuilding the whole grid (dom_empty + re-append) each
		   tick made every value flash blank/reappear instead of updating in
		   place, MAC/Received/Sent included since they were recreated too. */
		if (!conn.infoBuilt) {
			const grid = conn.infoGrid;
			const makeItem = (label, valueClass) => {
				const valueEl = E('div', { class: 'fn-info-value' + (valueClass ? ' ' + valueClass : '') }, '–');
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
			conn.interfaceEl = makeItem(_('Interface'));
			/* filled in once network.device status resolves, in pollWan() below */
			conn.macEl = makeItem(_('MAC address'), 'fn-mac-value');
			conn.rxTotalEl = makeItem(_('Received'));
			conn.txTotalEl = makeItem(_('Sent'));
			conn.infoBuilt = true;
		}

		dom_content(conn.protoEl, values.proto);
		dom_content(conn.addrEl, values.addr);
		dom_content(conn.gwEl, values.gw);
		dom_content(conn.dnsEl, values.dns);
		dom_content(conn.connectedEl, values.connected);
		dom_content(conn.interfaceEl, values.interface);

		if (conn.ipv6Details) {
			conn.ipv6Details.hidden = !hasIpv6;
			dom_content(conn.ipv6AddressesEl, v6addrs.length ? v6addrs.join('\n') : '–');
			dom_content(conn.ipv6DnsEl, v6dns.length ? v6dns.join(', ') : '–');
		}
	},

	applyWanSnapshot(interfaces, devices) {
		const byName = {};
		interfaces.forEach(iface => { byName[iface.interface] = iface; });
		const now = Date.now();

		this.connections.forEach(conn => {
			const ifaces = conn.ifaceNames.map(name => byName[name]).filter(Boolean);
			if (!ifaces.length)
				return;

			this.fillConnectionInfo(conn, mergeWanGroup({
				name: conn.name,
				device: conn.device,
				ifaces
			}));
			this.updateConnectionStats(conn, devices[conn.device] || {}, now);
		});
	},

	updateConnectionStats(conn, dev, now) {
		const stats = dev.statistics || {};
		const rxBytes = stats.rx_bytes || 0;
		const txBytes = stats.tx_bytes || 0;
		let rxRate = 0, txRate = 0;

		if (conn.lastSample) {
			const dt = (now - conn.lastSample.time) / 1000;
			if (dt > 0) {
				rxRate = Math.max(0, (rxBytes - conn.lastSample.rx) / dt);
				txRate = Math.max(0, (txBytes - conn.lastSample.tx) / dt);
			}
		}

		conn.lastSample = { time: now, rx: rxBytes, tx: txBytes };
		conn.rxHistory.push(rxRate);
		conn.txHistory.push(txRate);
		if (conn.rxHistory.length > HISTORY_LEN) conn.rxHistory.shift();
		if (conn.txHistory.length > HISTORY_LEN) conn.txHistory.shift();

		updateSparkline(conn.spark, conn.rxHistory, conn.txHistory);
		dom_content(conn.rxLabel, fmtBps(rxRate));
		dom_content(conn.txLabel, fmtBps(txRate));
		if (conn.macEl) dom_content(conn.macEl, upperString(dev.macaddr) || '–');
		if (conn.rxTotalEl) dom_content(conn.rxTotalEl, fmtBytes(rxBytes));
		if (conn.txTotalEl) dom_content(conn.txTotalEl, fmtBytes(txBytes));
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
					this.updateConnectionStats(conn, dev, now);
				}, this)).catch(() => {});
			}, this)));
		}, this)).catch(() => {});
	},

	renderNetworksCard(wireless, ports, netConfig, dhcpConfig, leases, guestInfo) {
		const body = E('div', { class: 'fn-card-body fn-networks-body' });
		this.networksBody = body;
		this.buildNetworksBody(wireless, ports, netConfig, dhcpConfig, leases, guestInfo);

		return E('div', { class: 'fn-card' }, [
			cardHead('M12 20h.01M8.5 16.5a5 5 0 0 1 7 0M5 13a10 10 0 0 1 14 0', _('My Networks & Wi-Fi'), [ 'admin', 'network', 'home_network' ]),
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
					(entry ? entry.stations : []).forEach(st => {
						const mac = upperString(st.mac);
						if (mac)
							wifiMacs[mac] = true;
					});
				});
				wiredCount = leases.filter(l => ipInLan(l.ipaddr, opts.ipInfo) && !wifiMacs[upperString(l.macaddr)]).length;
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
					const disabled = iface.disabled === '1' || radio.disabled === '1';
					const ssid = iface.ssid || _('(hidden)');

					const toggle = E('input', { type: 'checkbox', class: 'fn-switch-input' });
					toggle.checked = !disabled;
					toggle.addEventListener('change', () => this.toggleWifi(iface['.name'], iface.device, toggle));

					const mainChildren = [
						E('div', { class: 'fn-wifi-ssid' }, ssid),
						E('div', { class: 'fn-wifi-meta' }, formatWifiMeta(iface, radio, info) + (disabled ? ' · ' + _('disabled') : ''))
					];
					if (info && info.bssid)
						mainChildren.push(E('div', { class: 'fn-wifi-meta' }, 'MAC: ' + info.bssid));

					const bandLabel = radio.band === '5g' ? '5 GHz' : '2.4 GHz';
					const qrBtn = E('button', {
						type: 'button', class: 'fn-icon-btn fn-wifi-qr', 'aria-label': _('Wi-Fi QR code'),
						click: event => this.showQrDialog(ssid, bandLabel, iface.key, iface.encryption, event.currentTarget)
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
				uci.set('wireless', dev['.name'], 'disabled', '0');
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
				uci.set('network', sid, 'freenetic_managed', '1');
			}

			if (uci.get('network', 'guest', 'proto') == null) {
				uci.add('network', 'interface', 'guest');
				uci.set('network', 'guest', 'proto', 'static');
				uci.set('network', 'guest', 'device', 'br-guest');
				uci.set('network', 'guest', 'ipaddr', '192.168.3.1');
				uci.set('network', 'guest', 'netmask', '255.255.255.0');
				uci.set('network', 'guest', 'freenetic_managed', '1');
			}

			if (uci.get('dhcp', 'guest', 'interface') == null) {
				uci.add('dhcp', 'dhcp', 'guest');
				uci.set('dhcp', 'guest', 'interface', 'guest');
				uci.set('dhcp', 'guest', 'start', '100');
				uci.set('dhcp', 'guest', 'limit', '150');
				uci.set('dhcp', 'guest', 'leasetime', '12h');
				uci.set('dhcp', 'guest', 'freenetic_managed', '1');
			}
			uci.set('dhcp', 'guest', 'dhcpv4', 'server');

			if (uci.get('firewall', 'guest', 'name') == null) {
				uci.add('firewall', 'zone', 'guest');
				uci.set('firewall', 'guest', 'name', 'guest');
				uci.set('firewall', 'guest', 'network', 'guest');
				uci.set('firewall', 'guest', 'output', 'ACCEPT');
				uci.set('firewall', 'guest', 'forward', 'REJECT');
				uci.set('firewall', 'guest', 'freenetic_managed', '1');
			}
			networkHelper.ensureGuestFirewall();

			if (uci.get('firewall', 'guest_wan_fwd', 'src') == null) {
				uci.add('firewall', 'forwarding', 'guest_wan_fwd');
				uci.set('firewall', 'guest_wan_fwd', 'src', 'guest');
				uci.set('firewall', 'guest_wan_fwd', 'dest', 'wan');
				uci.set('firewall', 'guest_wan_fwd', 'freenetic_managed', '1');
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

	toggleWifi(sectionName, radioName, toggleEl) {
		const enableRadio = toggleEl.checked && radioName
			? ubusCall('uci', 'set', { config: 'wireless', section: radioName, values: { disabled: '0' } })
			: Promise.resolve();
		return enableRadio
			.then(() => ubusCall('uci', 'set', {
				config: 'wireless', section: sectionName,
				values: { disabled: toggleEl.checked ? '0' : '1' }
			}))
			.then(() => ubusCall('uci', 'commit', { config: 'wireless' }))
			.then(() => ubusCall('network', 'reload', {}))
			.catch(err => {
				toggleEl.checked = !toggleEl.checked;
				notify([ _('Failed to apply Wi-Fi change: %s').format(err.message) ], 'danger');
			});
	},

	showQrDialog(ssid, bandLabel, key, encryption, opener) {
		const isOpen = !encryption || encryption === 'none';
		this.qrOpener = opener || document.activeElement;

		if (!this.qrOverlay) {
			this.qrOverlay = E('div', {
				class: 'fn-qr-overlay',
				'aria-hidden': 'true',
				click: (ev) => { if (ev.target === this.qrOverlay) this.hideQrDialog(); }
			});
			this.qrOverlay.inert = true;
			document.body.appendChild(this.qrOverlay);
			this.qrKeydownHandler = (ev) => {
				if (!this.qrOverlay || !this.qrOverlay.classList.contains('fn-qr-open'))
					return;
				if (ev.key === 'Escape')
					this.hideQrDialog();
				else
					trapDialogFocus(ev, this.qrDialog);
			};
			document.addEventListener('keydown', this.qrKeydownHandler);
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
		this.qrDialog = E('div', {
			class: 'fn-qr-box',
			role: 'dialog',
			tabindex: '-1',
			'aria-modal': 'true',
			'aria-labelledby': 'fn-qr-dialog-title'
		}, [
			E('div', { class: 'fn-qr-head' }, [
				E('div', {}, [
					E('h3', { id: 'fn-qr-dialog-title', class: 'fn-qr-title' }, _('Wireless network information')),
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
		]);
		this.qrOverlay.appendChild(this.qrDialog);

		qrcode.renderToCanvas(canvas, wifiQrPayload(ssid, key, isOpen), 4);
		this.qrOverlay.inert = false;
		this.qrOverlay.setAttribute('aria-hidden', 'false');

		requestAnimationFrame(() => {
			if (this.qrOverlay) {
				this.qrOverlay.classList.add('fn-qr-open');
				const close = this.qrOverlay.querySelector('.fn-qr-close');
				(close || this.qrDialog).focus();
			}
		});
	},

	hideQrDialog(restoreFocus) {
		if (this.qrOverlay) {
			this.qrOverlay.classList.remove('fn-qr-open');
			this.qrOverlay.setAttribute('aria-hidden', 'true');
			this.qrOverlay.inert = true;
		}
		const opener = this.qrOpener;
		this.qrOpener = null;
		if (restoreFocus !== false && opener && document.contains(opener) && typeof opener.focus === 'function')
			requestAnimationFrame(() => opener.focus());
	},

	destroy() {
		this.hideQrDialog(false);
		if (this.streamFallbackTimer) {
			clearTimeout(this.streamFallbackTimer);
			this.streamFallbackTimer = null;
		}
		if (this.qrKeydownHandler) {
			document.removeEventListener('keydown', this.qrKeydownHandler);
			this.qrKeydownHandler = null;
		}
		if (this.qrOverlay) {
			this.qrOverlay.remove();
			this.qrOverlay = null;
			this.qrDialog = null;
		}
		if (Array.isArray(this.fallbackPollers)) {
			this.fallbackPollers.forEach(fn => poll.remove(fn));
			this.fallbackPollers = [];
		}
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
			cardHead('M4 9h16v10H4zM8 9V6a4 4 0 0 1 8 0v3', _('Network Ports'), [ 'admin', 'network', 'home_network' ]),
			E('div', { class: 'fn-card-body' }, [ row ])
		]);
	},

	applyPortsSnapshot(devices) {
		(this.ports || []).forEach(port => {
			const st = devices[port.device] || null;
			const els = this.portEls && this.portEls[port.device];
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
	},

	pollPorts(ports) {
		return Promise.all(ports.map(port =>
			ubusCall('network.device', 'status', { name: port.device }).catch(() => null)
		)).then(L.bind(function(statuses) {
			const devices = {};
			ports.forEach((port, i) => { devices[port.device] = statuses[i]; });
			this.applyPortsSnapshot(devices);
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
			cardHead('M3 3v18h18M7 16v-4M11 16V8M15 16v-7M19 16v-2', _('Wi-Fi Monitor'), [ 'admin', 'status', 'wifimonitor' ]),
			E('div', { class: 'fn-card-body' }, [ tabs, chart ])
		]);
	},

	pollSurvey() {
		const radio = this.activeRadio;
		const chart = this.surveyChart;
		chart.classList.toggle('fn-survey-chart-5g', !!radio && radio.band === '5g');

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
			cardHead('M3 17l6-6 4 4 8-8M21 3v6h-6', _('Traffic Monitor'), [ 'admin', 'status', 'traffic' ]),
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
			this.applyTrafficSnapshot(res[0], res[1]);
		}, this)).catch(L.bind(function() {
			this.renderTrafficChart({}, {}, false);
		}, this));
	},

	applyTrafficSnapshot(conns, arp) {
		const lan = this.lanInfo;
		if (!lan)
			return;

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
			const arpMac = upperString(arp[e.ip]);
			const label = e.other ? _('Other devices') : (e.ip + (arpMac ? ' (' + arpMac + ')' : ''));
			legend.appendChild(E('div', { class: 'fn-traffic-row' }, [
				E('span', { class: 'fn-traffic-dot', style: 'background:var(--' + cls + ')' }),
				E('span', { class: 'fn-traffic-label' }, label),
				E('span', { class: 'fn-traffic-value' }, isRate ? fmtBps(e.value) : (Math.round(e.value / 1024) + ' KB'))
			]));
		});
	},

	renderFreeneticUpdates(state, row, groupTitle) {
		state = state || {};
		const updater = state.updater || {};
		const updaterReady = updater.can_update === true;
		const channel = state.channel === 'beta' ? 'beta' : 'stable';
		const channelSelect = E('select', { class: 'fn-update-channel' }, [
			E('option', { value: 'stable' }, _('Stable')),
			E('option', { value: 'beta' }, _('Beta'))
		]);
		channelSelect.value = channel;

		const status = E('span', { class: 'fn-update-status' },
			updaterReady ? _('Not checked yet.') : _('Updates are unavailable on this router.'));
		const checkButton = E('button', {
			type: 'button',
			class: 'fn-settings-btn',
			disabled: !updaterReady
		}, _('Check for updates'));
		const installButton = E('button', {
			type: 'button',
			class: 'fn-settings-btn cbi-button-positive',
			hidden: true
		}, _('Install update'));
		let pendingPlan = null;

		const setStatus = (message, kind) => {
			status.className = 'fn-update-status' + (kind ? ' fn-update-status-' + kind : '');
			dom_content(status, message);
		};
		const setReleaseStatus = (message, release, kind) => {
			const link = E('a', {
				href: release.html_url || FREENETIC_REPOSITORY + '/releases',
				target: '_blank',
				rel: 'noopener'
			}, release.tag_name);
			dom_empty(status);
			status.appendChild(document.createTextNode(message + ' '));
			status.appendChild(link);
			status.className = 'fn-update-status fn-update-status-' + kind;
		};
		const resetPlan = () => {
			pendingPlan = null;
			installButton.hidden = true;
		};
		const setBusy = busy => {
			channelSelect.disabled = busy;
			checkButton.disabled = busy || !updaterReady;
			installButton.disabled = busy;
		};

		channelSelect.addEventListener('change', () => {
			resetPlan();
			const previous = state.channel === 'beta' ? 'beta' : 'stable';
			const next = channelSelect.value;
			channelSelect.disabled = true;
			setStatus(_('Saving channel…'), 'pending');

			if (!uci.get('freenetic', 'updates'))
				uci.add('freenetic', 'freenetic', 'updates');
			uci.set('freenetic', 'updates', 'channel', next);

			uci.save().then(() => applyChanges()).then(() => {
				state.channel = next;
				setStatus(_('Channel saved.'), 'success');
			}).catch(error => {
				channelSelect.value = previous;
				setStatus(_('Failed to save channel: %s').format(error.message || error), 'error');
			}).finally(() => {
				channelSelect.disabled = false;
			});
		});

		checkButton.addEventListener('click', () => {
			resetPlan();
			setBusy(true);
			dom_content(checkButton, _('Checking…'));
			setStatus(_('Looking for a %s release…').format(channelSelect.value === 'beta' ? _('beta') : _('stable')), 'pending');

			fetch(FREENETIC_RELEASES_API, {
				headers: { Accept: 'application/vnd.github+json' }
			}).then(response => {
				if (!response.ok)
					throw new Error('GitHub HTTP ' + response.status);
				return response.json();
			}).then(releases => {
				const candidates = (Array.isArray(releases) ? releases : [])
					.filter(release => !release.draft && (channelSelect.value === 'beta' ? release.prerelease : !release.prerelease))
					.sort((a, b) => String(b.published_at || b.created_at || '').localeCompare(String(a.published_at || a.created_at || '')));
				const latest = candidates[0];

				if (!latest) {
					setStatus(_('No release is available for this channel.'), 'info');
					return;
				}

				const plan = freeneticReleasePlan(latest, updater, state.packages || []);
				if (!plan.compatible) {
					setReleaseStatus(_('The latest release has no complete update for this router:'), latest, 'error');
					return;
				}

				if (plan.comparison === 0) {
					setReleaseStatus(_('Freenetic is up to date:'), latest, 'success');
					return;
				}
				if (plan.comparison < 0) {
					setReleaseStatus(_('The installed build is newer than:'), latest, 'info');
					return;
				}

				pendingPlan = Object.assign({ release: latest }, plan);
				installButton.hidden = false;
				setReleaseStatus(plan.comparison == null
					? _('A compatible Freenetic release is available:')
					: _('Freenetic update is available:'), latest, 'success');
			}).catch(error => {
				setStatus(_('Update check failed: %s').format(error.message || error), 'error');
			}).finally(() => {
				setBusy(false);
				dom_content(checkButton, _('Check for updates'));
			});
		});

		installButton.addEventListener('click', () => {
			const plan = pendingPlan;
			if (!plan)
				return;

			ui.showModal(_('Install Freenetic update?'), [
				E('p', {}, _('The theme, interface, Russian translations and fnc will be updated together to %s. Router settings will be preserved.').format(plan.tag)),
				E('p', {}, _('Do not power off the router while packages are being installed.')),
				E('div', { class: 'button-row' }, [
					E('button', { class: 'btn', click: ui.hideModal }, _('Cancel')),
					E('button', {
						class: 'btn cbi-button-positive',
						click: ui.createHandlerFn(this, () => {
							setBusy(true);
							ui.showModal(_('Updating Freenetic…'), [
								E('p', { class: 'spinning' }, _('Downloading and verifying the release. Do not power off the router.'))
							]);

							return fs.exec_direct(FREENETIC_UPDATE_HELPER, [ 'install', plan.tag ], 'json')
								.then(result => {
									if (!result || result.ok !== true) {
										const error = new Error(result && result.error || _('The release installer failed.'));
										error.freeneticConfirmedFailure = true;
										throw error;
									}
									ui.showModal(_('Freenetic was updated'), [
										E('p', {}, _('The interface update was installed successfully. Reload the page to use the new version.')),
										E('div', { class: 'button-row' }, [
											E('button', {
												class: 'btn cbi-button-positive',
												click: () => window.location.reload()
											}, _('Reload interface'))
										])
									]);
								})
								.catch(error => {
									const confirmed = error && error.freeneticConfirmedFailure;
									ui.showModal(confirmed ? _('Freenetic update failed') : _('Update connection was interrupted'), [
										E('p', {}, confirmed
											? _('The update was not installed: %s').format(error.message || error)
											: _('rpcd may have restarted while applying the update. Reload the interface and check the installed version.')),
										E('div', { class: 'button-row' }, [
											E('button', { class: 'btn', click: ui.hideModal }, _('Close')),
											E('button', {
												class: 'btn cbi-button-positive',
												click: () => window.location.reload()
											}, _('Reload interface'))
										])
									]);
								})
								.finally(() => setBusy(false));
						})
					}, _('Install'))
				])
			]);
		});

		const sourceLink = E('a', {
			href: FREENETIC_REPOSITORY,
			target: '_blank',
			rel: 'noopener'
		}, 'github.com/unisequence/freenetic');
		const channelValue = E('div', { class: 'fn-update-channel-value' }, channelSelect);
		const checkValue = E('div', { class: 'fn-update-actions' }, [ checkButton, installButton, status ]);

		return [
			groupTitle(_('Freenetic'), 'freenetic'),
			row(_('Installed'), E('div', { class: 'fn-info-value' }, formatFreeneticVersion(state.packages || []))),
			row(_('Channel'), channelValue),
			row(_('Repository'), sourceLink),
			row(_('Updates'), checkValue)
		];
	},

	renderSystemCard(board, sysupgradeCfg, freeneticUpdateState) {
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
		const groupTitle = (text, key) => E('div', {
			class: 'fn-info-group-title' + (key ? ' fn-info-group-' + key : '')
		}, text);

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
			groupTitle(_('System'), 'system'),
			meterRow(_('CPU'), cpuFill, cpuValue),
			meterRow(_('RAM'), ramFill, ramValue),
			row(_('Uptime'), uptimeValue),
			row(_('Current time'), timeValue),
			row(_('Active connections'), connValue),

			groupTitle(_('System updates'), 'updates'),
			row(_('OS version'), E('div', { class: 'fn-info-value' }, release.description || '–')),
			row(_('Update channel'), E('div', { class: 'fn-info-value' }, [ channelLink ])),
			row(_('Auto-update'), E('div', { class: 'fn-info-value' }, autoUpdateText)),
			...this.renderFreeneticUpdates(freeneticUpdateState, row, groupTitle),

			groupTitle(_('Device'), 'device'),
			row(_('Model'), E('div', { class: 'fn-info-value' }, board.model || board.board_name || '–')),
			row(_('Kernel version'), E('div', { class: 'fn-info-value' }, board.kernel || '–'))
		]);

		return E('div', { class: 'fn-card fn-system-card' }, [
			cardHead('M9 3h6v4H9zM4 9h16v10H4zM9 21v-2h6v2', _('About System'), [ 'admin', 'system', 'system' ]),
			body
		]);
	},

	pollSystem() {
		return Promise.all([ getSystemInfo(), getProcStatCpu(), getConntrackCounts() ]).then(L.bind(function(res) {
			this.applySystemSnapshot(res[0], res[1], res[2]);
		}, this)).catch(() => {});
	},

	applySystemSnapshot(info, stat, conn) {
			const els = this.sysEls;
			if (!els)
				return;

			if (stat) {
				const now = Date.now();
				const elapsed = this.cpuLastSampleAt ? now - this.cpuLastSampleAt : 0;
				/* The initial dashboard poll and the first SSE snapshot can arrive
				 * almost together.  A delta over a few milliseconds has a tiny
				 * denominator and turns page startup work into a misleading 80%+
				 * reading, so keep it only as the baseline for the next sample. */
				if (this.cpuLastSample && elapsed >= MIN_CPU_SAMPLE_INTERVAL) {
					const dIdle = stat.idle - this.cpuLastSample.idle;
					const dTotal = stat.total - this.cpuLastSample.total;
					const pct = dTotal > 0 ? Math.max(0, Math.min(100, Math.round(100 * (1 - dIdle / dTotal)))) : 0;
					els.cpuFill.style.width = pct + '%';
					dom_content(els.cpuValue, pct + '%');
				}
				this.cpuLastSample = stat;
				this.cpuLastSampleAt = now;
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
	},

	addFooter() { return E([]); }
});
