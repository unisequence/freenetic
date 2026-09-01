'use strict';
'require view';
'require ui';
'require fs';

/* Applications ("Приложения"): a curated, Keenetic-style component catalog
   sitting on top of the router's real apk package manager — not a
   reimplementation of it. Every install/remove/list call goes through
   /usr/libexec/package-manager-call, the exact same backend script the
   stock Software page (luci-app-package-manager) already uses (see its own
   htdocs/luci-static/resources/view/package-manager.js), so this is the
   real package manager underneath, just presented as fixed feature cards
   instead of a raw searchable package list. */

function dom_empty(node) { while (node.firstChild) node.removeChild(node.firstChild); }
function dom_content(node, text) { dom_empty(node); node.appendChild(document.createTextNode(text)); }

const FADE_MS = 400;
function notify(message, type) {
	const timeout = (type === 'warning' || type === 'danger') ? 8000 : 4000;
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
		items: [
			{ id: 'wireguard', name: _('WireGuard VPN'), packages: [ 'wireguard-tools' ],
				desc: _('Modern, fast VPN client built into the Linux kernel.') },
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
		items: [
			{ id: 'dot_doh', name: _('DNS-over-HTTPS proxy'), packages: [ 'https-dns-proxy', 'luci-app-https-dns-proxy' ],
				desc: _('Encrypts outgoing DNS lookups.') },
			{ id: 'adblock', name: _('Ad blocking (Adblock)'), packages: [ 'adblock', 'luci-app-adblock' ],
				desc: _('Blocks ads and trackers for the whole network via DNS.') }
		]
	},
	{
		title: _('Files and media'),
		items: [
			{ id: 'samba', name: _('File server (Samba)'), packages: [ 'luci-app-samba4' ],
				desc: _('Share a USB drive as a network folder.') },
			{ id: 'dlna', name: _('DLNA server'), packages: [ 'minidlna', 'luci-app-minidlna' ],
				desc: _('Streams media from a USB drive to TVs and players.') }
		]
	}
];

function getInstalled() {
	return fs.exec_direct('/usr/libexec/package-manager-call', [ 'list-installed' ], 'json')
		.then(list => Array.isArray(list) ? list : [])
		.catch(() => []);
}

return view.extend({
	load() {
		return getInstalled();
	},

	render(installed) {
		this.installedNames = {};
		installed.forEach(p => { if (p && p.name) this.installedNames[p.name] = true; });

		const groups = GROUPS.map(group => this.renderGroup(group));

		return E('div', { class: 'fn-dash' }, [
			E('div', { class: 'fn-card', style: 'grid-column: 1 / -1' }, [
				E('div', { class: 'fn-card-head' }, [ E('h3', {}, _('Applications')) ]),
				E('div', { class: 'fn-card-body' }, [
					E('p', { class: 'fn-info-empty' }, _('Install additional features on demand. These install real packages from the router\'s configured repositories — an internet connection is required, and installing a feature whose kernel module isn\'t available for this device\'s firmware build will fail with an error.')),
					...groups
				])
			])
		]);
	},

	renderGroup(group) {
		return E('div', { class: 'fn-apps-group' }, [
			E('h4', { class: 'fn-mn-subhead' }, group.title),
			E('div', { class: 'fn-apps-list' }, group.items.map(item => this.renderItem(item)))
		]);
	},

	renderItem(item) {
		const installed = item.packages.every(p => this.installedNames[p]);

		const statusPill = E('span', { class: 'fn-status-pill ' + (installed ? 'fn-status-ok' : 'fn-status-off') },
			installed ? _('Installed') : _('Not installed'));

		const btn = E('button', {
			type: 'button',
			class: 'fn-settings-btn' + (installed ? ' fn-settings-btn-danger' : ' fn-settings-btn-primary')
		}, installed ? _('Remove') : _('Install'));

		const row = E('div', { class: 'fn-apps-row' }, [
			svgIcon('M12 2 2 7l10 5 10-5-10-5ZM2 17l10 5 10-5M2 12l10 5 10-5', 22),
			E('div', { class: 'fn-apps-info' }, [
				E('div', { class: 'fn-apps-name' }, item.name),
				E('div', { class: 'fn-apps-desc' }, item.desc)
			]),
			statusPill,
			btn
		]);

		btn.addEventListener('click', () => this.toggleItem(item, installed, btn, statusPill, row));

		return row;
	},

	toggleItem(item, wasInstalled, btn, statusPill, row) {
		const action = wasInstalled ? 'remove' : 'install';
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
			item.packages.forEach(p => {
				if (nowInstalled)
					this.installedNames[p] = true;
				else
					delete this.installedNames[p];
			});

			notify(nowInstalled ? _('%s installed.').format(item.name) : _('%s removed.').format(item.name), 'info');

			statusPill.className = 'fn-status-pill ' + (nowInstalled ? 'fn-status-ok' : 'fn-status-off');
			dom_content(statusPill, nowInstalled ? _('Installed') : _('Not installed'));
			btn.className = 'fn-settings-btn' + (nowInstalled ? ' fn-settings-btn-danger' : ' fn-settings-btn-primary');
			btn.disabled = false;
			dom_content(btn, nowInstalled ? _('Remove') : _('Install'));
		}).catch(err => {
			notify(_('Failed to %s %s: %s').format(wasInstalled ? _('remove') : _('install'), item.name, err.message || err), 'danger');
			btn.disabled = false;
			dom_content(btn, wasInstalled ? _('Remove') : _('Install'));
		});
	},

	addFooter() { return E([]); }
});
