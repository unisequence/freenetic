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

function getDhcpLeases() {
	return ubusCall('luci-rpc', 'getDHCPLeases').then(r => r.dhcp_leases || []).catch(() => []);
}

/* "WAN"/"LAN" zone names aren't hardcoded — same masq-zone detection idea as
   the dashboard's Internet card, plus whichever zone actually carries the
   'lan' network, so this keeps working on a re-zoned or renamed setup. */
function detectZones(firewall) {
	let wanZone = null, lanZone = null;
	Object.keys(firewall).forEach(k => {
		const z = firewall[k];
		if (z['.type'] !== 'zone')
			return;
		const nets = [].concat(z.network || []);
		if (z.masq === '1' && !wanZone)
			wanZone = z.name;
		if (nets.indexOf('lan') !== -1 && !lanZone)
			lanZone = z.name;
	});
	return { wan: wanZone || 'wan', lan: lanZone || 'lan' };
}

function protoLabel(protos) {
	const list = [].concat(protos || []).map(p => p.toLowerCase());
	if (list.indexOf('tcp') !== -1 && list.indexOf('udp') !== -1)
		return 'TCP+UDP';
	if (list.indexOf('udp') !== -1)
		return 'UDP';
	return 'TCP';
}

return view.extend({
	load() {
		return Promise.all([ getFirewallConfig(), getDhcpLeases() ]);
	},

	render(data) {
		this.firewall = data[0];
		this.leases = data[1];
		this.zones = detectZones(this.firewall);

		this.table = E('div', { class: 'fn-table' });
		this.formPanel = E('div', { hidden: true });
		this.editingSection = null;

		this.fillTable();

		return E('div', { class: 'fn-dash' }, [
			E('div', { class: 'fn-card', style: 'grid-column: 1 / -1' }, [
				E('div', { class: 'fn-card-head' }, [
					E('h3', {}, _('Port Forwarding')),
					E('button', {
						type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', style: 'width:auto; padding:7px 16px;',
						click: () => this.openForm(null)
					}, _('Add rule'))
				]),
				E('div', { class: 'fn-card-body' }, [
					E('p', { class: 'fn-info-empty' }, _('Forwards a port from the internet to a device on your network — needed for game servers, security cameras, remote access, etc.')),
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
			.filter(s => s['.type'] === 'redirect' && s.target !== 'SNAT');
	},

	fillTable() {
		const table = this.table;
		dom_empty(table);

		const rules = this.getRules();

		table.appendChild(E('div', { class: 'fn-table-row fn-table-head' }, [
			E('div', {}, _('Description')),
			E('div', {}, _('Protocol')),
			E('div', {}, _('External port')),
			E('div', {}, _('Internal address')),
			E('div', {}, _('Status')),
			E('div', {}, '')
		]));

		if (!rules.length) {
			table.appendChild(E('div', { class: 'fn-info-empty' }, _('No port forwarding rules configured.')));
			return;
		}

		rules.forEach(rule => {
			const enabled = rule.enabled !== '0';
			const statusPill = E('span', {
				class: 'fn-status-pill ' + (enabled ? 'fn-status-ok' : 'fn-status-off'),
				style: 'cursor:pointer',
				click: () => this.toggleRule(rule['.name'], !enabled)
			}, enabled ? _('Enabled') : _('Disabled'));

			table.appendChild(E('div', { class: 'fn-table-row' }, [
				E('div', {}, rule.name || '–'),
				E('div', {}, protoLabel(rule.proto)),
				E('div', {}, rule.src_dport || '–'),
				E('div', {}, (rule.dest_ip || '–') + (rule.dest_port ? ':' + rule.dest_port : '')),
				E('div', {}, [ statusPill ]),
				E('div', { class: 'fn-table-actions' }, [
					E('button', { type: 'button', class: 'fn-settings-btn', click: () => this.openForm(rule) }, _('Edit')),
					E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-danger', click: () => this.deleteRule(rule['.name']) }, _('Delete'))
				])
			]));
		});
	},

	openForm(rule) {
		this.editingSection = rule ? rule['.name'] : null;

		const nameInput = E('input', { type: 'text', class: 'fn-input', placeholder: _('e.g. Security camera'), value: rule ? (rule.name || '') : '' });

		const protoSelect = E('select', { class: 'fn-input' }, [
			E('option', { value: 'tcp' }, 'TCP'),
			E('option', { value: 'udp' }, 'UDP'),
			E('option', { value: 'tcp udp' }, 'TCP+UDP')
		]);
		protoSelect.value = rule ? [].concat(rule.proto || []).sort().join(' ') || 'tcp' : 'tcp';
		if (!protoSelect.value)
			protoSelect.value = 'tcp';

		const extPortInput = E('input', { type: 'text', class: 'fn-input', placeholder: '8080', value: rule ? (rule.src_dport || '') : '' });
		const ipInput = E('input', { type: 'text', class: 'fn-input', placeholder: '192.168.1.100', value: rule ? (rule.dest_ip || '') : '', list: 'fn-pf-leases' });
		const intPortInput = E('input', { type: 'text', class: 'fn-input', placeholder: _('same as external'), value: rule ? (rule.dest_port || '') : '' });

		const leaseList = E('datalist', { id: 'fn-pf-leases' },
			this.leases.map(l => E('option', { value: l.ipaddr }, l.hostname ? l.hostname : l.ipaddr)));

		const saveBtn = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', style: 'width:auto; padding:8px 20px;' },
			rule ? _('Save') : _('Add rule'));
		const cancelBtn = E('button', { type: 'button', class: 'fn-settings-btn', style: 'width:auto; padding:8px 20px;' }, _('Cancel'));

		saveBtn.addEventListener('click', () => this.saveRule({
			name: nameInput.value.trim(),
			proto: protoSelect.value,
			extPort: extPortInput.value.trim(),
			ip: ipInput.value.trim(),
			intPort: intPortInput.value.trim()
		}, saveBtn));
		cancelBtn.addEventListener('click', () => this.closeForm());

		dom_empty(this.formPanel);
		this.formPanel.appendChild(E('div', { class: 'fn-pf-form' }, [
			leaseList,
			E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Description')), nameInput ]),
			E('div', { class: 'fn-pf-row' }, [
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Protocol')), protoSelect ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('External port')), extPortInput ])
			]),
			E('div', { class: 'fn-pf-row' }, [
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Internal address')), ipInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Internal port')), intPortInput ])
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
		if (!fields.extPort) {
			notify(_('Please enter an external port.'), 'warning');
			return;
		}
		if (!/^\d+(-\d+)?$/.test(fields.extPort)) {
			notify(_('External port must be a number or a range (e.g. 8080-8090).'), 'warning');
			return;
		}
		if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(fields.ip)) {
			notify(_('Please enter a valid internal IPv4 address.'), 'warning');
			return;
		}

		btn.disabled = true;

		return uci.load('firewall').then(() => {
			const section = this.editingSection || uci.add('firewall', 'redirect');
			uci.set('firewall', section, 'target', 'DNAT');
			uci.set('firewall', section, 'src', this.zones.wan);
			uci.set('firewall', section, 'dest', this.zones.lan);
			uci.set('firewall', section, 'name', fields.name || '');
			uci.set('firewall', section, 'proto', fields.proto.split(' '));
			uci.set('firewall', section, 'src_dport', fields.extPort);
			uci.set('firewall', section, 'dest_ip', fields.ip);
			if (fields.intPort)
				uci.set('firewall', section, 'dest_port', fields.intPort);
			else
				uci.unset('firewall', section, 'dest_port');
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
