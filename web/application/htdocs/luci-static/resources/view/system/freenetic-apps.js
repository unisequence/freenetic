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
			{ id: 'l2tp_ipsec', name: _('L2TP/IPsec client'), packages: [ 'ppp-mod-pppol2tp', 'strongswan-swanctl' ],
				desc: _('L2TP over an IPsec-encrypted tunnel.') },
			{ id: 'openvpn', name: _('OpenVPN client and server'), packages: [ 'openvpn-openssl' ],
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
				{ id: 'pbr', name: _('Policy-based routing'), packages: [ 'pbr' ],
					desc: _('Route a network segment through a selected WAN or VPN tunnel.') },
			{ id: 'zapret', name: _('Zapret'), tier: 'advanced', restartNetifdOnInstall: true,
				packages: [ 'zapret' ],
				desc: _('Advanced traffic-processing tool for regional connectivity scenarios.') },
			{ id: 'magitrickle', name: _('MagiTrickle'), tier: 'advanced', restartNetifdOnInstall: true,
				packages: [ 'magitrickle' ],
				desc: _('Specialized traffic-routing and filtering tool for experienced users.') }
		]
	}
];

/* Keep the availability probe small.  The package manager's complete
 * list-available response is several megabytes on a normal snapshot, while
 * the catalog only needs to resolve the concrete names used by its cards. */
const APP_PACKAGE_NAMES = [];
const APP_PACKAGE_SEEN = {};
GROUPS.forEach(group => group.items.forEach(item => item.packages.forEach(name => {
	if (!APP_PACKAGE_SEEN[name]) {
		APP_PACKAGE_SEEN[name] = true;
		APP_PACKAGE_NAMES.push(name);
	}
})));

function getInstalled() {
	return fs.exec_direct('/usr/libexec/package-manager-call', [ 'list-installed' ], 'json')
		.then(list => Array.isArray(list) ? list : [])
		.catch(() => []);
}

function getPackageStatus() {
	return fs.exec_direct('/usr/libexec/freenetic-package-status', APP_PACKAGE_NAMES, 'json')
		.then(result => result && result.ok !== false && result.packages && typeof result.packages === 'object'
			? result.packages : null)
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
		/* Do not make the first paint wait for an availability probe.  apk has to
		 * scan every configured repository for that probe, which is noticeably
		 * slower than reading the installed package list on embedded hardware. */
		return getInstalled();
	},

	render(data) {
		const installed = Array.isArray(data) ? data : [];
		this.packageStatus = null;
		this.packageAvailabilityKnown = false;
		this.packageOperationInProgress = 0;
		this.packageStatusRefreshPending = false;
		this.installedNames = {};
		installed.forEach(p => { if (p && p.name) this.installedNames[p.name] = true; });
		this.activeFilter = 'recommended';
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
		/* Availability is only needed to explain missing packages.  Fetch it in
		 * the background after the catalog is visible, then refresh the cards once
		 * no install/remove operation is being edited. */
		this.refreshPackageStatus();

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

	refreshPackageStatus() {
		return getPackageStatus().then(status => {
			if (!status)
				return;

			this.packageStatus = status;
			this.packageAvailabilityKnown = true;
			if (this.packageOperationInProgress)
				this.packageStatusRefreshPending = true;
			else
				this.renderCatalog();
		});
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
				click: () => this.selectFilter(filter.id)
			}, filter.label);
			this.appTabs[filter.id] = button;
			tabList.appendChild(button);
		});

		return tabList;
	},

	selectFilter(filter) {
		if (!APP_FILTERS.some(item => item.id === filter))
			return;
		this.activeFilter = filter;
		this.appsCatalog.setAttribute('aria-labelledby', 'fn-app-tab-' + filter);
		Object.keys(this.appTabs).forEach(id => {
			this.appTabs[id].classList.toggle('fn-apps-tab-active', id === filter);
			this.appTabs[id].setAttribute('aria-selected', id === filter ? 'true' : 'false');
		});
		this.renderCatalog();
		const active = this.appTabs[filter];
		if (active && typeof active.focus === 'function')
			active.focus();
	},

	itemTier(item, group) {
		return item.tier || (group && group.tier) || 'recommended';
	},

	itemInstalled(item) {
		return item.packages.every(p => this.installedNames[p]);
	},

	itemMatchesFilter(item, group) {
		switch (this.activeFilter) {
		case 'advanced':
			return this.itemTier(item, group) === 'advanced';
		case 'installed':
			return this.itemInstalled(item);
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
	},

	renderGroup(group, items) {
		items = items || group.items;
		return E('div', { class: 'fn-apps-group' }, [
			E('h4', { class: 'fn-mn-subhead' }, group.title),
			E('div', { class: 'fn-apps-list' }, items.map(item => this.renderItem(item, group)))
		]);
	},

	renderItem(item, group) {
		const installed = this.itemInstalled(item);
		const unavailablePackages = !installed && this.packageAvailabilityKnown
			? item.packages.filter(p => {
				const status = this.packageStatus[p];
				return !this.installedNames[p] && !(status && (status.available || status.installed));
			}) : [];
		const unavailable = unavailablePackages.length > 0;

		const statusPill = E('span', { class: 'fn-status-pill ' + (installed ? 'fn-status-ok' : unavailable ? 'fn-status-unavailable' : 'fn-status-off') },
			installed ? _('Installed') : unavailable ? _('Unavailable') : _('Not installed'));

		const buttonAttrs = {
			type: 'button',
			class: 'fn-settings-btn' + (installed ? ' fn-settings-btn-danger' : ' fn-settings-btn-primary')
		};
		if (unavailable) {
			buttonAttrs.disabled = true;
			buttonAttrs.title = _('Required package(s) are unavailable for this firmware: %s.').format(unavailablePackages.join(', '));
		}
		const btn = E('button', buttonAttrs,
			installed ? _('Remove') : unavailable ? _('Unavailable') : _('Install'));
		const description = unavailable
			? _('%s Required package(s) are unavailable for this firmware: %s.').format(item.desc, unavailablePackages.join(', '))
			: item.desc;

		const nameParts = [ E('span', {}, item.name) ];
		if (this.itemTier(item, group) === 'advanced')
			nameParts.push(E('span', { class: 'fn-apps-tier fn-apps-tier-advanced' }, _('Advanced')));

		const row = E('div', { class: 'fn-apps-row' }, [
			svgIcon('M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5', 22),
			E('div', { class: 'fn-apps-info' }, [
				E('div', { class: 'fn-apps-name' }, nameParts),
				E('div', { class: 'fn-apps-desc' }, description)
			]),
			statusPill,
			btn
		]);

		if (!unavailable)
			btn.addEventListener('click', () => this.toggleItem(item, installed, btn, statusPill, row));

		return row;
	},

	toggleItem(item, wasInstalled, btn, statusPill, row) {
		const action = wasInstalled ? 'remove' : 'install';
		this.packageOperationInProgress++;
		btn.disabled = true;
		dom_content(btn, wasInstalled ? _('Removing…') : _('Installing…'));

		return fs.exec_direct('/usr/libexec/package-manager-call', [ action ].concat(item.packages), 'json').then(res => {
			if (!res || res.code !== 0) {
				const detail = (res && (res.stderr || res.stdout)) || _('unknown error');
				notify(_('Failed to %s %s: %s').format(wasInstalled ? _('remove') : _('install'), item.name, detail), 'danger');
				btn.disabled = false;
				dom_content(btn, wasInstalled ? _('Remove') : _('Install'));
				return;
			}

			const nowInstalled = !wasInstalled;
			const restart = nowInstalled && item.restartNetifdOnInstall
				? restartNetifd().then(() => ({ ok: true })).catch(error => ({ ok: false, error: error }))
				: Promise.resolve({ ok: true });

			return restart.then(networkResult => {
				item.packages.forEach(p => {
					if (nowInstalled)
						this.installedNames[p] = true;
					else
						delete this.installedNames[p];
				});

				if (!nowInstalled)
					notify(_('%s removed.').format(item.name), 'info');
				else if (networkResult.ok)
					notify(_('%s installed. Network service restarted.').format(item.name), 'info');
				else
					notify(_('%s installed, but the network service could not be restarted: %s Reboot the router before using this feature.').format(item.name, networkResult.error && networkResult.error.message || networkResult.error || _('unknown error')), 'warning');

				statusPill.className = 'fn-status-pill ' + (nowInstalled ? 'fn-status-ok' : 'fn-status-off');
				dom_content(statusPill, nowInstalled ? _('Installed') : _('Not installed'));
				btn.className = 'fn-settings-btn' + (nowInstalled ? ' fn-settings-btn-danger' : ' fn-settings-btn-primary');
				btn.disabled = false;
				dom_content(btn, nowInstalled ? _('Remove') : _('Install'));
				if (this.activeFilter === 'installed')
					this.renderCatalog();
			});
		}).catch(err => {
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
