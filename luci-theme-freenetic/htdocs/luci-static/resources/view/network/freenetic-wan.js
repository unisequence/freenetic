'use strict';
'require view';
'require ui';
'require uci';

/* Same raw-fetch ubus approach as the rest of this theme's custom views —
   see freenetic-dashboard.js for why (headless-tab requestAnimationFrame
   hang). Writes go through the real 'uci' module, same as everywhere else. */
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

function applyChanges() {
	return uci.apply().catch(err => {
		if (err && /code 5/.test(err.message))
			return;
		throw err;
	}).then(() => ui.changes.init());
}

function svgIcon(d, size) {
	size = size || 18;
	const span = E('span', { class: 'fn-icon' });
	span.innerHTML = '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">' +
		'<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2" ' +
		'stroke-linecap="round" stroke-linejoin="round"/></svg>';
	return span;
}

function eyeIcon() {
	const span = E('span', {});
	span.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
	return span;
}

/* Minimal from-scratch reimplementation of LuCI's <div class="cbi-dropdown">
   widget (see cascade.css for the full CSS contract) — this view builds its
   own DOM instead of going through LuCI's form.js/cbi machinery, so a plain
   <select> here would render with no OS-level way to theme the open option
   list; this reuses the same markup/CSS the rest of the theme already relies
   on so the popup itself (not just the closed box) matches everywhere else. */
function buildDropdown(options, initialValue) {
	const ul = E('ul', {});

	function renderClosed(value) {
		dom_empty(ul);
		options.forEach(opt => {
			const li = E('li', { 'data-value': opt.value }, opt.label);
			if (opt.value === value) {
				li.setAttribute('display', '');
				li.setAttribute('selected', '');
			}
			ul.appendChild(li);
		});
	}

	const wrap = E('div', { class: 'cbi-dropdown', tabindex: 0 }, [ ul, E('span', { class: 'open' }, '▾') ]);
	let value = initialValue;
	renderClosed(value);

	function close() {
		wrap.removeAttribute('open');
		ul.classList.remove('dropdown');
	}
	function toggleOpen() {
		if (wrap.hasAttribute('open')) {
			close();
		} else {
			wrap.setAttribute('open', '');
			ul.classList.add('dropdown');
		}
	}

	wrap.addEventListener('click', ev => {
		const li = ev.target.closest('li');
		if (wrap.hasAttribute('open') && li) {
			value = li.getAttribute('data-value');
			renderClosed(value);
			wrap.dispatchEvent(new Event('change', { bubbles: true }));
			close();
		} else {
			toggleOpen();
		}
		ev.stopPropagation();
	});
	wrap.addEventListener('keydown', ev => { if (ev.key === 'Escape') close(); });
	document.addEventListener('click', ev => { if (!wrap.contains(ev.target)) close(); });

	Object.defineProperty(wrap, 'value', {
		get: () => value,
		set: v => { value = v; renderClosed(value); }
	});

	return wrap;
}

function passwordField(value, placeholder) {
	const input = E('input', { type: 'password', class: 'fn-input', value: value || '', placeholder: placeholder || '' });
	const toggle = E('button', { type: 'button', class: 'fn-eye-toggle', 'aria-label': _('Show password') }, eyeIcon());
	toggle.addEventListener('click', () => { input.type = input.type === 'password' ? 'text' : 'password'; });
	return { wrap: E('div', { class: 'fn-field fn-field-password fn-mn-password' }, [ input, toggle ]), input };
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

function getWanStatus() {
	return ubusCall('network.interface', 'status', { interface: 'wan' }).catch(() => null);
}

const IPV4_RE = /^\d{1,3}(\.\d{1,3}){3}$/;

/* A VLAN'd WAN rides an explicit `config device` (type '8021q') that
   network.wan.device then points at, instead of the raw port name — see
   OpenWrt's 8021q device docs. Locate that section (if any) so the form can
   show/edit the VLAN ID without caring whether it currently exists. */
function findVlanDevice(deviceName) {
	let result = { vid: '', baseIfname: deviceName, sectionName: null };
	uci.sections('network', 'device').forEach(s => {
		if (s.type === '8021q' && s.name === deviceName) {
			result = { vid: s.vid || '', baseIfname: s.ifname, sectionName: s['.name'] };
		}
	});
	return result;
}

return view.extend({
	load() {
		return Promise.all([
			uci.load('network'),
			getWanStatus()
		]);
	},

	render(data) {
		this.status = data[1];

		const proto = uci.get('network', 'wan', 'proto') || 'dhcp';
		const disabled = uci.get('network', 'wan', 'disabled') === '1';
		const currentDevice = uci.get('network', 'wan', 'device') || 'wan';
		const vlanInfo = findVlanDevice(currentDevice);
		this.baseIfname = vlanInfo.baseIfname;
		this.vlanSectionName = vlanInfo.sectionName;

		const enableToggle = E('input', { type: 'checkbox', class: 'fn-switch-input' });
		enableToggle.checked = !disabled;

		const protoSelect = buildDropdown([
			{ value: 'dhcp', label: _('Automatic (DHCP)') },
			{ value: 'pppoe', label: _('PPPoE') },
			{ value: 'static', label: _('Static IP') }
		], (proto === 'pppoe' || proto === 'static') ? proto : 'dhcp');

		const userInput = E('input', { type: 'text', class: 'fn-input', value: uci.get('network', 'wan', 'username') || '', placeholder: _('Provided by your ISP') });
		const pass = passwordField(uci.get('network', 'wan', 'password') || '', _('Provided by your ISP'));

		const ipInput = E('input', { type: 'text', class: 'fn-input', value: uci.get('network', 'wan', 'ipaddr') || '', placeholder: '203.0.113.4' });
		const maskInput = E('input', { type: 'text', class: 'fn-input', value: uci.get('network', 'wan', 'netmask') || '', placeholder: '255.255.255.0' });
		const gwInput = E('input', { type: 'text', class: 'fn-input', value: uci.get('network', 'wan', 'gateway') || '', placeholder: '203.0.113.1' });

		const dnsList = [].concat(uci.get('network', 'wan', 'dns') || []);
		const dns1Input = E('input', { type: 'text', class: 'fn-input', value: dnsList[0] || '', placeholder: _('Automatic') });
		const dns2Input = E('input', { type: 'text', class: 'fn-input', value: dnsList[1] || '', placeholder: _('Optional') });

		const vlanInput = E('input', { type: 'text', class: 'fn-input', value: vlanInfo.vid || '', placeholder: _('Not set') });

		const pppoeGroup = E('div', { class: 'fn-kn-group' }, [
			E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('Login')), userInput ]),
			E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('Password')), pass.wrap ])
		]);
		const staticGroup = E('div', { class: 'fn-kn-group' }, [
			E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('IP address')), ipInput ]),
			E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('Subnet mask')), maskInput ]),
			E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('Gateway')), gwInput ])
		]);

		const updateFieldVisibility = () => {
			pppoeGroup.hidden = protoSelect.value !== 'pppoe';
			staticGroup.hidden = protoSelect.value !== 'static';
		};
		protoSelect.addEventListener('change', updateFieldVisibility);
		updateFieldVisibility();

		const settingsBody = E('div', {}, [
			E('div', { class: 'fn-mn-wifi-head', style: 'margin-bottom:16px;' }, [
				E('label', { class: 'fn-switch' }, [ enableToggle, E('span', { class: 'fn-switch-slider' }) ]),
				E('span', {}, _('Connection enabled'))
			]),
			E('div', { class: 'fn-kn-row' }, [
				E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('Connection type')), protoSelect ]),
				pppoeGroup,
				staticGroup,
				E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('VLAN ID')), vlanInput ]),
				E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('DNS server 1')), dns1Input ]),
				E('div', { class: 'fn-kn-field' }, [ E('label', {}, _('DNS server 2')), dns2Input ])
			])
		]);

		const saveBtn = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', style: 'width:auto; padding:8px 20px;' }, _('Save'));
		saveBtn.addEventListener('click', () => this.save({
			enabled: enableToggle.checked,
			proto: protoSelect.value,
			username: userInput.value.trim(),
			password: pass.input.value,
			ipaddr: ipInput.value.trim(),
			netmask: maskInput.value.trim(),
			gateway: gwInput.value.trim(),
			vlan: vlanInput.value.trim(),
			dns1: dns1Input.value.trim(),
			dns2: dns2Input.value.trim()
		}, saveBtn));

		this.statusPill = E('span', { class: 'fn-status-pill' });
		this.infoGrid = E('div', { class: 'fn-info-grid' });
		this.fillStatus(this.status);

		return E('div', { class: 'fn-dash' }, [
			E('div', { class: 'fn-card', style: 'grid-column: 1 / -1' }, [
				E('div', { class: 'fn-card-head' }, [
					svgIcon('M12 2a10 10 0 1 0 .001 20.001A10 10 0 0 0 12 2ZM2 12h20M12 2c2.5 2.7 4 6.2 4 10s-1.5 7.3-4 10c-2.5-2.7-4-6.2-4-10s1.5-7.3 4-10Z', 20),
					E('h3', {}, _('Internet')),
					this.statusPill
				]),
				E('div', { class: 'fn-card-body' }, [ this.infoGrid ])
			]),
			E('div', { class: 'fn-card', style: 'grid-column: 1 / -1' }, [
				E('div', { class: 'fn-card-head' }, [ E('h3', {}, _('Connection settings')) ]),
				E('div', { class: 'fn-card-body fn-pf-form' }, [
					settingsBody,
					E('div', { class: 'fn-pf-actions' }, [ saveBtn ])
				])
			])
		]);
	},

	fillStatus(wan) {
		const grid = this.infoGrid;
		dom_empty(grid);

		const up = !!(wan && wan.up);
		this.statusPill.className = 'fn-status-pill ' + (up ? 'fn-status-ok' : 'fn-status-off');
		dom_content(this.statusPill, up ? _('Connected') : _('Not connected'));

		const addrs = wan ? (wan['ipv4-address'] || []).map(a => a.address + '/' + a.mask) : [];
		const dns = (wan && wan['dns-server']) || [];
		const gw = wan ? (wan.route || []).find(r => r.target == '0.0.0.0' && r.mask == 0) : null;

		const entries = [
			[ _('Protocol'), (wan && wan.proto) || '–' ],
			[ _('IP address'), addrs.length ? addrs.join(', ') : '–' ],
			[ _('Gateway'), gw ? gw.nexthop : '–' ],
			[ _('DNS'), dns.length ? dns.join(', ') : '–' ],
			[ _('Connected'), wan && wan.uptime > 0 ? fmtUptime(wan.uptime) : '–' ]
		];

		entries.forEach(([label, value]) => {
			grid.appendChild(E('div', { class: 'fn-info-item' }, [
				E('div', { class: 'fn-info-label' }, label),
				E('div', { class: 'fn-info-value' }, value)
			]));
		});
	},

	save(fields, btn) {
		if (fields.proto === 'pppoe' && (!fields.username || !fields.password)) {
			notify(_('Please enter the PPPoE login and password.'), 'warning');
			return;
		}
		if (fields.proto === 'static') {
			if (!IPV4_RE.test(fields.ipaddr) || !IPV4_RE.test(fields.netmask) || !IPV4_RE.test(fields.gateway)) {
				notify(_('Please enter a valid IP address, subnet mask and gateway.'), 'warning');
				return;
			}
		}
		if (fields.vlan && !/^\d+$/.test(fields.vlan)) {
			notify(_('VLAN ID must be a number.'), 'warning');
			return;
		}
		if (fields.vlan && (fields.vlan < 1 || fields.vlan > 4094)) {
			notify(_('VLAN ID must be between 1 and 4094.'), 'warning');
			return;
		}
		if (fields.dns1 && !IPV4_RE.test(fields.dns1)) {
			notify(_('Please enter a valid DNS server address.'), 'warning');
			return;
		}
		if (fields.dns2 && !IPV4_RE.test(fields.dns2)) {
			notify(_('Please enter a valid DNS server address.'), 'warning');
			return;
		}

		btn.disabled = true;

		return uci.load('network').then(() => {
			if (fields.enabled)
				uci.unset('network', 'wan', 'disabled');
			else
				uci.set('network', 'wan', 'disabled', '1');

			uci.set('network', 'wan', 'proto', fields.proto);

			if (fields.proto === 'pppoe') {
				uci.set('network', 'wan', 'username', fields.username);
				uci.set('network', 'wan', 'password', fields.password);
				uci.unset('network', 'wan', 'ipaddr');
				uci.unset('network', 'wan', 'netmask');
				uci.unset('network', 'wan', 'gateway');
			} else if (fields.proto === 'static') {
				uci.set('network', 'wan', 'ipaddr', fields.ipaddr);
				uci.set('network', 'wan', 'netmask', fields.netmask);
				uci.set('network', 'wan', 'gateway', fields.gateway);
				uci.unset('network', 'wan', 'username');
				uci.unset('network', 'wan', 'password');
			} else {
				uci.unset('network', 'wan', 'username');
				uci.unset('network', 'wan', 'password');
				uci.unset('network', 'wan', 'ipaddr');
				uci.unset('network', 'wan', 'netmask');
				uci.unset('network', 'wan', 'gateway');
			}

			const dns = [ fields.dns1, fields.dns2 ].filter(Boolean);
			if (dns.length) {
				uci.set('network', 'wan', 'dns', dns);
				uci.set('network', 'wan', 'peerdns', '0');
			} else {
				uci.unset('network', 'wan', 'dns');
				uci.unset('network', 'wan', 'peerdns');
			}

			const oldDevice = uci.get('network', 'wan', 'device') || this.baseIfname;
			let newDevice = this.baseIfname;

			if (fields.vlan) {
				let sectionName = this.vlanSectionName;
				if (!sectionName)
					sectionName = uci.add('network', 'device');
				uci.set('network', 'device', sectionName, 'type', '8021q');
				uci.set('network', 'device', sectionName, 'ifname', this.baseIfname);
				uci.set('network', 'device', sectionName, 'vid', fields.vlan);
				newDevice = this.baseIfname + '.' + fields.vlan;
				uci.set('network', 'device', sectionName, 'name', newDevice);
				this.vlanSectionName = sectionName;
			} else if (this.vlanSectionName) {
				uci.remove('network', 'device', this.vlanSectionName);
				this.vlanSectionName = null;
			}

			uci.set('network', 'wan', 'device', newDevice);
			if (uci.get('network', 'wan6', 'device') === oldDevice)
				uci.set('network', 'wan6', 'device', newDevice);

			return uci.save();
		}).then(() => applyChanges()).then(() => {
			notify(_('Connection settings saved.'), 'info');
			return getWanStatus();
		}).then(status => {
			this.status = status;
			this.fillStatus(status);
			btn.disabled = false;
		}).catch(err => {
			btn.disabled = false;
			notify(_('Failed to save: %s').format(err.message || err), 'danger');
		});
	},

	addFooter() { return E([]); }
});
