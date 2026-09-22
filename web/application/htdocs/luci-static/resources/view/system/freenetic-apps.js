'use strict';
'require view';
'require ui';
'require fs';
'require freenetic-ui as uiHelper';

/* Applications ("Приложения"): a curated, Keenetic-style component catalog
   sitting on top of the router's real apk package manager — not a
   reimplementation of it. Every install/remove/list call goes through
   /usr/libexec/package-manager-call, the exact same backend script the
   stock Software page (luci-app-package-manager) already uses (see its own
   htdocs/luci-static/resources/view/package-manager.js), so this is the
   real package manager underneath, just presented as fixed feature cards
   instead of a raw searchable package list. */

const dom_empty = uiHelper.empty;
const dom_content = uiHelper.content;
const notify = uiHelper.notifyLong;

const NETWORK_RESTART_HELPER = '/usr/libexec/freenetic-network-restart';
const PACKAGE_MANAGER_HELPER = '/usr/libexec/package-manager-call';
const TAILSCALE_RECOVERY_HELPER = '/usr/libexec/freenetic-tailscale-recover';
const ZAPRET2_PACKAGE_HELPER = '/usr/libexec/freenetic-zapret2-package';
const MIHOMO_PACKAGE_HELPER = '/usr/libexec/freenetic-mihomo-package';
const MAGITRICKLE_PACKAGE_HELPER = '/usr/libexec/freenetic-magitrickle-package';
const MAGITRICKLE_SUGGESTION_IDS = [
	'mihomo', 'wireguard', 'amneziawg', 'openvpn', 'pptp', 'l2tp', 'l2tp_ipsec', 'ikev2_ipsec'
];

/* Keep the catalog universal: "recommended" means safe for a normal router
 * setup, while "advanced" marks tools which can alter routing, firewall, DNS
 * or traffic processing. Region-specific packages can still be supplied by a
 * feed without hard-coding a country into the UI. */
const APP_FILTERS = [
	{ id: 'recommended', label: _('Recommended') },
	{ id: 'advanced', label: _('Advanced networking') },
	{ id: 'installed', label: _('Installed') },
	{ id: 'all', label: _('All') }
];

function requestedAppId() {
	try {
		const id = new URL(window.location.href).searchParams.get('focus') || '';
		return /^[a-z0-9_]+$/.test(id) ? id : '';
	}
	catch (e) {
		return '';
	}
}

function catalogItem(id) {
	for (const group of GROUPS) {
		const item = group.items.find(entry => entry.id === id);
		if (item)
			return { group, item };
	}
	return null;
}

function svgIcon(d, size) {
	size = size || 20;
	const span = E('span', { class: 'fn-icon' });
	span.innerHTML = '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">' +
		'<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2" ' +
		'stroke-linecap="round" stroke-linejoin="round"/></svg>';
	return span;
}

/* Concrete (not virtual/meta) package names throughout — apk silently
   resolves a meta name like 'avahi-daemon' or 'miniupnpd' to whichever
   provider it picks (avahi-dbus-daemon, miniupnpd-nftables, ...), so
   checking "is it installed" against the meta name would never match.
   Installing the concrete name directly works exactly the same way.

   Where a feature has a matching luci-app-* web UI in the feeds, it's
   listed alongside the daemon package so installing the feature here
   installs its web UI too by default (no separate opkg step, and it's
   what makes the corresponding entry show up in the Services sidebar
   group — see menu-freenetic.js SIDEBAR_GROUPS). Features with no
   luci-app-* counterpart (VPN clients, mDNS, PPTP/L2TP) are unaffected. */
const GROUPS = [
	{
		title: _('VPN clients'),
		tier: 'recommended',
		items: [
			{ id: 'wireguard', name: _('WireGuard VPN'), restartNetifdOnInstall: true, packages: [ 'wireguard-tools', 'kmod-wireguard', 'rpcd-mod-wireguard', 'luci-proto-wireguard' ],
				desc: _('Modern, fast VPN client built into the Linux kernel, with native LuCI support.') },
			{ id: 'pptp', name: _('PPTP client'), packages: [ 'ppp-mod-pptp' ],
				desc: _('Connect to a PPTP VPN server.') },
			{ id: 'l2tp', name: _('L2TP client'), packages: [ 'ppp-mod-pppol2tp' ],
				desc: _('Connect to an L2TP VPN server.') },
			{ id: 'l2tp_ipsec', name: _('L2TP/IPsec client'), restartNetifdOnInstall: true,
				packages: [ 'xl2tpd', 'ppp-mod-pppol2tp', 'kmod-l2tp', 'kmod-pppol2tp', 'strongswan-default', 'luci-proto-ppp' ],
				desc: _('L2TP over an IPsec-encrypted tunnel using native xl2tpd and strongSwan.') },
			{ id: 'ikev2_ipsec', name: _('IKEv2/IPsec client'), restartNetifdOnInstall: true,
				packages: [ 'strongswan-default', 'strongswan-mod-eap-identity', 'strongswan-mod-eap-mschapv2', 'xfrm', 'kmod-xfrm-interface', 'luci-proto-xfrm' ],
				desc: _('Modern route-based IPsec VPN with PSK or EAP-MSCHAPv2 authentication.') },
			{ id: 'openvpn', name: _('OpenVPN client and server'), restartNetifdOnInstall: true, packages: [ 'openvpn-openssl' ],
				desc: _('Widely supported, certificate-based VPN.') }
		]
	},
	{
		title: _('Network'),
		tier: 'recommended',
		items: [
			{ id: 'upnp', name: _('UPnP service'), packages: [ 'miniupnpd-nftables', 'luci-app-upnp' ],
				desc: _('Lets apps and game consoles open ports automatically.') },
			{ id: 'ddns', name: _('DDNS client'), packages: [ 'ddns-scripts', 'luci-app-ddns' ],
				desc: _('Keeps a hostname pointed at this router\'s changing address.') },
			{ id: 'mdns', name: _('mDNS service'), packages: [ 'avahi-dbus-daemon' ],
				desc: _('Local device/service discovery (Bonjour/Zeroconf).') },
			{ id: 'snmp', name: _('SNMP server'), packages: [ 'snmpd-nossl', 'luci-app-snmpd' ],
				desc: _('Exposes router metrics to monitoring software.') }
		]
	},
	{
		title: _('Security and DNS'),
		tier: 'recommended',
		items: [
			{ id: 'dot_doh', name: _('DNS-over-HTTPS proxy'), packages: [ 'https-dns-proxy', 'luci-app-https-dns-proxy' ],
				desc: _('Encrypts outgoing DNS lookups.') },
			{ id: 'adblock', name: _('Ad blocking (Adblock)'), packages: [ 'adblock', 'luci-app-adblock' ],
				desc: _('Blocks ads and trackers for the whole network via DNS.') }
		]
	},
	{
		title: _('Files and media'),
		tier: 'recommended',
		items: [
			{ id: 'samba', name: _('File server (Samba)'), packages: [ 'luci-app-samba4' ],
				desc: _('Share a USB drive as a network folder.') },
			{ id: 'dlna', name: _('DLNA server'), packages: [ 'minidlna', 'luci-app-minidlna' ],
				desc: _('Streams media from a USB drive to TVs and players.') }
		]
	},
	{
		title: _('USB storage'),
		tier: 'recommended',
		items: [
			{ id: 'usb_storage', name: _('USB storage support'),
				packages: [ 'block-mount', 'kmod-usb-storage', 'usbutils' ],
				desc: _('Mount USB drives and inspect connected storage devices.') },
			{ id: 'usb_filesystems', name: _('Common USB filesystems'),
				packages: [ 'kmod-fs-ext4', 'kmod-fs-vfat', 'kmod-fs-exfat', 'kmod-fs-ntfs3' ],
				desc: _('Read common Linux, Windows and removable-drive filesystems.') }
		]
	},
	{
		title: _('USB peripherals'),
		tier: 'recommended',
		items: [
			{ id: 'usb_printer', name: _('USB printer server'),
				packages: [ 'kmod-usb-printer', 'p910d', 'luci-app-p910nd' ],
				desc: _('Share a USB printer with devices on the local network.') },
			{ id: 'usb_ups', name: _('USB UPS monitoring'),
				packages: [ 'nut', 'luci-app-nut' ],
				desc: _('Monitor a UPS connected to the router over USB.') }
		]
	},
	{
		title: _('USB modems'),
		tier: 'advanced',
		items: [
			{ id: 'usb_modem_qmi', name: _('LTE/5G modem (QMI)'), tier: 'advanced', restartNetifdOnInstall: true,
				packages: [ 'kmod-usb-net-qmi-wwan', 'uqmi', 'luci-proto-qmi', 'usb-modeswitch' ],
				desc: _('Connect cellular modems that expose a Qualcomm QMI network interface.') },
			{ id: 'usb_modem_mbim', name: _('LTE/5G modem (MBIM)'), tier: 'advanced', restartNetifdOnInstall: true,
				packages: [ 'kmod-usb-net-cdc-mbim', 'umbim', 'luci-proto-mbim', 'usb-modeswitch' ],
				desc: _('Connect LTE/5G modems that expose a standards-based MBIM interface.') },
			{ id: 'usb_modem_serial', name: _('Legacy 3G/4G modem (PPP)'), tier: 'advanced', restartNetifdOnInstall: true,
				packages: [ 'kmod-usb-serial', 'kmod-usb-serial-wwan', 'kmod-usb-serial-option', 'comgt', 'luci-proto-3g', 'usb-modeswitch' ],
				desc: _('Support older USB modems through serial ports or PPP.') },
			{ id: 'usb_modem_manager', name: _('Automatic modem management'), tier: 'advanced', restartNetifdOnInstall: true,
				packages: [ 'modemmanager', 'modemmanager-rpcd', 'luci-proto-modemmanager', 'usb-modeswitch' ],
				desc: _('Detect and manage supported cellular modems through ModemManager.') }
		]
	},
	{
		title: _('USB tethering'),
		tier: 'advanced',
		items: [
			{ id: 'usb_tethering', name: _('USB tethering'), tier: 'advanced', restartNetifdOnInstall: true,
				packages: [ 'kmod-usb-net-rndis', 'kmod-usb-net-cdc-ether', 'kmod-usb-net-cdc-ncm' ],
				desc: _('Use an Android phone or another USB network device as an uplink.') }
		]
	},
		{
			title: _('Advanced networking'),
			tier: 'advanced',
		items: [
				{ id: 'mwan3', name: _('Multi-WAN'), tier: 'advanced',
				packages: [ 'mwan3', 'luci-app-mwan3' ],
				desc: _('Fail over between multiple Internet connections or balance traffic across them.') },
				{ id: 'pbr', name: _('Policy-based routing'), packages: [ 'pbr' ],
					desc: _('Route an entire network segment or device through a selected WAN or VPN tunnel.') },
			{ id: 'nfqws2', name: _('Zapret2 (NFQWS2)'), tier: 'advanced',
				/* Prefer the complete LuCI package already used by OpenWrt builds.
				 * The signed Freenetic runtime remains a fallback for older feeds
				 * which do not publish zapret2/luci-app-zapret2 separately. */
				packages: [ 'zapret2', 'luci-app-zapret2' ],
				packageSets: [
					[ 'zapret2', 'luci-app-zapret2' ],
					[ 'freenetic-zapret2' ]
				],
				externallyAvailable: true, installHelper: ZAPRET2_PACKAGE_HELPER,
				installHelperSet: 1,
				configurePath: [ 'admin', 'network', 'zapret2' ],
				nativeConfigurePath: [ 'admin', 'services', 'zapret2' ],
				desc: _('Programmable DPI-bypass engine with Lua strategies.') },
			{ id: 'mihomo', name: _('Mihomo proxy'), tier: 'advanced',
				packages: [ 'freenetic-mihomo' ], externallyAvailable: true,
				installHelper: MIHOMO_PACKAGE_HELPER, configurePath: [ 'admin', 'network', 'mihomo' ],
				customStatus: 'mihomo',
				desc: _('Local proxy core with router-side URI and subscription conversion.') },
			{ id: 'magitrickle', name: _('MagiTrickle'), tier: 'advanced',
				packages: [ 'magitrickle' ], externallyAvailable: true,
				installHelper: MAGITRICKLE_PACKAGE_HELPER, configureUrlPort: 8080,
				desc: _('Route selected domains through Mihomo or any VPN tunnel interface.') }
		]
	}
];

/* Keep the availability probe small.  The package manager's complete
 * list-available response is several megabytes on a normal snapshot, while
 * the catalog only needs to resolve the concrete names used by its cards. */
const APP_PACKAGE_NAMES = [];
const APP_PACKAGE_SEEN = {};
function packageSets(item) {
	return Array.isArray(item.packageSets) && item.packageSets.length
		? item.packageSets
		: [ item.packages ];
}

GROUPS.forEach(group => group.items.forEach(item => packageSets(item).forEach(set => set.forEach(name => {
	if (!APP_PACKAGE_SEEN[name]) {
		APP_PACKAGE_SEEN[name] = true;
		APP_PACKAGE_NAMES.push(name);
	}
}))));

function updatePackageIndexes() {
	return fs.exec_direct(PACKAGE_MANAGER_HELPER, [ 'update' ], 'json').then(result => {
		if (!result || result.code !== 0) {
			const detail = result && (result.stderr || result.stdout) || _('unknown error');
			throw new Error(_('Failed to update package lists: %s').format(detail));
		}
		return result;
	});
}

function serviceUrl(port) {
	let host = typeof window !== 'undefined' && window.location && window.location.hostname || '192.168.1.1';
	if (host.indexOf(':') >= 0 && host.charAt(0) !== '[')
		host = '[' + host + ']';
	return 'http://' + host + ':' + port + '/';
}

function getPackageStatus() {
	return fs.exec_direct('/usr/libexec/freenetic-package-status', APP_PACKAGE_NAMES, 'json')
		.then(result => result && result.ok !== false && result.packages && typeof result.packages === 'object'
			? result.packages : null)
		.catch(() => null);
}

function getMihomoStatus() {
	return fs.exec_direct(MIHOMO_PACKAGE_HELPER, [ 'status' ], 'json')
		.then(result => result && result.ok !== false ? result : null)
		.catch(() => null);
}

function restartNetifd() {
	return fs.exec_direct(NETWORK_RESTART_HELPER, [], 'json').then(result => {
		if (!result || result.ok !== true)
			throw new Error(result && result.error || _('The network service did not restart.'));
		return result;
	});
}

return view.extend({
	load() {
		/* Read installed and available state in one batched lookup. Repository
		 * indexes are refreshed only when the user actually starts an install. */
		return Promise.all([ getPackageStatus(), getMihomoStatus() ]);
	},

	render(data) {
		const initialStatus = Array.isArray(data) ? data[0] : data;
		this.packageStatus = initialStatus;
		this.externalStatus = { mihomo: Array.isArray(data) ? data[1] : null };
		this.packageAvailabilityKnown = !!initialStatus;
		this.packageOperationInProgress = 0;
		this.packageStatusRefreshPending = false;
		this.packageIndexRefresh = null;
		this.installedNames = {};
		Object.entries(initialStatus || {}).forEach(([ name, state ]) => {
			if (state && state.installed)
				this.installedNames[name] = true;
		});
		this.focusedAppId = requestedAppId();
		this.focusedAppScrolled = false;
		this.magiTrickleOfferShown = false;
		const focused = catalogItem(this.focusedAppId);
		this.activeFilter = focused ? this.itemTier(focused.item, focused.group) : 'recommended';
		this.appTabs = {};
		this.appsCatalog = E('div', {
			id: 'fn-apps-catalog',
			class: 'fn-apps-catalog',
			role: 'tabpanel',
			tabindex: '0',
			'aria-live': 'polite',
			'aria-labelledby': 'fn-app-tab-recommended'
		});
		this.renderCatalog();
		window.setTimeout(() => this.focusRequestedItem(), 0);
		return E('div', { class: 'fn-dash' }, [
			E('div', { class: 'fn-card', style: 'grid-column: 1 / -1' }, [
				E('div', { class: 'fn-card-head' }, [ E('h3', {}, _('Applications')) ]),
				E('div', { class: 'fn-card-body' }, [
					E('p', { class: 'fn-info-empty fn-apps-intro' }, _('Install additional features on demand. Recommended features are suitable for most routers; Advanced networking tools can change traffic processing and are intended for experienced users. Packages come from the router\'s configured repositories.')),
					this.renderTabs(),
					this.appsCatalog
				])
			])
		]);
	},

	focusRequestedItem(attempt) {
		if (this.focusedAppScrolled || !this.focusedAppRow)
			return;
		attempt = attempt || 0;
		if (!this.focusedAppRow.isConnected) {
			if (attempt < 40)
				window.setTimeout(() => this.focusRequestedItem(attempt + 1), 50);
			return;
		}
		this.focusedAppScrolled = true;
		this.focusedAppRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
		this.focusedAppRow.focus({ preventScroll: true });
	},

	refreshPackageStatus() {
		return getPackageStatus().then(status => {
			if (status) {
				this.packageStatus = status;
				this.packageAvailabilityKnown = true;
			}
			return getMihomoStatus().then(external => {
				this.externalStatus = { mihomo: external };
				if (this.packageOperationInProgress)
					this.packageStatusRefreshPending = true;
				else
					this.renderCatalog();
			});
		}).catch(() => null);
	},

	ensurePackageIndexes() {
		if (!this.packageIndexRefresh) {
			this.packageIndexRefresh = updatePackageIndexes().catch(error => {
				this.packageIndexRefresh = null;
				throw error;
			});
		}
		return this.packageIndexRefresh;
	},

	renderTabs() {
		const tabList = E('div', {
			class: 'fn-apps-tabs',
			role: 'tablist',
			'aria-label': _('Application filters')
		});

		APP_FILTERS.forEach(filter => {
			const button = E('button', {
				type: 'button',
				class: 'fn-apps-tab' + (filter.id === this.activeFilter ? ' fn-apps-tab-active' : ''),
				role: 'tab',
				id: 'fn-app-tab-' + filter.id,
				'aria-controls': 'fn-apps-catalog',
				'aria-selected': filter.id === this.activeFilter ? 'true' : 'false',
				tabindex: filter.id === this.activeFilter ? '0' : '-1',
				click: () => this.selectFilter(filter.id),
				keydown: event => this.handleTabKeydown(event, filter.id)
			}, filter.label);
			this.appTabs[filter.id] = button;
			tabList.appendChild(button);
		});

		return tabList;
	},

	handleTabKeydown(event, currentFilter) {
		const filters = APP_FILTERS.map(filter => filter.id);
		let index = filters.indexOf(currentFilter);
		if (index < 0)
			return;

		if (event.key === 'ArrowRight' || event.key === 'ArrowDown')
			index = (index + 1) % filters.length;
		else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp')
			index = (index + filters.length - 1) % filters.length;
		else if (event.key === 'Home')
			index = 0;
		else if (event.key === 'End')
			index = filters.length - 1;
		else
			return;

		event.preventDefault();
		this.selectFilter(filters[index], true);
	},

	selectFilter(filter, focusTab) {
		if (!APP_FILTERS.some(item => item.id === filter))
			return;
		this.activeFilter = filter;
		this.appsCatalog.setAttribute('aria-labelledby', 'fn-app-tab-' + filter);
		Object.keys(this.appTabs).forEach(id => {
			this.appTabs[id].classList.toggle('fn-apps-tab-active', id === filter);
			this.appTabs[id].setAttribute('aria-selected', id === filter ? 'true' : 'false');
			this.appTabs[id].tabIndex = id === filter ? 0 : -1;
		});
		this.renderCatalog();
		const active = this.appTabs[filter];
		if (focusTab && active && typeof active.focus === 'function')
			active.focus();
	},

	itemTier(item, group) {
		return item.tier || (group && group.tier) || 'recommended';
	},

	itemInstalledPackageSet(item) {
		return packageSets(item).find(set => set.length && set.every(p => this.installedNames[p])) || null;
	},

	itemPackageSetAvailable(item, set) {
		return set.length && set.every(p => {
			const status = this.packageStatus && this.packageStatus[p];
			return this.installedNames[p] || (status && (status.available || status.installed));
		});
	},

	itemInstallPackageSet(item) {
		const installed = this.itemInstalledPackageSet(item);
		if (installed)
			return installed;
		return packageSets(item).find(set => this.itemPackageSetAvailable(item, set)) ||
			packageSets(item)[packageSets(item).length - 1] || [];
	},

	itemUsesInstallHelper(item, set) {
		return !!item.installHelper && packageSets(item)[item.installHelperSet || 0] === set;
	},

	itemConfigurePath(item) {
		if (item.customStatus && this.itemExisting(item))
			return item.nativeConfigurePath || null;
		if (item.customStatus && this.itemInstalled(item))
			return item.configurePath;
		const installed = this.itemInstalledPackageSet(item);
		const native = packageSets(item)[0];
		return installed && item.nativeConfigurePath && installed === native
			? item.nativeConfigurePath : item.configurePath;
	},

	itemConfigureUrl(item) {
		return item && item.configureUrlPort ? serviceUrl(item.configureUrlPort) : null;
	},

	itemInstalled(item) {
		if (item.customStatus && this.externalStatus && this.externalStatus[item.customStatus])
			return !!this.externalStatus[item.customStatus].installed;
		return !!this.itemInstalledPackageSet(item);
	},

	itemExisting(item) {
		if (item.customStatus && this.externalStatus && this.externalStatus[item.customStatus])
			return !this.itemInstalled(item) && !!this.externalStatus[item.customStatus].existing;
		return false;
	},

	itemPresent(item) {
		return this.itemInstalled(item) || this.itemExisting(item);
	},

	removablePackages(item) {
		if (item.customStatus)
			return [];
		const installedSet = this.itemInstalledPackageSet(item);
		if (!installedSet)
			return [];
		const needed = {};
		GROUPS.forEach(group => group.items.forEach(other => {
			if (other.id !== item.id) {
				const otherSet = this.itemInstalledPackageSet(other);
				if (otherSet)
					otherSet.forEach(name => { needed[name] = true; });
			}
		}));
		return installedSet.filter(name => !needed[name]);
	},

	itemMatchesFilter(item, group) {
		switch (this.activeFilter) {
		case 'advanced':
			return this.itemTier(item, group) === 'advanced';
		case 'installed':
			return this.itemPresent(item);
		case 'all':
			return true;
		default:
			return this.itemTier(item, group) === 'recommended';
		}
	},

	renderCatalog() {
		if (!this.appsCatalog)
			return;

		const groups = GROUPS.map(group => {
			const items = group.items.filter(item => this.itemMatchesFilter(item, group));
			return items.length ? this.renderGroup(group, items) : null;
		}).filter(Boolean);
		const content = [];

		if (this.activeFilter === 'advanced')
			content.push(E('div', { class: 'fn-apps-advanced-note', role: 'note' }, [
				E('strong', {}, _('Advanced networking tools')),
				E('span', {}, _('These packages can change routing, DNS, firewall rules or traffic processing. Install them only when you understand their interaction with the current network setup.'))
			]));

		if (groups.length)
			content.push(...groups);
		else {
			const message = this.activeFilter === 'installed'
				? _('No applications are installed yet.')
				: this.activeFilter === 'advanced'
					? _('No advanced networking tools are available in the current catalog.')
					: _('No applications are available in the current catalog.');
			content.push(E('div', { class: 'fn-apps-empty' }, message));
		}

		dom_empty(this.appsCatalog);
		content.forEach(node => this.appsCatalog.appendChild(node));
		if (this.focusedAppRow && this.focusedAppRow.isConnected) {
			this.focusedAppScrolled = false;
			window.setTimeout(() => this.focusRequestedItem(), 0);
		}
	},

	renderGroup(group, items) {
		items = items || group.items;
		return E('div', { class: 'fn-apps-group' }, [
			E('h4', { class: 'fn-mn-subhead' }, group.title),
			E('div', { class: 'fn-apps-list' }, items.map(item => this.renderItem(item, group)))
		]);
	},

	renderItem(item, group) {
		const focused = item.id === this.focusedAppId;
		const installed = this.itemInstalled(item);
		const existing = this.itemExisting(item);
		const availableSet = !installed && this.packageAvailabilityKnown
			? packageSets(item).find(set => this.itemPackageSetAvailable(item, set)) : null;
		const unavailablePackages = !installed && !availableSet && !item.externallyAvailable && this.packageAvailabilityKnown
			? (packageSets(item)[0] || []).filter(p => {
				const status = this.packageStatus[p];
				return !this.installedNames[p] && !(status && (status.available || status.installed));
			}) : [];
		const unavailable = unavailablePackages.length > 0;

		const statusPill = E('span', { class: 'fn-status-pill ' + (installed ? 'fn-status-ok' : existing ? 'fn-status-warn' : unavailable ? 'fn-status-unavailable' : 'fn-status-off') },
			installed ? _('Installed') : existing ? _('Installed outside Freenetic') : unavailable ? _('Unavailable') : _('Not installed'));

		const buttonAttrs = {
			type: 'button',
			class: 'fn-settings-btn' + (installed ? ' fn-settings-btn-danger' : ' fn-settings-btn-primary')
		};
		if (unavailable || existing) {
			buttonAttrs.disabled = true;
			buttonAttrs.title = existing
				? _('Mihomo is already installed outside Freenetic. Use the existing LuCI interface or remove it first.')
				: _('Required package(s) are unavailable for this firmware: %s.').format(unavailablePackages.join(', '));
		}
		const btn = E('button', buttonAttrs,
			installed ? _('Remove') : existing ? _('Managed elsewhere') : unavailable ? _('Unavailable') : _('Install'));
		const description = unavailable
			? _('%s Required package(s) are unavailable for this firmware: %s.').format(item.desc, unavailablePackages.join(', '))
			: item.desc;

		const nameParts = [ E('span', {}, item.name) ];
		if (this.itemTier(item, group) === 'advanced')
			nameParts.push(E('span', { class: 'fn-apps-tier fn-apps-tier-advanced' }, _('Advanced')));

		const actions = [ btn ];
		const configurePath = this.itemConfigurePath(item);
		const configureUrl = this.itemConfigureUrl(item);
		if ((installed || existing) && (configurePath || configureUrl)) {
			const configureAttrs = {
				class: 'fn-settings-btn fn-settings-btn-primary',
				href: configureUrl || (configurePath ? L.url.apply(L, configurePath) : '#')
			};
			if (configureUrl) {
				configureAttrs.target = '_blank';
				configureAttrs.rel = 'noopener';
			}
			actions.unshift(E('a', {
				...configureAttrs
			}, configureUrl ? _('Open interface') : _('Configure')));
		}

		const row = E('div', {
			id: 'fn-app-' + item.id,
			class: 'fn-apps-row' + (focused ? ' fn-apps-row-focused' : ''),
			tabindex: focused ? '-1' : null
		}, [
			svgIcon('M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5', 22),
			E('div', { class: 'fn-apps-info' }, [
				E('div', { class: 'fn-apps-name' }, nameParts),
				E('div', { class: 'fn-apps-desc' }, description)
			]),
			statusPill,
			E('div', { class: 'fn-apps-actions' }, actions)
		]);
		if (focused)
			this.focusedAppRow = row;

		if (!unavailable && !existing) {
			btn.addEventListener('click', () => {
				if (!installed && item.id === 'mwan3')
					this.confirmMwanInstall(item, btn, statusPill, row);
				else
					this.toggleItem(item, installed, btn, statusPill, row);
			});
		}

		return row;
	},

	shouldOfferMagiTrickle(item, wasInstalled) {
		if (wasInstalled || !item || MAGITRICKLE_SUGGESTION_IDS.indexOf(item.id) < 0 || this.magiTrickleOfferShown)
			return false;
		const entry = catalogItem('magitrickle');
		return !!(entry && !this.itemInstalled(entry.item));
	},

	offerMagiTrickle() {
		const entry = catalogItem('magitrickle');
		if (!entry || this.itemInstalled(entry.item) || this.magiTrickleOfferShown)
			return;
		this.magiTrickleOfferShown = true;
		ui.showModal(_('Install MagiTrickle?'), [
			E('p', {}, _('MagiTrickle routes selected domains through Mihomo or a VPN tunnel without routing the whole network.')),
			E('p', {}, _('Its own web interface will be available on port 8080 after installation.')),
			E('div', { class: 'button-row' }, [
				E('button', { class: 'btn', click: ui.hideModal }, _('Later')),
				E('button', {
					class: 'btn cbi-button-positive',
					click: () => {
						ui.hideModal();
						this.activeFilter = 'advanced';
						this.focusedAppId = 'magitrickle';
						this.focusedAppScrolled = false;
						this.renderCatalog();
						window.setTimeout(() => {
							const row = this.appsCatalog && this.appsCatalog.querySelector('#fn-app-magitrickle');
							const install = row && row.querySelector('button.fn-settings-btn-primary');
							if (install)
								install.click();
						}, 0);
					}
				}, _('Install MagiTrickle'))
			])
		]);
	},

	confirmMwanInstall(item, btn, statusPill, row) {
		ui.showModal(_('Install Multi-WAN?'), [
			E('p', {}, _('Multi-WAN adds routing rules and restarts the LuCI session while it is being installed.')),
			E('p', {}, _('After installation you will be signed out once. Sign in again to continue.')),
			E('div', { class: 'button-row' }, [
				E('button', { class: 'btn', click: ui.hideModal }, _('Cancel')),
				E('button', {
					class: 'btn cbi-button-positive',
					click: () => {
						ui.showModal(_('Installing Multi-WAN…'), [
							E('p', { class: 'spinning' }, _('The package manager is preparing Multi-WAN. The page will reopen when LuCI is ready.'))
						]);
						this.toggleItem(item, false, btn, statusPill, row);
					}
				}, _('Install Multi-WAN'))
			])
		]);
	},

	toggleItem(item, wasInstalled, btn, statusPill, row) {
		const action = wasInstalled ? 'remove' : 'install';
		const offerMagiTrickle = this.shouldOfferMagiTrickle(item, wasInstalled);
		const installSet = wasInstalled ? null : this.itemInstallPackageSet(item);
		const useInstallHelper = !!item.installHelper && (wasInstalled || this.itemUsesInstallHelper(item, installSet));
		const operationPackages = item.customStatus ? [] : (wasInstalled ? this.removablePackages(item) : installSet.slice());
		this.packageOperationInProgress++;
		btn.disabled = true;
		dom_content(btn, wasInstalled ? _('Removing…') : _('Installing…'));

		let mwanInstallTimer = null;
		const run = () => {
			if (useInstallHelper)
				return fs.exec_direct(item.installHelper, [ action ], 'json');
			if (!operationPackages.length)
				return Promise.resolve({ code: 0 });
			if (!wasInstalled && item.id === 'mwan3' && typeof window !== 'undefined')
				mwanInstallTimer = window.setTimeout(() => window.location.reload(), 10000);
			return fs.exec_direct(PACKAGE_MANAGER_HELPER, [ action ].concat(operationPackages), 'json');
		};
		const prepareRemoval = wasInstalled && item.id === 'mwan3'
			? fs.exec_direct(TAILSCALE_RECOVERY_HELPER, [ 'schedule' ], 'json').catch(() => null)
			: Promise.resolve(null);
		const operation = wasInstalled ? prepareRemoval.then(run) : useInstallHelper ? run() : this.ensurePackageIndexes().then(run);
		if (wasInstalled && item.id === 'mwan3' && typeof window !== 'undefined')
			window.setTimeout(() => window.location.reload(), 12000);

		return operation.then(res => {
			if (!res || res.code !== 0) {
				if (mwanInstallTimer !== null && typeof window !== 'undefined')
					window.clearTimeout(mwanInstallTimer);
				if (!wasInstalled && item.id === 'mwan3')
					ui.hideModal();
				const detail = (res && (res.stderr || res.stdout)) || _('unknown error');
				notify(_('Failed to %s %s: %s').format(wasInstalled ? _('remove') : _('install'), item.name, detail), 'danger');
				btn.disabled = false;
				dom_content(btn, wasInstalled ? _('Remove') : _('Install'));
				return;
			}

			operationPackages.forEach(p => {
				if (wasInstalled)
					delete this.installedNames[p];
				else
					this.installedNames[p] = true;
			});
			const refreshExternal = item.customStatus
				? getMihomoStatus().then(status => {
					this.externalStatus[item.customStatus] = status;
				}).catch(() => null)
				: Promise.resolve();
			const restart = operationPackages.length && item.restartNetifdOnInstall
				? restartNetifd().then(() => ({ ok: true })).catch(error => ({ ok: false, error: error }))
				: Promise.resolve({ ok: true });

			return Promise.all([ refreshExternal, restart ]).then(results => {
				const networkResult = results[1];
				const nowInstalled = this.itemInstalled(item);
				if (wasInstalled && nowInstalled)
					notify(_('%s is still installed because its packages are required by another installed application.').format(item.name), 'warning');
				else if (wasInstalled && !networkResult.ok)
					notify(_('%s removed, but the network service could not be restarted: %s').format(item.name, networkResult.error && networkResult.error.message || networkResult.error || _('unknown error')), 'warning');
				else if (wasInstalled)
					notify(_('%s removed.').format(item.name), 'info');
				else if (networkResult.ok)
					notify(item.restartNetifdOnInstall
						? _('%s installed. Network service restarted.').format(item.name)
						: _('%s installed.').format(item.name), 'info');
				else
					notify(_('%s installed, but the network service could not be restarted: %s Reboot the router before using this feature.').format(item.name, networkResult.error && networkResult.error.message || networkResult.error || _('unknown error')), 'warning');

				statusPill.className = 'fn-status-pill ' + (nowInstalled ? 'fn-status-ok' : 'fn-status-off');
				dom_content(statusPill, nowInstalled ? _('Installed') : _('Not installed'));
				btn.className = 'fn-settings-btn' + (nowInstalled ? ' fn-settings-btn-danger' : ' fn-settings-btn-primary');
				btn.disabled = false;
				dom_content(btn, nowInstalled ? _('Remove') : _('Install'));
				/* Rebuild cards with a configuration action after installation so
				 * their click handlers and action set reflect the new package state. */
				if (this.activeFilter === 'installed' || item.configurePath || item.configureUrlPort)
					this.renderCatalog();
				if (offerMagiTrickle && typeof window !== 'undefined')
					window.setTimeout(() => this.offerMagiTrickle(), 0);
			});
		}).catch(err => {
			/* Installing mwan3 intentionally restarts rpcd. Its in-flight RPC call
			 * may reject even though apk succeeded; keep the progress modal and let
			 * the armed reload open the fresh login session. */
			if (!wasInstalled && item.id === 'mwan3' && mwanInstallTimer !== null)
				return;
			notify(_('Failed to %s %s: %s').format(wasInstalled ? _('remove') : _('install'), item.name, err.message || err), 'danger');
			btn.disabled = false;
			dom_content(btn, wasInstalled ? _('Remove') : _('Install'));
		}).then(() => {
			this.packageOperationInProgress = Math.max(0, this.packageOperationInProgress - 1);
			if (!this.packageOperationInProgress && this.packageStatusRefreshPending) {
				this.packageStatusRefreshPending = false;
				this.renderCatalog();
			}
		});
	},

	addFooter() { return E([]); }
});
