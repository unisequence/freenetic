'use strict';
'require view';
'require ui';
'require uci';
'require freenetic-view-guard as guard';

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

/* Same auto-dismissing toast as every other view in this theme. */
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
   actually changed — not a real failure, just nothing staged. */
function applyChanges() {
	return uci.apply().catch(err => {
		if (err && /code 5/.test(err.message))
			return;
		throw err;
	}).then(() => ui.changes.init());
}

function getFirewallConfig() {
	return ubusCall('uci', 'get', { config: 'firewall' }).then(r => r.values || {}).catch(() => ({}));
}

/* Zone names aren't hardcoded — same detection idea as Port Forwarding,
   generalized to every zone actually defined (not just wan/lan) so a rule
   can target guest or any other segment too. */
function detectZones(firewall) {
	const zones = [];
	Object.keys(firewall).forEach(k => {
		const z = firewall[k];
		if (z['.type'] !== 'zone')
			return;
		zones.push(z.name);
	});
	return zones.length ? zones : [ 'wan', 'lan' ];
}

function protoLabel(protos) {
	const list = [].concat(protos || []).map(p => p.toLowerCase());
	if (!list.length || list.indexOf('all') !== -1)
		return _('Any');
	if (list.indexOf('tcp') !== -1 && list.indexOf('udp') !== -1)
		return 'TCP+UDP';
	if (list.indexOf('udp') !== -1)
		return 'UDP';
	if (list.indexOf('icmp') !== -1)
		return 'ICMP';
	return 'TCP';
}

function actionLabel(target) {
	if (target === 'REJECT')
		return _('Reject');
	if (target === 'DROP')
		return _('Block');
	return _('Allow');
}

return view.extend({
	/* admin/network/firewall is a real stock path (an alias to
	   luci-app-firewall's own "General Settings" zones page) that we
	   override — under a non-Freenetic theme, send the browser to the
	   actual stock page (a genuinely different URL, untouched by us)
	   instead of rendering our fn-card markup. See freenetic-view-guard.js. */
	__init__() {
		return guard.isForeignTheme().then(foreign => {
			if (foreign) {
				location.href = L.url('admin/network/firewall/zones');
				return Promise.resolve();
			}
			return this.super('__init__', []);
		});
	},

	load() {
		return getFirewallConfig();
	},

	render(firewall) {
		this.firewall = firewall;
		this.zones = detectZones(firewall);

		this.table = E('div', { class: 'fn-table' });
		this.formPanel = E('div', { hidden: true });
		this.editingSection = null;

		this.fillTable();

		return E('div', { class: 'fn-dash' }, [
			E('div', { class: 'fn-card', style: 'grid-column: 1 / -1' }, [
				E('div', { class: 'fn-card-head' }, [
					E('h3', {}, _('Firewall')),
					E('button', {
						type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', style: 'width:auto; padding:7px 16px;',
						click: () => this.openForm(null)
					}, _('Add rule'))
				]),
				E('div', { class: 'fn-card-body' }, [
					E('p', { class: 'fn-info-empty' }, _('Rules control what traffic is allowed to pass between segments and the internet. Rules are evaluated top to bottom — the first match wins.')),
					this.formPanel,
					this.table
				])
			])
		]);
	},

	refresh() {
		return getFirewallConfig().then(L.bind(function(firewall) {
			this.firewall = firewall;
			this.zones = detectZones(firewall);
			this.fillTable();
		}, this));
	},

	getRules() {
		return Object.keys(this.firewall)
			.map(k => this.firewall[k])
			.filter(s => s['.type'] === 'rule');
	},

	fillTable() {
		const table = this.table;
		dom_empty(table);

		const rules = this.getRules();

		table.appendChild(E('div', { class: 'fn-table-row fn-fw-row fn-table-head' }, [
			E('div', {}, ''),
			E('div', {}, _('Name')),
			E('div', {}, _('Action')),
			E('div', {}, _('Protocol')),
			E('div', {}, _('Traffic')),
			E('div', {}, '')
		]));

		if (!rules.length) {
			table.appendChild(E('div', { class: 'fn-info-empty' }, _('No firewall rules configured.')));
			return;
		}

		rules.forEach(rule => {
			const enabled = rule.enabled !== '0';
			const toggle = E('input', { type: 'checkbox', class: 'fn-switch-input' });
			toggle.checked = enabled;
			toggle.addEventListener('change', () => this.toggleRule(rule['.name'], toggle.checked));

			const src = rule.src || _('any');
			const dest = rule.dest || _('any');
			const srcAddr = rule.src_ip ? ' (' + rule.src_ip + (rule.src_port ? ':' + rule.src_port : '') + ')' : '';
			const destAddr = rule.dest_ip ? ' (' + rule.dest_ip + (rule.dest_port ? ':' + rule.dest_port : '') + ')' : '';

			table.appendChild(E('div', { class: 'fn-table-row fn-fw-row' }, [
				E('label', { class: 'fn-switch' }, [ toggle, E('span', { class: 'fn-switch-slider' }) ]),
				E('div', {}, rule.name || '–'),
				E('div', { class: rule.target === 'ACCEPT' ? 'fn-fw-allow' : 'fn-fw-block' }, actionLabel(rule.target)),
				E('div', {}, protoLabel(rule.proto)),
				E('div', {}, src + srcAddr + ' → ' + dest + destAddr),
				E('div', { class: 'fn-table-actions' }, [
					E('button', { type: 'button', class: 'fn-settings-btn', click: () => this.openForm(rule) }, _('Edit')),
					E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-danger', click: () => this.deleteRule(rule['.name']) }, _('Delete'))
				])
			]));
		});
	},

	openForm(rule) {
		this.editingSection = rule ? rule['.name'] : null;

		const zoneOption = zone => E('option', { value: zone }, zone);
		const zoneOptions = [ E('option', { value: '' }, _('any')) ].concat(this.zones.map(zoneOption));

		const nameInput = E('input', { type: 'text', class: 'fn-input', placeholder: _('e.g. Block IoT from internet'), value: rule ? (rule.name || '') : '' });

		const srcSelect = E('select', { class: 'fn-input' }, zoneOptions.map(o => o.cloneNode(true)));
		srcSelect.value = rule ? (rule.src || '') : '';
		const destSelect = E('select', { class: 'fn-input' }, zoneOptions.map(o => o.cloneNode(true)));
		destSelect.value = rule ? (rule.dest || '') : '';

		const actionSelect = E('select', { class: 'fn-input' }, [
			E('option', { value: 'ACCEPT' }, _('Allow')),
			E('option', { value: 'REJECT' }, _('Reject')),
			E('option', { value: 'DROP' }, _('Block'))
		]);
		actionSelect.value = rule ? (rule.target || 'ACCEPT') : 'ACCEPT';

		const protoSelect = E('select', { class: 'fn-input' }, [
			E('option', { value: 'all' }, _('Any')),
			E('option', { value: 'tcp' }, 'TCP'),
			E('option', { value: 'udp' }, 'UDP'),
			E('option', { value: 'tcp udp' }, 'TCP+UDP'),
			E('option', { value: 'icmp' }, 'ICMP')
		]);
		protoSelect.value = rule ? ([].concat(rule.proto || []).sort().join(' ') || 'all') : 'all';
		if (!protoSelect.value)
			protoSelect.value = 'all';

		const srcIpInput = E('input', { type: 'text', class: 'fn-input', placeholder: _('any'), value: rule ? (rule.src_ip || '') : '' });
		const destIpInput = E('input', { type: 'text', class: 'fn-input', placeholder: _('any'), value: rule ? (rule.dest_ip || '') : '' });
		const srcPortInput = E('input', { type: 'text', class: 'fn-input', placeholder: _('any'), value: rule ? (rule.src_port || '') : '' });
		const destPortInput = E('input', { type: 'text', class: 'fn-input', placeholder: _('any'), value: rule ? (rule.dest_port || '') : '' });

		const saveBtn = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', style: 'width:auto; padding:8px 20px;' },
			rule ? _('Save') : _('Add rule'));
		const cancelBtn = E('button', { type: 'button', class: 'fn-settings-btn', style: 'width:auto; padding:8px 20px;' }, _('Cancel'));

		saveBtn.addEventListener('click', () => this.saveRule({
			name: nameInput.value.trim(),
			src: srcSelect.value,
			dest: destSelect.value,
			target: actionSelect.value,
			proto: protoSelect.value,
			srcIp: srcIpInput.value.trim(),
			destIp: destIpInput.value.trim(),
			srcPort: srcPortInput.value.trim(),
			destPort: destPortInput.value.trim()
		}, saveBtn));
		cancelBtn.addEventListener('click', () => this.closeForm());

		dom_empty(this.formPanel);
		this.formPanel.appendChild(E('div', { class: 'fn-pf-form' }, [
			E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Name')), nameInput ]),
			E('div', { class: 'fn-pf-row' }, [
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('From')), srcSelect ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('To')), destSelect ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Action')), actionSelect ])
			]),
			E('div', { class: 'fn-pf-row' }, [
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Protocol')), protoSelect ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Source address')), srcIpInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Destination address')), destIpInput ])
			]),
			E('div', { class: 'fn-pf-row' }, [
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Source port')), srcPortInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Destination port')), destPortInput ])
			]),
			E('div', { class: 'fn-pf-actions' }, [ saveBtn, cancelBtn ])
		]));
		this.formPanel.hidden = false;
		this.formPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	},

	closeForm() {
		this.formPanel.hidden = true;
		dom_empty(this.formPanel);
		this.editingSection = null;
	},

	saveRule(fields, btn) {
		if (!fields.name) {
			notify(_('Please enter a name for the rule.'), 'warning');
			return;
		}

		btn.disabled = true;

		return uci.load('firewall').then(() => {
			const section = this.editingSection || uci.add('firewall', 'rule');
			uci.set('firewall', section, 'name', fields.name);
			uci.set('firewall', section, 'target', fields.target);
			if (fields.src) uci.set('firewall', section, 'src', fields.src); else uci.unset('firewall', section, 'src');
			if (fields.dest) uci.set('firewall', section, 'dest', fields.dest); else uci.unset('firewall', section, 'dest');
			uci.set('firewall', section, 'proto', fields.proto === 'all' ? 'all' : fields.proto.split(' '));
			if (fields.srcIp) uci.set('firewall', section, 'src_ip', fields.srcIp); else uci.unset('firewall', section, 'src_ip');
			if (fields.destIp) uci.set('firewall', section, 'dest_ip', fields.destIp); else uci.unset('firewall', section, 'dest_ip');
			if (fields.srcPort) uci.set('firewall', section, 'src_port', fields.srcPort); else uci.unset('firewall', section, 'src_port');
			if (fields.destPort) uci.set('firewall', section, 'dest_port', fields.destPort); else uci.unset('firewall', section, 'dest_port');
			return uci.save();
		}).then(() => applyChanges()).then(() => {
			notify(this.editingSection ? _('Rule saved.') : _('Rule added.'), 'info');
			this.closeForm();
			return this.refresh();
		}).catch(err => {
			btn.disabled = false;
			notify(_('Failed to save rule: %s').format(err.message || err), 'danger');
		});
	},

	toggleRule(sectionName, enable) {
		return uci.load('firewall').then(() => {
			uci.set('firewall', sectionName, 'enabled', enable ? '1' : '0');
			return uci.save();
		}).then(() => applyChanges()).then(() => this.refresh()).catch(err => {
			notify(_('Failed to apply change: %s').format(err.message || err), 'danger');
		});
	},

	deleteRule(sectionName) {
		return uci.load('firewall').then(() => {
			uci.remove('firewall', sectionName);
			return uci.save();
		}).then(() => applyChanges()).then(() => {
			notify(_('Rule deleted.'), 'info');
			return this.refresh();
		}).catch(err => {
			notify(_('Failed to delete rule: %s').format(err.message || err), 'danger');
		});
	},

	addFooter() { return E([]); }
});
