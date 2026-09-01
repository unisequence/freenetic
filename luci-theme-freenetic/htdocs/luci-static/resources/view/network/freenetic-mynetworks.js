'use strict';
'require view';
'require ui';
'require uci';
'require fs';

/* Reads go through a hand-rolled ubusCall (see freenetic-dashboard.js for
   why); writes go through the real 'uci' module, same as the guest-network
   flow there and the Client List register/block actions. */
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

/* uci.apply() fails with ubus code 5 (NO_DATA) when uci.save() found nothing
   actually changed (e.g. Save clicked with no edits) — there's simply
   nothing staged to apply, which isn't a real failure. */
function applyChanges() {
	return uci.apply().catch(err => {
		if (err && /code 5/.test(err.message))
			return;
		throw err;
	}).then(() => ui.changes.init());
}

function getWirelessConfig() {
	return ubusCall('uci', 'get', { config: 'wireless' }).then(r => r.values || {});
}

/* Resolves each uci wifi-device section to its live iwinfo device name
   (e.g. 'radio0' -> 'phy0-ap0') the same way the Dashboard does, so the
   Advanced Settings panel below can query real hardware capabilities
   (iwinfo info/txpowerlist/freqlist) instead of guessing them. */
function getWifiRadios(wireless) {
	const radios = Object.keys(wireless).map(k => wireless[k]).filter(s => s['.type'] === 'wifi-device');
	return Promise.all([
		ubusCall('iwinfo', 'devices').then(r => r.devices || []).catch(() => []),
		Promise.all(radios.map(r =>
			ubusCall('iwinfo', 'phyname', { section: r['.name'] }).then(p => p.phyname).catch(() => null)))
	]).then(([activeDevices, phynames]) => radios.map((r, i) => {
		const phy = phynames[i];
		const dev = phy ? activeDevices.find(d => d.indexOf(phy + '-') === 0) : null;
		return { name: r['.name'], device: dev || null };
	}));
}

/* Per-radio hardware capability data for the Advanced Settings panel:
   which channel widths the chip actually supports (info.htmodes), which
   channels exist for this band (freqlist), and which tx power steps the
   driver exposes (txpowerlist) — all read straight from iwinfo rather than
   hardcoded, so this adapts to whatever radio is actually installed. */
function getRadioAdvanced(radios) {
	return Promise.all(radios.map(r => {
		if (!r.device)
			return Promise.resolve({ name: r.name, device: null, info: {}, txpowerlist: [], freqlist: [], countrylist: [] });
		return Promise.all([
			ubusCall('iwinfo', 'info', { device: r.device }).catch(() => ({})),
			ubusCall('iwinfo', 'txpowerlist', { device: r.device }).then(x => x.results || []).catch(() => []),
			ubusCall('iwinfo', 'freqlist', { device: r.device }).then(x => x.results || []).catch(() => []),
			ubusCall('iwinfo', 'countrylist', { device: r.device }).then(x => x.results || []).catch(() => [])
		]).then(([info, txpowerlist, freqlist, countrylist]) => ({ name: r.name, device: r.device, info, txpowerlist, freqlist, countrylist }));
	})).then(list => {
		const map = {};
		list.forEach(x => { map[x.name] = x; });
		return map;
	});
}

function getNetworkConfig() {
	return ubusCall('uci', 'get', { config: 'network' }).then(r => r.values || {}).catch(() => ({}));
}

function getDhcpConfig() {
	return ubusCall('uci', 'get', { config: 'dhcp' }).then(r => r.values || {}).catch(() => ({}));
}

/* Full /4-/30 range, like Keenetic's subnet mask dropdown. */
function cidrToMask(bits) {
	const n = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
	return [ (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255 ].join('.');
}
const MASKS = [];
for (let bits = 4; bits <= 30; bits++)
	MASKS.push([ cidrToMask(bits), '/' + bits ]);

function ip2int(ip) {
	const p = (ip || '').split('.').map(Number);
	return p.length === 4 && p.every(n => n >= 0 && n <= 255) ? ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0 : null;
}
function int2ip(n) {
	return [ (n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255 ].join('.');
}
function maskBits(mask) {
	const n = ip2int(mask);
	if (n == null) return 24;
	let bits = 0;
	for (let i = 31; i >= 0 && (n & (1 << i)); i--) bits++;
	return bits;
}

/* dhcp.<if>.start/limit are an offset (and count) from the network's base
   address, not full addresses — Keenetic shows the resolved first/last pool
   address instead, so translate between the two for display and back on save. */
function poolStartToAddress(ipaddr, netmask, start) {
	const base = ip2int(ipaddr), m = ip2int(netmask);
	if (base == null || m == null) return '';
	const net = (base & m) >>> 0;
	return int2ip((net + (parseInt(start, 10) || 0)) >>> 0);
}
function addressToPoolStart(ipaddr, netmask, addr) {
	const base = ip2int(ipaddr), m = ip2int(netmask), a = ip2int(addr);
	if (base == null || m == null || a == null) return 100;
	const net = (base & m) >>> 0;
	return Math.max(0, (a - net) >>> 0);
}

/* dnsmasq's dhcp-leasetime takes a bare integer as seconds, or a number with
   an h/m/d suffix — Keenetic always shows/edits plain seconds. */
function parseLeaseSeconds(v) {
	if (!v) return 43200;
	const m = /^(\d+)([smhd]?)$/.exec(String(v).trim());
	if (!m) return 43200;
	const n = parseInt(m[1], 10);
	switch (m[2]) {
	case 'm': return n * 60;
	case 'h': return n * 3600;
	case 'd': return n * 86400;
	default: return n;
	}
}

/* Router/DNS overrides live as "list dhcp_option '3,<gw>'" / "'6,<dns...>'"
   entries (dnsmasq option codes) rather than dedicated uci options. */
function parseDhcpOptions(dhcpSec) {
	const list = Array.isArray(dhcpSec.dhcp_option) ? dhcpSec.dhcp_option : (dhcpSec.dhcp_option ? [ dhcpSec.dhcp_option ] : []);
	let gateway = '', dns = [];
	list.forEach(entry => {
		const parts = String(entry).split(',');
		if (parts[0] === '3' && parts[1]) gateway = parts[1];
		if (parts[0] === '6') dns = parts.slice(1);
	});
	return { list, gateway, dns };
}
function buildDhcpOptionList(existingList, gateway, dns) {
	const kept = existingList.filter(e => {
		const code = String(e).split(',')[0];
		return code !== '3' && code !== '6';
	});
	if (gateway) kept.push('3,' + gateway);
	const dnsList = dns.filter(Boolean);
	if (dnsList.length) kept.push('6,' + dnsList.join(','));
	return kept;
}

/* uci's ubus 'set' rejects an empty array for a list option (code 2,
   EINVAL) — clear it with 'unset' instead of setting []. */
function applyDhcpOptions(config, section, existingList, gateway, dns) {
	const list = buildDhcpOptionList(existingList, gateway, dns);
	if (list.length)
		uci.set(config, section, 'dhcp_option', list);
	else
		uci.unset(config, section, 'dhcp_option');
}

function eyeIcon() {
	const span = E('span', {});
	span.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
	return span;
}

/* Resolves a wifi card's effective SSID/security/key, following the "same
   as 2.4 GHz" link on the 5 GHz card when it's checked. */
function effectiveWifi(card) {
	if (card.linkInput && card.linkInput.checked && card.linkedFrom) {
		const src = card.linkedFrom;
		return { ssid: src.ssidInput.value.trim(), enc: src.secSelect.value, key: src.pwInput.value };
	}
	return { ssid: card.ssidInput.value.trim(), enc: card.secSelect.value, key: card.pwInput.value };
}

/* Keeps the sidebar's "Home network" / "Guest network" entries in sync with
   the in-page tab, the way Keenetic's own segment tabs and sidebar move
   together — no full navigation happens, so the sidebar's own render-time
   active-state logic (menu-freenetic.js) never re-runs on its own. */
function sidebarLinkFor(kind) {
	const href = L.url('admin', 'network', kind === 'guest' ? 'guest_network' : 'home_network');
	return document.querySelector('#sidebar-menu a[href="' + href + '"]');
}
function syncSidebar(kind) {
	[ 'home', 'guest' ].forEach(k => {
		const a = sidebarLinkFor(k);
		if (a && a.parentElement)
			a.parentElement.classList.toggle('fn-active', k === kind);
	});
}

function passwordField(value) {
	const input = E('input', { type: 'password', class: 'fn-input', value: value || '', placeholder: _('Password (min. 8 characters)') });
	const toggle = E('button', { type: 'button', class: 'fn-eye-toggle', 'aria-label': _('Show password') }, eyeIcon());
	toggle.addEventListener('click', () => { input.type = input.type === 'password' ? 'text' : 'password'; });
	return { wrap: E('div', { class: 'fn-field fn-field-password fn-mn-password' }, [ input, toggle ]), input };
}

return view.extend({
	load() {
		return getWirelessConfig().then(wireless =>
			getWifiRadios(wireless).then(radios =>
				getRadioAdvanced(radios).then(radioAdv => Promise.all([
					wireless,
					getNetworkConfig(),
					getDhcpConfig(),
					fs.stat('/etc/config/avahi').then(() => true).catch(() => false),
					radioAdv
				]))));
	},

	render(data) {
		const wireless = data[0], network = data[1], dhcp = data[2];
		this.hasAvahi = data[3];
		this.radioAdv = data[4];

		const initialTab = L.env.requestpath[2] === 'guest_network' ? 'guest' : 'home';

		const homePanel = this.renderSegmentPanel('home', 'lan', wireless, network, dhcp);
		const guestPanel = this.renderSegmentPanel('guest', 'guest', wireless, network, dhcp);

		const homeTab = E('button', { type: 'button', class: 'fn-tab' + (initialTab === 'home' ? ' fn-active' : '') }, _('Home network'));
		const guestTab = E('button', { type: 'button', class: 'fn-tab' + (initialTab === 'guest' ? ' fn-active' : '') }, _('Guest network'));

		homePanel.hidden = initialTab !== 'home';
		guestPanel.hidden = initialTab !== 'guest';

		const showTab = (kind, pushUrl) => {
			homeTab.classList.toggle('fn-active', kind === 'home');
			guestTab.classList.toggle('fn-active', kind === 'guest');
			homePanel.hidden = kind !== 'home';
			guestPanel.hidden = kind !== 'guest';
			syncSidebar(kind);
			if (pushUrl)
				history.pushState({ fnTab: kind }, '', L.url('admin', 'network', kind === 'guest' ? 'guest_network' : 'home_network'));
		};

		homeTab.addEventListener('click', () => showTab('home', true));
		guestTab.addEventListener('click', () => showTab('guest', true));
		window.addEventListener('popstate', (ev) => showTab(ev.state && ev.state.fnTab === 'guest' ? 'guest' : 'home', false));
		history.replaceState({ fnTab: initialTab }, '', location.href);

		return E('div', { class: 'fn-dash' }, [
			E('div', { class: 'fn-dash-col fn-mn-col' }, [
				E('div', { class: 'fn-card' }, [
					E('div', { class: 'fn-card-head' }, [ E('h3', {}, _('My Networks & Wi-Fi')) ]),
					E('div', { class: 'fn-card-body' }, [
						E('p', { class: 'fn-info-empty' }, _('Splitting your network into segments improves security and lets you tune each one independently.')),
						E('div', { class: 'fn-tabs' }, [ homeTab, guestTab ]),
						homePanel,
						guestPanel
					])
				])
			])
		]);
	},

	renderSegmentPanel(kind, ifaceName, wireless, network, dhcp) {
		const isGuest = kind === 'guest';
		const net = network[ifaceName] || {};
		const dhcpSec = dhcp[ifaceName] || {};

		const radios = Object.keys(wireless).map(k => wireless[k]).filter(s => s['.type'] === 'wifi-device');
		const ifaces = Object.keys(wireless).map(k => wireless[k]).filter(s =>
			s['.type'] === 'wifi-iface' && (s.mode || 'ap') === 'ap' && ((s.network || 'lan') === ifaceName || (isGuest && s.network === 'guest')));

		const nameInput = E('input', { type: 'text', class: 'fn-input', value: net.label || (isGuest ? _('Guest network') : _('Home network')) });

		const wifiCards = radios.map(radio =>
			this.renderWifiCard(radio, ifaces.find(i => i.device === radio['.name']), isGuest, this.radioAdv[radio['.name']]));

		const card24 = wifiCards.find(c => c.band === '2.4 GHz');
		const card5 = wifiCards.find(c => c.band === '5 GHz');
		if (card24 && card5)
			this.linkWifiCard(card5, card24);

		/* network.<if>.ipaddr can be a plain string or (OpenWrt 21+, multiple
		   addresses) a list of "addr/cidr" strings — normalize to one dotted
		   address and split off any embedded /cidr into the mask select. */
		let rawIpaddr = Array.isArray(net.ipaddr) ? net.ipaddr[0] : net.ipaddr;
		let netmask = net.netmask;
		if (rawIpaddr && rawIpaddr.indexOf('/') !== -1) {
			const parts = rawIpaddr.split('/');
			rawIpaddr = parts[0];
			if (!netmask) {
				const known = MASKS.find(m => m[1] === '/' + parts[1]);
				netmask = known ? known[0] : '255.255.255.0';
			}
		}

		netmask = netmask || '255.255.255.0';
		const baseIp = rawIpaddr || (isGuest ? '192.168.3.1' : '192.168.1.1');
		const ipaddrInput = E('input', { type: 'text', class: 'fn-input', value: baseIp });
		const maskSelect = E('select', { class: 'fn-input' }, MASKS.map(m =>
			E('option', { value: m[0], selected: netmask === m[0] ? true : null }, m[0] + ' (' + m[1] + ')')));

		const mdnsInput = E('input', { type: 'checkbox', disabled: this.hasAvahi ? null : true });
		const mdnsRow = E('label', { class: 'fn-mn-checkbox-row', title: this.hasAvahi ? '' : _('Requires the avahi-daemon package (not installed).') }, [
			mdnsInput, ' ', _('Relay mDNS'),
			E('div', { class: 'fn-mn-hint' }, _('Passes mDNS and DNS-SD announcements between all network segments.'))
		]);

		const ipv4Input = E('input', { type: 'checkbox', checked: true });
		const ipv4Body = E('div', {});

		const dhcpOn = dhcpSec['ignore'] !== '1';
		const dhcpOnRadio = E('input', { type: 'radio', name: 'fn-dhcp-' + kind, checked: dhcpOn ? true : null });
		const dhcpOffRadio = E('input', { type: 'radio', name: 'fn-dhcp-' + kind, checked: dhcpOn ? null : true });

		const dnsOpts = parseDhcpOptions(dhcpSec);
		const startInput = E('input', { type: 'text', class: 'fn-input', value: poolStartToAddress(baseIp, netmask, dhcpSec.start != null ? dhcpSec.start : 100) });
		const limitInput = E('input', { type: 'text', class: 'fn-input', value: dhcpSec.limit || '150' });
		const leaseInput = E('input', { type: 'text', class: 'fn-input', value: String(parseLeaseSeconds(dhcpSec.leasetime)) });
		const gatewayInput = E('input', { type: 'text', class: 'fn-input', placeholder: baseIp, value: dnsOpts.gateway });
		const dns1Input = E('input', { type: 'text', class: 'fn-input', value: dnsOpts.dns[0] || '' });
		const dns2Input = E('input', { type: 'text', class: 'fn-input', value: dnsOpts.dns[1] || '' });

		const dhcpDetails = E('div', { class: 'fn-mn-dhcp-details fn-collapsed' }, [
			E('div', { class: 'fn-mn-dhcp-range' }, [
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Pool start address')), startInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Pool size')), limitInput ])
			]),
			E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Lease time, sec')), leaseInput ]),
			E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Gateway address')), gatewayInput ]),
			E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('DNS server 1')), dns1Input ]),
			E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('DNS server 2')), dns2Input ])
		]);
		const detailsToggle = E('a', { href: '#', class: 'fn-mn-details-toggle' }, _('Show DHCP settings'));
		detailsToggle.addEventListener('click', (ev) => {
			ev.preventDefault();
			const open = dhcpDetails.classList.toggle('fn-collapsed') === false;
			dom_empty(detailsToggle);
			detailsToggle.appendChild(document.createTextNode(open ? _('Hide DHCP settings') : _('Show DHCP settings')));
		});

		ipv4Body.appendChild(E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('IP address')), ipaddrInput ]));
		ipv4Body.appendChild(E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Subnet mask')), maskSelect ]));
		ipv4Body.appendChild(E('div', { class: 'fn-mn-radio-row' }, [
			E('label', {}, [ dhcpOnRadio, ' ', _('DHCP server enabled') ]),
			E('label', {}, [ dhcpOffRadio, ' ', _('DHCP server disabled') ])
		]));
		ipv4Body.appendChild(detailsToggle);
		ipv4Body.appendChild(dhcpDetails);
		ipv4Input.addEventListener('change', () => { ipv4Body.hidden = !ipv4Input.checked; });

		const saveBtn = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary fn-mn-save' }, _('Save'));
		saveBtn.addEventListener('click', () => this.saveSegment(kind, ifaceName, {
			label: nameInput.value.trim(),
			ipv4Enabled: ipv4Input.checked,
			ipaddr: ipaddrInput.value.trim(),
			netmask: maskSelect.value,
			dhcpOn: dhcpOnRadio.checked,
			start: addressToPoolStart(ipaddrInput.value.trim(), maskSelect.value, startInput.value.trim()),
			limit: limitInput.value.trim(),
			leaseSeconds: parseInt(leaseInput.value, 10) || 43200,
			gateway: gatewayInput.value.trim(),
			dns: [ dns1Input.value.trim(), dns2Input.value.trim() ],
			existingDhcpOptions: dnsOpts.list,
			wifiCards
		}, saveBtn));

		const children = [
			E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Segment name')), nameInput ]),
			E('h4', { class: 'fn-mn-subhead' }, _('Wireless networks')),
			...wifiCards.map(c => c.el),
			E('h4', { class: 'fn-mn-subhead' }, _('IP parameters')),
			mdnsRow,
			E('label', { class: 'fn-mn-checkbox-row' }, [ ipv4Input, ' ', _('Enable IPv4') ]),
			ipv4Body,
			saveBtn
		];

		if (isGuest && ifaces.length) {
			const delBtn = E('button', { type: 'button', class: 'fn-settings-btn fn-mn-delete' }, _('Delete segment'));
			delBtn.addEventListener('click', () => this.deleteGuestSegment(delBtn));
			children.unshift(delBtn);
		}

		return E('div', { class: 'fn-mn-panel' }, children);
	},

	renderWifiCard(radio, iface, isGuest, radioAdv) {
		const band = radio.band === '5g' ? '5 GHz' : '2.4 GHz';
		const configured = !!iface;
		const disabled = configured ? iface.disabled === '1' : true;

		const enableToggle = E('input', { type: 'checkbox', class: 'fn-switch-input' });
		enableToggle.checked = configured && !disabled;

		const ssidInput = E('input', { type: 'text', class: 'fn-input', value: (iface && iface.ssid) || '', placeholder: isGuest ? _('Guest network name') : _('Network name (SSID)') });
		const secSelect = E('select', { class: 'fn-input' }, [
			E('option', { value: 'none' }, _('No security')),
			E('option', { value: 'psk2' }, 'WPA2-PSK'),
			E('option', { value: 'sae' }, 'WPA3-PSK'),
			E('option', { value: 'sae-mixed' }, 'WPA2/WPA3-PSK')
		]);
		secSelect.value = (iface && iface.encryption) || 'psk2';

		const pw = passwordField(iface && iface.key);
		const togglePw = () => { pw.wrap.hidden = secSelect.value === 'none'; };
		secSelect.addEventListener('change', togglePw);
		togglePw();

		const fieldsWrap = E('div', {}, [
			E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Name (SSID)')), ssidInput ]),
			E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Security')), secSelect ]),
			pw.wrap
		]);
		const body = E('div', { class: 'fn-mn-wifi-body' }, [ fieldsWrap ]);
		body.hidden = !enableToggle.checked;
		enableToggle.addEventListener('change', () => { body.hidden = !enableToggle.checked; });

		/* Channel/width/power are radio-wide (shared with any other network
		   on the same physical radio, e.g. the guest network's own card for
		   this same band) — always visible regardless of this network's own
		   enable toggle, since the radio can still be in use elsewhere. */
		const adv = this.renderAdvancedSettings(radio, radioAdv || {});

		const el = E('div', { class: 'fn-card fn-mn-wifi-card' }, [
			E('div', { class: 'fn-mn-wifi-head' }, [
				E('label', { class: 'fn-switch' }, [ enableToggle, E('span', { class: 'fn-switch-slider' }) ]),
				E('span', {}, _('Wireless network Wi-Fi %s').format(band))
			]),
			body,
			adv.toggle,
			adv.body
		]);

		return { el, band, radioName: radio['.name'], enableToggle, ssidInput, secSelect, pwInput: pw.input, body, fieldsWrap, adv };
	},

	/* Collapsible "Advanced settings" block: channel, channel width,
	   transmit power and regulatory region, read from the radio's real
	   hardware capabilities (iwinfo) rather than a hardcoded list. The
	   channel/power lists iwinfo returns are bounded by whichever
	   regulatory domain is currently selected below — the select defaults
	   to the radio's existing UCI 'country' (or iwinfo's 'active' entry
	   if unset), so saveSegment() writes back the same value it started
	   with unless the user actually picks a different region. */
	renderAdvancedSettings(radio, radioAdv) {
		const info = radioAdv.info || {};
		const htmodes = info.htmodes || [];
		const txpowerlist = radioAdv.txpowerlist || [];
		const freqlist = radioAdv.freqlist || [];
		const countrylist = radioAdv.countrylist || [];

		const channelSelect = E('select', { class: 'fn-input' }, [
			E('option', { value: 'auto' }, _('Auto')),
			...freqlist.map(f => E('option', { value: String(f.channel) }, _('Channel %d (%d MHz)').format(f.channel, f.mhz)))
		]);
		const currentChannel = radio.channel && radio.channel !== 'auto' ? String(radio.channel) : 'auto';
		if (currentChannel === 'auto' || freqlist.some(f => String(f.channel) === currentChannel))
			channelSelect.value = currentChannel;

		const htmodeLabel = (m) => {
			const width = (m.match(/\d+/) || ['?'])[0];
			const tech = m.indexOf('HE') === 0 ? '802.11ax' : m.indexOf('VHT') === 0 ? '802.11ac' : '802.11n';
			return width + ' ' + _('MHz') + ' (' + tech + ')';
		};
		const htmodeSelect = E('select', { class: 'fn-input' }, htmodes.map(m => E('option', { value: m }, htmodeLabel(m))));
		if (htmodes.indexOf(radio.htmode) !== -1)
			htmodeSelect.value = radio.htmode;

		const txpowerSelect = E('select', { class: 'fn-input' },
			txpowerlist.length
				? txpowerlist.map(p => E('option', { value: String(p.dbm) }, p.dbm + ' dBm (' + p.mw + ' mW)'))
				: [ E('option', { value: '' }, _('Not available')) ]);
		const currentTxpower = radio.txpower != null ? String(radio.txpower) : (info.txpower != null ? String(info.txpower) : '');
		if (txpowerlist.some(p => String(p.dbm) === currentTxpower))
			txpowerSelect.value = currentTxpower;
		else if (txpowerlist.length)
			txpowerSelect.value = String(txpowerlist[txpowerlist.length - 1].dbm);

		/* Regulatory domain (wireless-regdb country code) — governs which
		   channels/power the two selects above are even allowed to offer.
		   Defaults to whatever the radio is already using (UCI 'country',
		   falling back to the entry iwinfo marks 'active'), and is only
		   ever changed if the user picks something else here — saveSegment()
		   just writes back whatever this select holds. */
		const countrySelect = E('select', { class: 'fn-input' },
			countrylist.length
				? countrylist.map(c => E('option', { value: c.code }, c.code + ' — ' + c.country))
				: [ E('option', { value: '00' }, _('Not available')) ]);
		const activeEntry = countrylist.find(c => c.active);
		const currentCountry = radio.country || (activeEntry && activeEntry.code) || '00';
		if (countrylist.some(c => c.code === currentCountry))
			countrySelect.value = currentCountry;

		const body = E('div', { class: 'fn-mn-advanced-body fn-collapsed' }, [
			E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Channel')), channelSelect ]),
			E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Channel width')), htmodeSelect ]),
			E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Transmit power')), txpowerSelect ]),
			E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Regulatory region')), countrySelect ])
		]);
		const toggle = E('a', { href: '#', class: 'fn-mn-details-toggle' }, _('Advanced settings'));
		toggle.addEventListener('click', (ev) => {
			ev.preventDefault();
			const open = body.classList.toggle('fn-collapsed') === false;
			dom_empty(toggle);
			toggle.appendChild(document.createTextNode(open ? _('Hide advanced settings') : _('Advanced settings')));
		});

		return { toggle, body, channelSelect, htmodeSelect, txpowerSelect, countrySelect };
	},

	/* Optional "same as 2.4 GHz" toggle on the 5 GHz card — when checked, its
	   own SSID/security/password fields are hidden and saveSegment() copies
	   the 2.4 GHz card's values onto the 5 GHz radio instead. */
	linkWifiCard(secondary, primary) {
		const linkInput = E('input', { type: 'checkbox' });
		const note = E('div', { class: 'fn-mn-hint fn-mn-linked-note' }, _('Network settings are identical to the 2.4 GHz network.'));
		note.hidden = true;

		const sync = () => {
			secondary.fieldsWrap.hidden = linkInput.checked;
			note.hidden = !linkInput.checked;
		};
		linkInput.addEventListener('change', sync);

		secondary.body.insertBefore(note, secondary.fieldsWrap);
		secondary.body.insertBefore(
			E('label', { class: 'fn-mn-checkbox-row fn-mn-link-row' }, [ linkInput, ' ', _('Same as 2.4 GHz network') ]),
			secondary.fieldsWrap
		);

		secondary.linkInput = linkInput;
		secondary.linkedFrom = primary;

		/* This checkbox has no UCI field of its own — after every Save the
		   page does a full reload() and the card tree is rebuilt from
		   scratch, so the checked state would otherwise be lost every time.
		   Re-derive it instead: if both radios already carry the exact same
		   SSID/security/password (which is what checking this box and
		   saving actually produces, per saveSegment/effectiveWifi), default
		   it to checked so it "sticks" across saves. */
		if (primary.ssidInput.value !== '' &&
		    secondary.ssidInput.value === primary.ssidInput.value &&
		    secondary.secSelect.value === primary.secSelect.value &&
		    secondary.pwInput.value === primary.pwInput.value) {
			linkInput.checked = true;
			sync();
		}
	},

	saveSegment(kind, ifaceName, opts, btn) {
		const isGuest = kind === 'guest';

		for (const card of opts.wifiCards) {
			if (!card.enableToggle.checked)
				continue;
			const v = effectiveWifi(card);
			if (!v.ssid) {
				notify(_('Please enter a network name (SSID).'), 'warning');
				return;
			}
			if (v.enc !== 'none' && v.key.length < 8) {
				notify(_('Please enter a password of at least 8 characters.'), 'warning');
				return;
			}
		}

		btn.disabled = true;

		return uci.load([ 'wireless', 'network', 'dhcp', 'firewall' ]).then(() => {
			if (uci.get('network', ifaceName, 'proto') != null)
				uci.set('network', ifaceName, 'label', opts.label);

			if (isGuest) {
				const anyEnabled = opts.wifiCards.some(c => c.enableToggle.checked);
				/* uci 'device' sections are conventionally anonymous (identified by
				   their 'name' option, not a named uci section — same as the
				   stock br-lan) — uci.get('network','br-guest',...) never matches
				   even after creation, and re-requesting a *named* add for an
				   already-anonymous-only section type fails with EINVAL. Search by
				   the option value instead, and create anonymously. */
				if (anyEnabled && !uci.sections('network', 'device').some(s => s.name === 'br-guest')) {
					const sid = uci.add('network', 'device');
					uci.set('network', sid, 'name', 'br-guest');
					uci.set('network', sid, 'type', 'bridge');
					uci.set('network', sid, 'bridge_empty', '1');
					uci.set('network', sid, 'freenetic_managed', '1');
				}
				if (anyEnabled && uci.get('network', 'guest', 'proto') == null) {
					uci.add('network', 'interface', 'guest');
					uci.set('network', 'guest', 'proto', 'static');
					uci.set('network', 'guest', 'device', 'br-guest');
					uci.set('network', 'guest', 'label', opts.label);
					uci.set('network', 'guest', 'freenetic_managed', '1');
				}
				if (anyEnabled && opts.ipv4Enabled) {
					uci.set('network', 'guest', 'ipaddr', opts.ipaddr);
					uci.set('network', 'guest', 'netmask', opts.netmask);
				}

				if (anyEnabled && opts.ipv4Enabled && uci.get('dhcp', 'guest', 'interface') == null) {
					uci.add('dhcp', 'dhcp', 'guest');
					uci.set('dhcp', 'guest', 'interface', 'guest');
					uci.set('dhcp', 'guest', 'dhcpv4', 'server');
					uci.set('dhcp', 'guest', 'freenetic_managed', '1');
				}
				if (anyEnabled && opts.ipv4Enabled) {
					uci.set('dhcp', 'guest', 'start', String(opts.start));
					uci.set('dhcp', 'guest', 'limit', opts.limit);
					uci.set('dhcp', 'guest', 'leasetime', String(opts.leaseSeconds));
					uci.set('dhcp', 'guest', 'ignore', opts.dhcpOn ? '0' : '1');
					applyDhcpOptions('dhcp', 'guest', opts.existingDhcpOptions, opts.gateway, opts.dns);
				}

				if (anyEnabled && uci.get('firewall', 'guest', 'name') == null) {
					uci.add('firewall', 'zone', 'guest');
					uci.set('firewall', 'guest', 'name', 'guest');
					uci.set('firewall', 'guest', 'network', 'guest');
					uci.set('firewall', 'guest', 'output', 'ACCEPT');
					uci.set('firewall', 'guest', 'forward', 'REJECT');
					uci.set('firewall', 'guest', 'freenetic_managed', '1');
				}
				if (anyEnabled)
					uci.set('firewall', 'guest', 'input', 'ACCEPT');

				if (anyEnabled && uci.get('firewall', 'guest_wan_fwd', 'src') == null) {
					uci.add('firewall', 'forwarding', 'guest_wan_fwd');
					uci.set('firewall', 'guest_wan_fwd', 'src', 'guest');
					uci.set('firewall', 'guest_wan_fwd', 'dest', 'wan');
					uci.set('firewall', 'guest_wan_fwd', 'freenetic_managed', '1');
				}
			} else if (opts.ipv4Enabled) {
				uci.set('network', ifaceName, 'ipaddr', opts.ipaddr);
				uci.set('network', ifaceName, 'netmask', opts.netmask);
				if (uci.get('dhcp', ifaceName, 'interface') != null) {
					uci.set('dhcp', ifaceName, 'start', String(opts.start));
					uci.set('dhcp', ifaceName, 'limit', opts.limit);
					uci.set('dhcp', ifaceName, 'leasetime', String(opts.leaseSeconds));
					uci.set('dhcp', ifaceName, 'ignore', opts.dhcpOn ? '0' : '1');
					applyDhcpOptions('dhcp', ifaceName, opts.existingDhcpOptions, opts.gateway, opts.dns);
				}
			}

			opts.wifiCards.forEach(card => {
				/* Radio-wide, applies even if this particular network is
				   disabled — the radio may still be serving another network
				   (e.g. the guest segment's card for the same band). */
				if (card.adv) {
					const chan = card.adv.channelSelect.value;
					uci.set('wireless', card.radioName, 'channel', chan);
					uci.set('wireless', card.radioName, 'htmode', card.adv.htmodeSelect.value);
					if (card.adv.txpowerSelect.value !== '')
						uci.set('wireless', card.radioName, 'txpower', card.adv.txpowerSelect.value);
					if (card.adv.countrySelect.value !== '00')
						uci.set('wireless', card.radioName, 'country', card.adv.countrySelect.value);
				}

				const name = (isGuest ? 'guest_' : 'default_') + card.radioName;
				if (!card.enableToggle.checked) {
					if (uci.get('wireless', name, 'device') != null)
						uci.set('wireless', name, 'disabled', '1');
					return;
				}

				if (uci.get('wireless', name, 'device') == null) {
					uci.add('wireless', 'wifi-iface', name);
					uci.set('wireless', name, 'device', card.radioName);
					uci.set('wireless', name, 'mode', 'ap');
					uci.set('wireless', name, 'network', ifaceName);
					if (isGuest)
						uci.set('wireless', name, 'isolate', '1');
				}
				const v = effectiveWifi(card);
				uci.set('wireless', name, 'disabled', '0');
				uci.set('wireless', name, 'ssid', v.ssid);
				uci.set('wireless', name, 'encryption', v.enc);
				if (v.enc !== 'none')
					uci.set('wireless', name, 'key', v.key);
			});

			return uci.save();
		}).then(() => applyChanges()).then(() => {
			if (isGuest && opts.wifiCards.some(c => c.enableToggle.checked))
				return fs.exec('/sbin/ifup', [ 'guest' ]).catch(() => {});
		}).then(() => {
			notify(_('Settings saved.'), 'info');
			btn.disabled = false;
		}).catch(err => {
			btn.disabled = false;
			notify(_('Failed to save: %s').format(err.message || err), 'danger');
		});
	},

	deleteGuestSegment(btn) {
		if (!confirm(_('Delete the guest network segment? This removes its Wi-Fi networks, IP settings and firewall rules.')))
			return;

		btn.disabled = true;

		return uci.load([ 'wireless', 'network', 'dhcp', 'firewall' ]).then(() => {
			/* Only remove sections Freenetic itself created (marked
			   'freenetic_managed', or — for the per-radio wifi-iface
			   sections, which predate that marker — named with the
			   'guest_' prefix saveSegment() always uses). A user or
			   another package may have its own 'guest'-named network,
			   dhcp or firewall section; leave those alone. */
			uci.sections('wireless', 'wifi-iface').forEach(s => {
				if (s['.name'].indexOf('guest_') === 0)
					uci.remove('wireless', s['.name']);
			});
			if (uci.get('dhcp', 'guest', 'freenetic_managed') === '1')
				uci.remove('dhcp', 'guest');
			if (uci.get('firewall', 'guest_wan_fwd', 'freenetic_managed') === '1')
				uci.remove('firewall', 'guest_wan_fwd');
			if (uci.get('firewall', 'guest', 'freenetic_managed') === '1')
				uci.remove('firewall', 'guest');
			if (uci.get('network', 'guest', 'freenetic_managed') === '1')
				uci.remove('network', 'guest');
			const brSection = uci.sections('network', 'device').find(s => s.name === 'br-guest' && s.freenetic_managed === '1');
			if (brSection)
				uci.remove('network', brSection['.name']);

			return uci.save();
		}).then(() => applyChanges()).then(() => {
			notify(_('Guest network deleted.'), 'info');
			location.reload();
		}).catch(err => {
			btn.disabled = false;
			notify(_('Failed to delete: %s').format(err.message || err), 'danger');
		});
	},

	addFooter() { return E([]); }
});
