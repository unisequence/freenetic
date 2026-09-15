'use strict';
'require baseclass';
'require fs';
'require uci';
'require freenetic-rpc as rpc';

/* Dashboard data access and normalization. Rendering stays in the view so
 * each responsibility can be tested and changed independently. */
const ubusCall = rpc.call;

const HISTORY_LEN = 40;
const POLL_INTERVAL = 3; /* seconds */
const MIN_CPU_SAMPLE_INTERVAL = 1000; /* milliseconds */
const FREENETIC_REPOSITORY = 'https://github.com/unisequence/freenetic';
const FREENETIC_RELEASES_API = 'https://api.github.com/repos/unisequence/freenetic/releases?per_page=30';
const FREENETIC_UPDATE_HELPER = '/usr/libexec/freenetic-self-update';
const FREENETIC_PACKAGE_NAMES = [ 'luci-theme-freenetic', 'luci-app-freenetic' ];
const FREENETIC_DISPLAY_VERSION = 'v0.2.x-dev';
const FREENETIC_RELEASE_CODENAMES = Object.freeze({
	'0.2': 'Onyx'
});
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
	const fncVariant = packageManager === 'apk' ? 'apk' : 'ipk';
	required.push('fnc-' + version + '-' + assetSuffix + '-' + fncVariant);
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

function upperString(value) {
	if (Array.isArray(value))
		value = value[0];
	return typeof value === 'string' ? value.trim().toUpperCase() : '';
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

function getIwinfoDevices() {
	return ubusCall('iwinfo', 'devices').then(r => r.devices || []).catch(() => []);
}

function getWifiRadios(wireless, activeDevices, wirelessStatus) {
	const radios = Object.keys(wireless)
		.map(k => wireless[k])
		.filter(s => s['.type'] === 'wifi-device');
	const statusDevices = {};
	Object.keys(wirelessStatus || {}).forEach(name => {
		const iface = (wirelessStatus[name].interfaces || []).find(i => i && i.ifname);
		if (iface)
			statusDevices[name] = iface.ifname;
	});
	const inferredPhy = name => {
		const match = String(name || '').match(/^radio(\d+)$/);
		return match ? 'phy' + match[1] : null;
	};

	const devices = Array.isArray(activeDevices) ? Promise.resolve(activeDevices) : getIwinfoDevices();
	return Promise.all([
		devices,
		Promise.all(radios.map(r => {
			/* network.wireless status already names the live AP interface. Reuse
			 * it when available instead of making one iwinfo.phyname round-trip per
			 * radio. Conventional radio0/radio1 sections also map to phy0/phy1,
			 * so the common path needs no extra request even while a radio is down;
			 * keep the old lookup for unusual section names. */
			if (statusDevices[r['.name']] || inferredPhy(r['.name']))
				return Promise.resolve(inferredPhy(r['.name']));

			return ubusCall('iwinfo', 'phyname', { section: r['.name'] })
				.then(p => p.phyname).catch(() => null);
		}))
	]).then(([liveDevices, phynames]) => radios.map((r, i) => {
		const hintedDevice = statusDevices[r['.name']];
		const phy = phynames[i];
		const dev = hintedDevice || (phy ? liveDevices.find(d => d.indexOf(phy + '-') === 0) : null);
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

function dashboardClientRows(leases, stations, activeArpMacs, dhcpConfig, guestInfo) {
	const hosts = {};
	const clients = {};

	Object.keys(dhcpConfig || {}).forEach(sectionName => {
		const section = dhcpConfig[sectionName] || {};
		if (section['.type'] !== 'host')
			return;
		const mac = upperString(section.mac);
		if (mac)
			hosts[mac] = section;
	});

	(leases || []).forEach(lease => {
		const mac = upperString(lease && lease.macaddr);
		if (!mac)
			return;

		const station = stations[mac];
		const ethernet = !station && !!activeArpMacs[mac];
		const host = hosts[mac] || {};
		const guest = ipInLan(lease.ipaddr, guestInfo);
		clients[mac] = {
			mac,
			name: host.name || lease.hostname || mac,
			ip: lease.ipaddr || '–',
			segment: guest ? _('Guest network') : _('Home network'),
			connection: station ? station.band + ' Wi-Fi' : (ethernet ? 'Ethernet' : _('Not connected')),
			wifi: !!station,
			ethernet,
			online: !!station || ethernet
		};
	});

	return Object.keys(clients).map(mac => clients[mac])
		.sort((left, right) => left.name.localeCompare(right.name));
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
	return fs.exec_direct('/usr/libexec/freenetic-package-status', FREENETIC_PACKAGE_NAMES, 'json')
		.then(result => result && result.ok !== false && result.packages
			? Object.entries(result.packages).filter(([, state]) => state && state.installed)
				.map(([ name, state ]) => ({ name, version: state.version || '' }))
			: [])
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
		getFreeneticUpdaterStatus()
	]).then(([, updater]) => {
		const updaterPackages = updater && Array.isArray(updater.packages) ? updater.packages : [];
		const state = packages => ({
			channel: uci.get('freenetic', 'updates', 'channel') || 'stable',
			packages,
			updater
		});

		/* The status helper already reports the two Freenetic package versions.
		 * Only invoke the legacy full package-list backend when that data is absent. */
		return updaterPackages.length ? state(updaterPackages) :
			getFreeneticInstalledPackages().then(state);
	});
}

function freeneticBuildRevision(version) {
	const match = String(version || '').match(/[.~]([0-9a-f]{7,})(?:-r\d+)?$/i);
	return match ? match[1].slice(0, 7) : '';
}

function freeneticReleaseTag(value) {
	const tag = String(value || '').trim();
	return /^v\d+\.\d+\.\d+(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?$/.test(tag) ? tag : '';
}

function freeneticReleaseCodename(value) {
	const tag = freeneticReleaseTag(value);
	if (!tag || tag.includes('-'))
		return '';

	const line = tag.match(/^v(\d+\.\d+)\./);
	return line ? (FREENETIC_RELEASE_CODENAMES[line[1]] || '') : '';
}

function formatFreeneticVersion(packages, installedRelease) {
	const releaseTag = freeneticReleaseTag(installedRelease);
	if (releaseTag)
		return releaseTag;

	const versioned = packages.filter(pkg => pkg.version);
	if (!versioned.length)
		return _('Development build');

	const revisions = versioned.map(pkg => freeneticBuildRevision(pkg.version));
	const firstRevision = revisions[0];
	if (firstRevision && revisions.every(revision => revision === firstRevision))
		return FREENETIC_DISPLAY_VERSION + ' · ' + firstRevision;

	if (versioned.every(pkg => pkg.version === versioned[0].version))
		return FREENETIC_DISPLAY_VERSION;

	return FREENETIC_DISPLAY_VERSION + ' · ' + versioned.map((pkg, index) => {
		const name = pkg.name === 'luci-theme-freenetic' ? 'theme' : 'app';
		return name + ' ' + (revisions[index] || pkg.version);
	}).join(' / ');
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

function getActiveArpMacs() {
	return ubusCall('file', 'read', { path: '/proc/net/arp' }).then(result => {
		const active = {};
		(result.data || '').split('\n').slice(1).forEach(line => {
			const columns = line.trim().split(/\s+/);
			const mac = columns.length >= 4 ? upperString(columns[3]) : '';
			if (mac && (parseInt(columns[2], 16) & 0x2))
				active[mac] = true;
		});
		return active;
	}).catch(() => ({}));
}

/* network.wireless status exposes interface metadata but leaves its station
   arrays empty or transiently fails on some OpenWrt builds. Discover live AP
   interfaces through iwinfo itself, then use its authoritative association
   data just like the full Client List. */
function getWifiStations(devices) {
	const stations = {};

	const deviceList = Array.isArray(devices) ? Promise.resolve(devices) : getIwinfoDevices();
	return deviceList.then(result =>
		Promise.all(result.map(device =>
			Promise.all([
				ubusCall('iwinfo', 'info', { device }).catch(() => ({})),
				ubusCall('iwinfo', 'assoclist', { device }).catch(() => ({ results: [] }))
			]).then(([info, associations]) => {
				const band = Number(info.frequency) >= 5000 ? '5 GHz' : '2.4 GHz';
				(associations.results || []).forEach(station => {
					const mac = upperString(station && station.mac);
					if (mac)
						stations[mac] = { band, device, signal: station.signal };
				});
			})
		)).then(() => stations)
	).catch(() => stations);
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

return baseclass.extend({
	HISTORY_LEN,
	POLL_INTERVAL,
	MIN_CPU_SAMPLE_INTERVAL,
	FREENETIC_REPOSITORY,
	FREENETIC_RELEASES_API,
	FREENETIC_UPDATE_HELPER,
	FREENETIC_PACKAGE_NAMES,
	FREENETIC_DISPLAY_VERSION,
	FREENETIC_RELEASE_PACKAGES,
	freeneticBuildVersion,
	compareFreeneticBuilds,
	freeneticReleasePlan,
	upperString,
	getFirewallConfig,
	getInterfaceDump,
	getWanConnections,
	mergeWanGroup,
	connectionLabel,
	connectionInterfaceLabel,
	getWirelessConfig,
	getPorts,
	getIwinfoDevices,
	getWifiRadios,
	mhzToChannel,
	getLanInfo,
	getConntrack,
	getArpTable,
	ip2int,
	ipInLan,
	dashboardClientRows,
	getSystemBoard,
	getSystemInfo,
	getProcStatCpu,
	getConntrackCounts,
	getSysupgradeConfig,
	getFreeneticInstalledPackages,
	getFreeneticUpdaterStatus,
	getFreeneticUpdateState,
	freeneticBuildRevision,
	freeneticReleaseTag,
	freeneticReleaseCodename,
	formatFreeneticVersion,
	fmtMB,
	fmtDateTime,
	getWirelessStatus,
	getActiveArpMacs,
	getWifiStations,
	getIwinfoInfos,
	findIfaceEntry,
	getNetworkConfig,
	getDhcpConfig,
	getDhcpLeases,
	getInterfaceInfo,
	formatWifiMeta
});
