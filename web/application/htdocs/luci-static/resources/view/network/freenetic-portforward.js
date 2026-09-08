'use strict';
'require view';
'require ui';
'require uci';
'require freenetic-rpc as rpc';
'require freenetic-ui as uiHelper';

/* Same raw-fetch ubus approach as the rest of this theme's custom views —
   see freenetic-dashboard.js for why (headless-tab requestAnimationFrame
   hang). Writes go through the real 'uci' module, same as everywhere else. */
const ubusCall = rpc.call;

const dom_empty = uiHelper.empty;
const notify = uiHelper.notify;
const applyChanges = uiHelper.applyChanges;

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
	let wanZone = null, lanZone = null, wanNetworks = [];
	Object.keys(firewall).forEach(k => {
		const z = firewall[k];
		if (z['.type'] !== 'zone')
			return;
		const nets = [].concat(z.network || []);
		if (z.masq === '1') {
			if (!wanZone)
				wanZone = z.name;
			if (!wanNetworks.length)
				wanNetworks = nets;
		}
		if (nets.indexOf('lan') !== -1 && !lanZone)
			lanZone = z.name;
	});
	return { wan: wanZone || 'wan', lan: lanZone || 'lan', wanNetworks: wanNetworks.length ? wanNetworks : [ 'wan' ] };
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
		return Promise.all([ getFirewallConfig(), getDhcpLeases(), uci.load('network') ]);
	},

	render(data) {
		this.firewall = data[0];
		this.leases = data[1];
		this.zones = detectZones(this.firewall);
		this.activeFamily = 'ipv4';

		this.table = E('div', { class: 'fn-table' });
		this.editingSection = null;
		this.modalOpen = false;

		this.fillTable();

		const ipv4Tab = E('button', { type: 'button', class: 'fn-tab fn-active', role: 'tab', 'aria-selected': 'true', click: () => this.setFamily('ipv4', ipv4Tab, ipv6Tab) }, _('IPv4'));
		const ipv6Tab = E('button', { type: 'button', class: 'fn-tab', role: 'tab', 'aria-selected': 'false', click: () => this.setFamily('ipv6', ipv6Tab, ipv4Tab) }, _('IPv6'));
		this.rulesTitle = E('h2', { class: 'fn-pf-section-title' }, _('Port Forwarding Rules'));
		this.upnpTable = E('div', { class: 'fn-pf-empty' }, _('No open ports'));

		return E('div', { class: 'fn-pf-page' }, [
			E('h1', { class: 'fn-pf-title' }, _('Port Forwarding')),
			E('p', { class: 'fn-pf-description' }, _('Here, you can allow access to services on your network from the Internet using both the IPv4 (port forwarding) and IPv6 (pinholing) protocols. When the setting is enabled, the firewall will permit incoming service traffic to reach a local destination. You can also monitor the rules automatically created via UPnP.')),
			E('div', { class: 'fn-tabs fn-pf-tabs', role: 'tablist' }, [ ipv4Tab, ipv6Tab ]),
			E('section', { class: 'fn-pf-section' }, [ this.rulesTitle, this.table ]),
			E('section', { class: 'fn-pf-section fn-pf-upnp-section' }, [
				E('h2', { class: 'fn-pf-section-title' }, _('UPnP Port Forwarding Table')),
				this.upnpTable
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

	setFamily(family, activeTab, inactiveTab) {
		this.activeFamily = family;
		activeTab.classList.add('fn-active');
		activeTab.setAttribute('aria-selected', 'true');
		inactiveTab.classList.remove('fn-active');
		inactiveTab.setAttribute('aria-selected', 'false');
		this.fillTable();
	},

	getRules() {
		return Object.keys(this.firewall)
			.map(k => this.firewall[k])
			.filter(s => {
				if (s['.type'] !== 'redirect' || s.target === 'SNAT')
					return false;
				const isV6 = s.family === 'ipv6' || s.ip6 === '1';
				return this.activeFamily === 'ipv6' ? isV6 : !isV6;
			});
	},

	fillTable() {
		const table = this.table;
		dom_empty(table);

		const rules = this.getRules();

		if (!rules.length) {
			table.appendChild(E('div', { class: 'fn-pf-empty' }, [
				E('span', {}, _('No rules created so far.')),
				E('button', {
					type: 'button', class: 'fn-pf-inline-link',
					click: () => this.openForm(null)
				}, _('Add rule'))
			]));
			return;
		}

		table.appendChild(E('div', { class: 'fn-table-row fn-table-head' }, [
			E('div', {}, _('Description')),
			E('div', {}, _('Protocol')),
			E('div', {}, _('External port')),
			E('div', {}, _('Internal address')),
			E('div', {}, _('Status')),
			E('div', {}, '')
		]));

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
		const isV6 = this.activeFamily === 'ipv6';
		const enabled = rule ? rule.enabled !== '0' : false;
		const existingPort = rule ? (rule.src_dport || '') : '';
		const portParts = existingPort.split('-');
		const isRange = portParts.length === 2;
		const inputNetwork = rule ? (rule.src || this.zones.wan) : this.zones.wan;

		const nameInput = E('input', { type: 'text', class: 'fn-input', placeholder: _('Description'), value: rule ? (rule.name || '') : '' });
		const enabledInput = E('input', { type: 'checkbox' });
		enabledInput.checked = enabled;

		const familyNetworks = this.zones.wanNetworks.filter(name => {
			const section = uci.sections('network', 'interface').find(item => item['.name'] === name);
			const proto = section && String(section.proto || '').toLowerCase();
			const looksIpv6 = name.toLowerCase().indexOf('6') !== -1 || proto === 'dhcpv6' || proto === 'static6';
			return isV6 ? looksIpv6 : !looksIpv6;
		});
		const networkNames = familyNetworks.length ? familyNetworks : this.zones.wanNetworks;
		const networkOptions = networkNames.map(name => {
			const section = uci.sections('network', 'interface').find(item => item['.name'] === name);
			const label = section && (section.label || section.description);
			const proto = section && section.proto;
			return E('option', { value: name }, label || (name + (proto ? ' (' + proto.toUpperCase() + ')' : '')));
		});
		const inputSelect = E('select', { class: 'fn-input' }, networkOptions);
		inputSelect.value = inputNetwork;
		if (!inputSelect.value && networkOptions.length)
			inputSelect.value = networkOptions[0].value;

		const outputSelect = E('select', { class: 'fn-input' });
		outputSelect.appendChild(E('option', { value: '' }, _('Select a destination')));
		const knownAddresses = {};
		this.leases.forEach(lease => {
			if (!lease.ipaddr || knownAddresses[lease.ipaddr])
				return;
			knownAddresses[lease.ipaddr] = true;
			outputSelect.appendChild(E('option', { value: lease.ipaddr }, lease.hostname ? lease.hostname + ' (' + lease.ipaddr + ')' : lease.ipaddr));
		});
		if (rule && rule.dest_ip && !knownAddresses[rule.dest_ip])
			outputSelect.appendChild(E('option', { value: rule.dest_ip }, rule.dest_ip));
		outputSelect.appendChild(E('option', { value: '__custom__' }, _('Enter address manually')));
		outputSelect.value = rule && rule.dest_ip ? rule.dest_ip : '';
		const customOutputInput = E('input', { type: 'text', class: 'fn-input', placeholder: isV6 ? '2001:db8::10' : '192.168.1.100', value: '' });
		const customOutputWrap = E('div', { class: 'fn-pf-custom-output', hidden: true }, [ customOutputInput ]);
		const updateOutput = () => { customOutputWrap.hidden = outputSelect.value !== '__custom__'; };
		outputSelect.addEventListener('change', updateOutput);
		updateOutput();

		const protoSelect = E('select', { class: 'fn-input' }, [
			E('option', { value: 'tcp' }, 'TCP'),
			E('option', { value: 'udp' }, 'UDP'),
			E('option', { value: 'tcp udp' }, 'TCP+UDP')
		]);
		protoSelect.value = rule ? [].concat(rule.proto || []).sort().join(' ') || 'tcp' : 'tcp';
		if (!protoSelect.value)
			protoSelect.value = 'tcp';

		const extPortInput = E('input', { type: 'text', class: 'fn-input', placeholder: '8080', value: isRange ? '' : existingPort });
		const rangeStartInput = E('input', { type: 'text', class: 'fn-input', placeholder: '8080', value: isRange ? portParts[0] : '' });
		const extPortEndInput = E('input', { type: 'text', class: 'fn-input', placeholder: '8090', value: isRange ? portParts[1] : '' });
		const intPortInput = E('input', { type: 'text', class: 'fn-input', placeholder: _('same as external'), value: rule ? (rule.dest_port || '') : '' });

		const leaseList = E('datalist', { id: 'fn-pf-leases' },
			this.leases.map(l => E('option', { value: l.ipaddr }, l.hostname ? l.hostname : l.ipaddr)));
		const errorNode = () => E('div', { class: 'fn-pf-error', hidden: true });
		const legendField = (label, control, error) => E('div', { class: 'fn-pf-legend-field' }, [
			E('label', {}, label), control, error
		]);
		const descriptionField = E('div', { class: 'fn-pf-description-field' }, [ nameInput ]);
		const outputError = errorNode();
		const portError = errorNode();
		const rangeStartError = errorNode();
		const rangeEndError = errorNode();
		const outputField = legendField(_('Output'), E('div', { class: 'fn-pf-output-control' }, [ outputSelect, customOutputWrap ]), outputError);
		const singlePortField = legendField(_('Open the port'), extPortInput, portError);
		const rangeStartField = legendField(_('Open the ports'), rangeStartInput, rangeStartError);
		const rangeEndField = legendField('', extPortEndInput, rangeEndError);
		const singlePortWrap = E('div', { class: 'fn-pf-single-port' }, [ singlePortField, legendField(_('Redirect to port'), intPortInput, errorNode()) ]);
		const rangePortWrap = E('div', { class: 'fn-pf-range-port', hidden: !isRange }, [ rangeStartField, E('span', { class: 'fn-pf-range-dash' }, '–'), rangeEndField ]);
		const singleRadio = E('input', { type: 'radio', name: 'fn-pf-rule-type', value: 'single' });
		const rangeRadio = E('input', { type: 'radio', name: 'fn-pf-rule-type', value: 'range' });
		singleRadio.checked = !isRange;
		rangeRadio.checked = isRange;
		const updatePortType = () => {
			singlePortWrap.hidden = !singleRadio.checked;
			rangePortWrap.hidden = !rangeRadio.checked;
		};
		singleRadio.addEventListener('change', updatePortType);
		rangeRadio.addEventListener('change', updatePortType);
		updatePortType();

		const saveBtn = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', style: 'width:auto; padding:8px 20px;' }, rule ? _('Save') : _('Add rule'));
		const cancelBtn = E('button', { type: 'button', class: 'fn-settings-btn', style: 'width:auto; padding:8px 20px;' }, _('Cancel'));
		const showError = (field, node, message) => {
			field.classList.add('fn-pf-invalid');
			node.textContent = message;
			node.hidden = false;
		};
		const clearError = (field, node) => {
			field.classList.remove('fn-pf-invalid');
			node.textContent = '';
			node.hidden = true;
		};
		const getOutputAddress = () => outputSelect.value === '__custom__' ? customOutputInput.value.trim() : outputSelect.value;
		const validAddress = value => isV6 ? /^[0-9A-Fa-f:]+$/.test(value) && value.indexOf(':') !== -1 : /^\d{1,3}(\.\d{1,3}){3}$/.test(value);
		const validPort = value => /^\d+$/.test(value) && parseInt(value, 10) >= 1 && parseInt(value, 10) <= 65535;
		const validate = () => {
			clearError(outputField, outputError);
			clearError(singlePortField, portError);
			clearError(rangeStartField, rangeStartError);
			clearError(rangeEndField, rangeEndError);
			let valid = true;
			const outputAddress = getOutputAddress();
			if (!outputAddress || !validAddress(outputAddress)) {
				showError(outputField, outputError, _('Fill in this field'));
				valid = false;
			}
			if (singleRadio.checked && !validPort(extPortInput.value.trim())) {
				showError(singlePortField, portError, _('Fill in this field'));
				valid = false;
			}
			if (rangeRadio.checked) {
				if (!validPort(rangeStartInput.value.trim())) {
					showError(rangeStartField, rangeStartError, _('Fill in this field'));
					valid = false;
				}
				if (!validPort(extPortEndInput.value.trim())) {
					showError(rangeEndField, rangeEndError, _('Fill in this field'));
					valid = false;
				}
			}
			return valid;
		};

		saveBtn.addEventListener('click', () => {
			if (!validate())
				return;
			const extPort = rangeRadio.checked ? rangeStartInput.value.trim() + '-' + extPortEndInput.value.trim() : extPortInput.value.trim();
			this.saveRule({
				name: nameInput.value.trim(),
				enabled: enabledInput.checked,
				family: isV6 ? 'ipv6' : 'ipv4',
				inputNetwork: inputSelect.value,
				proto: protoSelect.value,
				extPort: extPort,
				ip: getOutputAddress(),
				intPort: singleRadio.checked ? intPortInput.value.trim() : ''
			}, saveBtn);
		});
		cancelBtn.addEventListener('click', () => this.closeForm());

		const modalBody = [
			E('p', { class: 'fn-pf-modal-description' }, _('To grant access to the local network from the outside, select the network interface or subnet address and the protocol/port for the incoming traffic. For the outgoing traffic, select the client or interface destination. Port redirection can be set for single-port rules.')),
			E('label', { class: 'fn-pf-enable' }, [ enabledInput, E('span', {}, _('Enable rule')) ]),
			descriptionField,
			legendField(_('Input'), inputSelect, errorNode()),
			outputField,
			legendField(_('Protocol'), protoSelect, errorNode()),
			E('div', { class: 'fn-pf-rule-type' }, [
				E('span', { class: 'fn-pf-rule-type-label' }, _('Rule type')),
				E('label', {}, [ singleRadio, E('span', {}, _('Single port')) ]),
				E('label', {}, [ rangeRadio, E('span', {}, _('Port range')) ])
			]),
			E('div', { class: 'fn-pf-port-section' }, [ singlePortWrap, rangePortWrap ]),
			legendField(_('Work schedule'), E('select', { class: 'fn-input' }, [ E('option', { value: 'always' }, _('Always on')) ]), errorNode()),
			E('div', { class: 'fn-pf-modal-actions' }, [ saveBtn, cancelBtn ]),
			leaseList
		];

		ui.showModal(_('Port Forwarding Rule'), modalBody);
		this.modalOpen = true;
		const modal = document.querySelector('#modal_overlay .modal');
		if (modal) {
			modal.classList.add('fn-portforward-modal');
			const close = E('button', {
				type: 'button', class: 'fn-route-modal-close',
				'aria-label': _('Close'), click: () => this.closeForm()
			}, '×');
			modal.insertBefore(close, modal.firstChild);
		}
	},

	closeForm() {
		if (this.modalOpen) {
			ui.hideModal();
			this.modalOpen = false;
		}
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
		const validIp = fields.family === 'ipv6'
			? /^[0-9A-Fa-f:]+$/.test(fields.ip) && fields.ip.indexOf(':') !== -1
			: /^\d{1,3}(\.\d{1,3}){3}$/.test(fields.ip);
		if (!validIp) {
			notify(fields.family === 'ipv6' ? _('Please enter a valid internal IPv6 address.') : _('Please enter a valid internal IPv4 address.'), 'warning');
			return;
		}

		btn.disabled = true;

		return uci.load('firewall').then(() => {
			const section = this.editingSection || uci.add('firewall', 'redirect');
			uci.set('firewall', section, 'target', 'DNAT');
			uci.set('firewall', section, 'src', fields.inputNetwork || this.zones.wan);
			uci.set('firewall', section, 'dest', this.zones.lan);
			uci.set('firewall', section, 'name', fields.name || '');
			uci.set('firewall', section, 'proto', fields.proto.split(' '));
			uci.set('firewall', section, 'src_dport', fields.extPort);
			uci.set('firewall', section, 'dest_ip', fields.ip);
			if (fields.family === 'ipv6')
				uci.set('firewall', section, 'family', 'ipv6');
			else
				uci.unset('firewall', section, 'family');
			if (fields.enabled)
				uci.unset('firewall', section, 'enabled');
			else
				uci.set('firewall', section, 'enabled', '0');
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
