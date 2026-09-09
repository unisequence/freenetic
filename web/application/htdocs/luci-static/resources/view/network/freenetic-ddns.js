'use strict';
'require view';
'require ui';
'require uci';
'require fs';
'require freenetic-rpc as rpc';
'require freenetic-ui as uiHelper';

/* Dynamic DNS is kept as a small native editor over ddns-scripts.  The
 * provider updater, timers and credentials remain the stock OpenWrt ones;
 * Freenetic only writes the same UCI service sections and calls the package's
 * own helper for an immediate update. */
const ubusCall = rpc.call;
const dom_empty = uiHelper.empty;
const dom_content = uiHelper.content;
const notify = uiHelper.notify;
const applyChanges = uiHelper.applyChanges;

const DDNS_HELPER = '/usr/lib/ddns/dynamic_dns_lucihelper.sh';
const DDNS_PACKAGES = [ 'ddns-scripts', 'luci-app-ddns' ];
const CUSTOM_PROVIDER = '__custom__';
const SERVICE_ID_RE = /^[A-Za-z][A-Za-z0-9_]*$/;
const HOST_LABEL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const PROVIDER_LABELS = {
	'dyndns.org': 'DynDNS',
	'duckdns.org': 'DuckDNS',
	'no-ip.com': 'No-IP',
	'dynv6.com': 'dynv6',
	'cloudflare.com-v4': 'Cloudflare (IPv4)',
	'afraid.org-v2-token': 'FreeDNS (token)',
	'he.net': 'Hurricane Electric'
};
const COMMON_PROVIDERS = [ 'cloudflare.com-v4', 'duckdns.org', 'dyndns.org', 'dynv6.com', 'no-ip.com' ];

function listValue(value) {
	if (value == null || value === '')
		return [];
	return Array.isArray(value) ? value.slice() : [ value ];
}

function sectionName(section) {
	return section && (section['.name'] || section.name);
}

function providerLabel(name) {
	return PROVIDER_LABELS[name] || name;
}

function validHostname(value) {
	value = String(value || '').trim();
	if (!value || value.length > 253 || value[0] === '.' || value[value.length - 1] === '.')
		return false;
	return value.split('.').every(part => HOST_LABEL_RE.test(part));
}

function validUpdateUrl(value) {
	return /^(?:https?):\/\/[^\s]+$/i.test(String(value || '').trim());
}

function getPackageStatus() {
	return fs.exec_direct('/usr/libexec/freenetic-package-status', DDNS_PACKAGES, 'json')
		.then(result => result && result.packages || null)
		.catch(() => null);
}

function getDdnsState() {
	return ubusCall('luci.ddns', 'get_ddns_state', {}).catch(() => ({}));
}

function getServicesStatus() {
	return ubusCall('luci.ddns', 'get_services_status', {}).catch(() => ({}));
}

function providerName(entry) {
	const name = typeof entry === 'string' ? entry : entry && entry.name;
	return String(name || '').replace(/\.json$/, '');
}

function getProviders() {
	return Promise.all([
		fs.list('/usr/share/ddns/default').catch(() => []),
		fs.list('/usr/share/ddns/custom').catch(() => []),
		fs.read('/usr/share/ddns/list').catch(() => null)
	]).then(data => {
		const names = {};
		COMMON_PROVIDERS.forEach(name => { names[name] = true; });
		(data[0] || []).forEach(entry => { const name = providerName(entry); if (name) names[name] = true; });
		(data[1] || []).forEach(entry => { const name = providerName(entry); if (name) names[name] = true; });
		String(data[2] || '').split(/\r?\n/).forEach(name => { name = name.trim(); if (name) names[name] = true; });
		return Object.keys(names).sort();
	}).catch(() => COMMON_PROVIDERS.slice().sort());
}

function interfaceLabel(name) {
	const labels = {
		wan: _('Internet'),
		wan6: _('Internet (IPv6)'),
		lan: _('Home network'),
		guest: _('Guest network')
	};
	return labels[name] || name;
}

function statusRunning(status) {
	return !!(status && +status.pid > 0);
}

return view.extend({
	load() {
		return Promise.all([
			uci.load('ddns').catch(() => {}),
			uci.load('network').catch(() => {}),
			getPackageStatus(),
			getDdnsState(),
			getServicesStatus(),
			getProviders()
		]);
	},

	render(data) {
		window.__freeneticActiveView = this;
		this.packageStatus = data[2] || null;
		this.ddnsState = data[3] || {};
		this.serviceStatus = data[4] || {};
		this.providers = data[5] || COMMON_PROVIDERS.slice().sort();
		this.modalOpen = false;

		this.supportNode = E('div');
		this.listNode = E('div', { class: 'fn-oc-connections' });
		this.renderSupport();
		this.fillProfiles();

		const addButton = E('button', {
			type: 'button', class: 'fn-settings-btn fn-settings-btn-primary',
			click: () => this.openForm(null)
		}, _('Add profile'));
		addButton.disabled = !this.isReady();
		this.addButton = addButton;
		const refreshButton = E('button', {
			type: 'button', class: 'fn-settings-btn',
			click: () => this.refresh()
		}, _('Refresh'));

		return E('div', { class: 'fn-pf-page fn-oc-page fn-ddns-page' }, [
			E('div', { class: 'fn-oc-title-row' }, [
				E('div', {}, [
					E('h1', { class: 'fn-pf-title' }, _('Dynamic DNS')),
					E('p', { class: 'fn-pf-description' }, _('Keep a hostname pointed at this router when its public IP changes. Freenetic uses the native OpenWrt ddns-scripts service and never creates a separate updater.'))
				]),
				E('div', { class: 'fn-oc-head-actions' }, [ refreshButton, addButton ])
			]),
			this.supportNode,
			E('section', { class: 'fn-ddns-state fn-oc-notice' }, [
				E('strong', {}, _('DDNS service')),
				E('span', {}, this.serviceStateText())
			]),
			E('section', { class: 'fn-ddns-profiles' }, [ this.listNode ])
		]);
	},

	isReady() {
		const state = this.packageStatus && this.packageStatus['ddns-scripts'];
		return !!(state && state.installed);
	},

	renderSupport() {
		if (!this.supportNode)
			return;
		dom_empty(this.supportNode);
		if (this.isReady())
			return;

		const state = this.packageStatus && this.packageStatus['ddns-scripts'];
		const text = state && state.available
			? _('Install ddns-scripts to configure Dynamic DNS profiles.')
			: _('This firmware does not provide a compatible ddns-scripts package.');
		this.supportNode.appendChild(E('div', { class: 'fn-oc-notice fn-oc-notice-warning' }, [
			E('strong', {}, _('Dynamic DNS is not installed')),
			E('span', {}, text),
			E('a', { href: L.url('admin/system/applications'), class: 'fn-oc-notice-link' }, _('Open Applications'))
		]));
	},

	serviceStateText() {
		if (!this.isReady())
			return _('Install ddns-scripts before starting updates.');
		return this.ddnsState && (this.ddnsState._enabled === true || this.ddnsState._enabled === 1 || this.ddnsState._enabled === '1')
			? _('Autostart is enabled; profiles run on boot and interface events.')
			: _('Autostart is disabled; profiles can still be run manually.')
	},

	getInterfaces() {
		const result = [];
		const seen = {};
		uci.sections('network', 'interface').forEach(section => {
			const name = sectionName(section);
			if (!name || name === 'loopback' || section.proto === 'none' || seen[name])
				return;
			seen[name] = true;
			result.push({ value: name, label: section.label || section.description || interfaceLabel(name) });
		});
		if (!result.length)
			result.push({ value: 'wan', label: _('Internet') });
		return result;
	},

	getProfiles() {
		return uci.sections('ddns', 'service').map(section => {
			const id = sectionName(section);
			return {
				section: id,
				name: section.freenetic_name || section.name || id,
				provider: section.service_name || CUSTOM_PROVIDER,
				host: section.lookup_host || section.domain || '',
				domain: section.domain || section.lookup_host || '',
				username: section.username || '',
				password: section.password || '',
				useIpv6: section.use_ipv6 === '1',
				network: section.ip_network || section.interface || 'wan',
				enabled: section.enabled !== '0',
				status: this.serviceStatus[id] || {}
			};
		});
	},

	fillProfiles() {
		if (!this.listNode)
			return;
		dom_empty(this.listNode);
		const profiles = this.getProfiles();
		if (!profiles.length) {
			this.listNode.appendChild(E('div', { class: 'fn-oc-empty' }, [
				E('strong', {}, _('No Dynamic DNS profiles configured')),
				E('span', {}, _('Add a provider and hostname to keep a DNS record synchronized with this router.')),
				E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', disabled: !this.isReady(), click: () => this.openForm(null) }, _('Add profile'))
			]));
			return;
		}
		profiles.forEach(profile => this.listNode.appendChild(this.renderProfile(profile)));
	},

	renderProfile(profile) {
		const running = statusRunning(profile.status);
		const statusText = !profile.enabled ? _('Disabled') : running ? _('Running') : _('Not running');
		const statusClass = !profile.enabled || !running ? 'fn-status-off' : 'fn-status-ok';
		const statusPill = E('span', { class: 'fn-status-pill ' + statusClass }, statusText);
		const toggleInput = E('input', { type: 'checkbox', class: 'fn-switch-input' });
		toggleInput.checked = profile.enabled;
		const toggleLabel = E('label', { class: 'fn-switch fn-oc-switch' }, [ toggleInput, E('span', { class: 'fn-switch-slider' }) ]);
		toggleInput.addEventListener('change', () => this.toggleProfile(profile.section, toggleInput));

		const currentIp = profile.status.ip || _('No data');
		const info = [
			[ _('Provider'), profile.provider === CUSTOM_PROVIDER ? _('Custom provider') : providerLabel(profile.provider) ],
			[ _('Hostname'), profile.host || _('Configuration error') ],
			[ _('Record'), profile.useIpv6 ? 'AAAA (IPv6)' : 'A (IPv4)' ],
			[ _('Network'), interfaceLabel(profile.network) ],
			[ _('Current IP'), currentIp ],
			[ _('Last update'), profile.status.last_update || _('Never') ]
		];
		const grid = E('div', { class: 'fn-info-grid fn-oc-info-grid' }, info.map(item => E('div', { class: 'fn-info-item' }, [
			E('div', { class: 'fn-info-label' }, item[0]),
			E('div', { class: 'fn-info-value' }, item[1])
		])));

		const update = E('button', { type: 'button', class: 'fn-settings-btn', disabled: !this.isReady() || !profile.enabled,
			click: () => this.forceUpdate(profile.section, update) }, _('Update now'));
		const edit = E('button', { type: 'button', class: 'fn-settings-btn', disabled: !this.isReady(),
			click: () => this.openForm(profile) }, _('Edit'));
		const remove = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-danger',
			click: () => this.deleteProfile(profile.section) }, _('Delete'));

		return E('article', { class: 'fn-card fn-oc-card fn-ddns-card' }, [
			E('div', { class: 'fn-card-head fn-oc-card-head' }, [
				svgIcon('M4 7h16M4 12h16M4 17h16', 20),
				E('div', { class: 'fn-oc-card-title' }, [
					E('h3', {}, profile.name),
					E('span', { class: 'fn-oc-protocol' }, profile.provider === CUSTOM_PROVIDER ? _('Custom provider') : providerLabel(profile.provider))
				]),
				toggleLabel,
				statusPill
			]),
			E('div', { class: 'fn-card-body' }, [ grid, E('div', { class: 'fn-pf-actions fn-oc-actions' }, [ update, edit, remove ]) ])
		]);
	},

	openForm(profile) {
		if (!this.isReady()) {
			notify(_('Install ddns-scripts before adding a profile.'), 'warning');
			return;
		}
		if (this.modalOpen)
			ui.hideModal();
		profile = profile || {
			section: null, name: 'myddns', provider: 'duckdns.org', host: '', domain: '', username: '', password: '',
			useIpv6: false, network: 'wan', enabled: true, status: {}
		};
		this.editingSection = profile.section;

		const idInput = E('input', { type: 'text', class: 'fn-input', value: profile.section || profile.name || '', placeholder: 'myddns', disabled: !!profile.section });
		const nameInput = E('input', { type: 'text', class: 'fn-input', value: profile.name || '', placeholder: _('Home router') });
		const providerNames = this.providers.slice();
		if (profile.provider && profile.provider !== CUSTOM_PROVIDER && providerNames.indexOf(profile.provider) === -1)
			providerNames.push(profile.provider);
		providerNames.sort();
		const providerInput = E('select', { class: 'fn-input' }, [
			E('option', { value: CUSTOM_PROVIDER }, _('Custom provider')),
			...providerNames.map(name => E('option', { value: name }, providerLabel(name)))
		]);
		providerInput.value = profile.provider || CUSTOM_PROVIDER;
		const hostInput = E('input', { type: 'text', class: 'fn-input', value: profile.host || '', placeholder: 'home.example.com' });
		const usernameInput = E('input', { type: 'text', class: 'fn-input', value: profile.username || '', placeholder: _('Optional') });
		const passwordInput = E('input', { type: 'password', class: 'fn-input', value: profile.password || '', placeholder: _('Password or API token') });
		const recordInput = E('select', { class: 'fn-input' }, [ E('option', { value: '0' }, _('IPv4 address (A)')), E('option', { value: '1' }, _('IPv6 address (AAAA)')) ]);
		recordInput.value = profile.useIpv6 ? '1' : '0';
		const networks = this.getInterfaces();
		const networkInput = E('select', { class: 'fn-input' }, networks.map(item => E('option', { value: item.value }, item.label)));
		networkInput.value = profile.network || (profile.useIpv6 && networks.some(item => item.value === 'wan6') ? 'wan6' : 'wan');
		if (!networkInput.value && networks.length)
			networkInput.value = networks[0].value;
		const customUrlInput = E('input', { type: 'url', class: 'fn-input', value: profile.section ? uci.get('ddns', profile.section, 'update_url') || '' : '', placeholder: 'https://provider.example/update?...' });
		const customUrlWrap = E('div', { class: 'fn-settings-field fn-ddns-custom-url', hidden: providerInput.value !== CUSTOM_PROVIDER }, [
			E('label', {}, _('Custom update URL')), customUrlInput,
			E('span', { class: 'fn-oc-field-hint' }, _('Use [DOMAIN], [USERNAME], [PASSWORD] and [IP] placeholders as required by the provider.'))
		]);
		const enabledInput = E('input', { type: 'checkbox' });
		enabledInput.checked = profile.enabled !== false;
		providerInput.addEventListener('change', () => { customUrlWrap.hidden = providerInput.value !== CUSTOM_PROVIDER; });

		const save = E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', click: () => this.saveProfile({
			id: idInput.value.trim(), name: nameInput.value.trim(), provider: providerInput.value, host: hostInput.value.trim(),
			username: usernameInput.value.trim(), password: passwordInput.value, useIpv6: recordInput.value === '1',
			network: networkInput.value, customUrl: customUrlInput.value.trim(), enabled: enabledInput.checked
		}, save) }, profile.section ? _('Save') : _('Add profile'));
		const cancel = E('button', { type: 'button', class: 'fn-settings-btn', click: () => this.closeForm() }, _('Cancel'));
		const body = [
			E('p', { class: 'fn-oc-modal-description' }, _('Use a provider hostname or your own domain. Credentials stay in the router UCI configuration and are never sent to Freenetic.')),
			E('div', { class: 'fn-oc-form-grid' }, [
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Profile ID')), idInput, E('span', { class: 'fn-oc-field-hint' }, _('Letters, numbers and underscores; used as the OpenWrt service name.')) ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Display name')), nameInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Provider')), providerInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Hostname')), hostInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Username')), usernameInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Password / token')), passwordInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Record type')), recordInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('IP address source')), networkInput ]),
				customUrlWrap
			]),
			E('label', { class: 'fn-oc-enable' }, [ enabledInput, E('span', {}, _('Profile enabled')) ]),
			E('div', { class: 'fn-oc-modal-actions' }, [ save, cancel ])
		];

		ui.showModal(profile.section ? _('Edit DDNS profile') : _('Add DDNS profile'), body);
		this.modalOpen = true;
		const modal = document.querySelector('#modal_overlay .modal');
		if (modal) {
			modal.classList.add('fn-oc-modal');
			const close = E('button', { type: 'button', class: 'fn-route-modal-close', 'aria-label': _('Close'), click: () => this.closeForm() }, '×');
			modal.insertBefore(close, modal.firstChild);
		}
	},

	closeForm() {
		if (this.modalOpen)
			ui.hideModal();
		this.modalOpen = false;
		this.editingSection = null;
	},

	validateProfile(fields) {
		if (!SERVICE_ID_RE.test(fields.id))
			return _('Profile ID must start with a letter and contain only letters, numbers or underscores.');
		if (!fields.name)
			return _('Enter a display name.');
		if (!validHostname(fields.host))
			return _('Enter a valid hostname, for example home.example.com.');
		if (fields.provider === CUSTOM_PROVIDER && !validUpdateUrl(fields.customUrl))
			return _('Enter an HTTP or HTTPS update URL for the custom provider.');
		return null;
	},

	saveProfile(fields, button) {
		const error = this.validateProfile(fields);
		if (error) {
			notify(error, 'warning');
			return Promise.resolve();
		}
		if (!this.editingSection && uci.get('ddns', fields.id)) {
			notify(_('That profile ID is already in use.'), 'warning');
			return Promise.resolve();
		}
		button.disabled = true;
		const section = this.editingSection || fields.id;
		if (!uci.get('ddns', 'global')) {
			uci.add('ddns', 'ddns', 'global');
			uci.set('ddns', 'global', 'ddns_dateformat', '%F %R');
			uci.set('ddns', 'global', 'ddns_loglines', '250');
		}
		if (!uci.get('ddns', section))
			uci.add('ddns', 'service', section);
		uci.set('ddns', section, 'freenetic_name', fields.name);
		uci.set('ddns', section, 'lookup_host', fields.host);
		uci.set('ddns', section, 'domain', fields.host);
		uci.set('ddns', section, 'username', fields.username);
		uci.set('ddns', section, 'password', fields.password);
		uci.set('ddns', section, 'enabled', fields.enabled ? '1' : '0');
		uci.set('ddns', section, 'use_ipv6', fields.useIpv6 ? '1' : '0');
		uci.set('ddns', section, 'ip_source', 'network');
		uci.set('ddns', section, 'ip_network', fields.network || 'wan');
		uci.set('ddns', section, 'interface', fields.network || 'wan');
		if (fields.provider === CUSTOM_PROVIDER) {
			uci.unset('ddns', section, 'service_name');
			uci.set('ddns', section, 'update_url', fields.customUrl);
		}
		else {
			uci.set('ddns', section, 'service_name', fields.provider);
			uci.unset('ddns', section, 'update_url');
		}
		return uci.save().then(() => applyChanges()).then(() => this.restartDdns().catch(error => ({ error: error }))).then(result => {
			const message = this.editingSection ? _('DDNS profile saved.') : _('DDNS profile added.');
			if (result && result.error)
				notify(message + ' ' + _('The DDNS service could not be restarted: %s').format(result.error.message || result.error), 'warning');
			else
				notify(message, 'info');
			this.closeForm();
			return this.refresh();
		}).catch(error => {
			button.disabled = false;
			notify(_('Failed to save DDNS profile: %s').format(error.message || error), 'danger');
		});
	},

	forceUpdate(section, button) {
		if (!SERVICE_ID_RE.test(section))
			return;
		button.disabled = true;
		dom_content(button, _('Updating…'));
		return fs.exec(DDNS_HELPER, [ '-S', section, '--', 'start' ]).then(() => {
			notify(_('DDNS update started for %s.').format(section), 'info');
			return this.refresh();
		}).catch(error => {
			notify(_('DDNS update failed: %s').format(error.message || error), 'danger');
		}).finally(() => {
			button.disabled = false;
			dom_content(button, _('Update now'));
		});
	},

	toggleProfile(section, input) {
		if (!SERVICE_ID_RE.test(section))
			return;
		input.disabled = true;
		return uci.load('ddns').then(() => {
			uci.set('ddns', section, 'enabled', input.checked ? '1' : '0');
			return uci.save();
		}).then(() => applyChanges()).then(() => this.restartDdns()).then(() => this.refresh()).catch(error => {
			input.checked = !input.checked;
			notify(_('Failed to change DDNS profile state: %s').format(error.message || error), 'danger');
		}).finally(() => { input.disabled = false; });
	},

	deleteProfile(section) {
		if (!SERVICE_ID_RE.test(section) || !window.confirm(_('Delete DDNS profile %s?').format(section)))
			return;
		return uci.load('ddns').then(() => {
			uci.remove('ddns', section);
			return uci.save();
		}).then(() => applyChanges()).then(() => this.restartDdns().catch(() => null)).then(() => {
			notify(_('DDNS profile deleted.'), 'info');
			return this.refresh();
		}).catch(error => notify(_('Failed to delete DDNS profile: %s').format(error.message || error), 'danger'));
	},

	restartDdns() {
		if (!this.isReady())
			return Promise.resolve();
		return fs.exec(DDNS_HELPER, [ 'restart' ]);
	},

	refresh() {
		return Promise.all([
			uci.load('ddns').catch(() => {}),
			getDdnsState(),
			getServicesStatus()
		]).then(data => {
			this.ddnsState = data[1] || {};
			this.serviceStatus = data[2] || {};
			this.renderSupport();
			if (this.addButton)
				this.addButton.disabled = !this.isReady();
			this.fillProfiles();
		});
	},

	addFooter() { return E([]); }
});

function svgIcon(d, size) {
	size = size || 20;
	const span = E('span', { class: 'fn-icon' });
	span.innerHTML = '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">' +
		'<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
	return span;
}
