'use strict';
'require view';
'require fs';
'require freenetic-rpc as rpc';
'require freenetic-ui as uiHelper';

const PACKAGE_HELPER = '/usr/libexec/freenetic-mihomo-package';
const notify = uiHelper.notify;

function applicationsUrl() {
	return L.url('admin/system/applications') + '?focus=mihomo';
}

function apiCall(method, args) {
	return rpc.call('mihomo', method, Object.assign({ api_version: 1 }, args || {})).then(reply => {
		if (!reply || reply.ok !== true)
			throw new Error(reply && reply.error && reply.error.message || _('Mihomo operation failed.'));
		return reply.data || {};
	});
}

function statusPill(status) {
	const running = status && status.running;
	return E('span', { class: 'fn-status-pill ' + (running ? 'fn-status-ok' : 'fn-status-off') },
		running ? _('Running') : _('Stopped'));
}

function inputField(label, control, hint) {
	const children = [ E('label', {}, label), control ];
	if (hint)
		children.push(E('small', { class: 'fn-field-hint' }, hint));
	return E('div', { class: 'fn-settings-field' }, children);
}

function checkbox(label, checked) {
	const input = E('input', { type: 'checkbox' });
	input.checked = !!checked;
	return E('label', { class: 'fn-mihomo-check' }, [ input, E('span', {}, label) ]);
}

return view.extend({
	load() {
		return Promise.all([
			apiCall('status').catch(() => null),
			fs.exec_direct(PACKAGE_HELPER, [ 'status' ], 'json').catch(() => null)
		]);
	},

	render(data) {
		const packageStatus = data && data[1];
		const status = packageStatus && packageStatus.installed ? data[0] : null;
		this.status = status || {};
		if (!packageStatus || !packageStatus.installed)
			return this.renderMissing();
		return this.renderInstalled();
	},

	renderMissing() {
		return E('section', { class: 'fn-card fn-zapret-missing' }, [
			E('div', { class: 'fn-card-head' }, [ E('h3', {}, _('Mihomo')) ]),
			E('div', { class: 'fn-card-body' }, [
				E('strong', {}, _('Mihomo is not installed')),
				E('p', {}, _('Install Mihomo from Applications to convert proxy links and subscriptions on the router.')),
				E('a', { class: 'fn-settings-btn fn-settings-btn-primary', href: applicationsUrl() }, _('Open Applications'))
			])
		]);
	},

	renderInstalled() {
		const status = this.status || {};
		const sourceMode = status.source_mode === 'subscriptions' ? 'subscriptions' : 'links';
		const mode = E('select', { class: 'fn-settings-input' }, [
			E('option', { value: 'links' }, _('Proxy links')),
			E('option', { value: 'subscriptions' }, _('Subscriptions'))
		]);
		mode.value = sourceMode;
		const input = E('textarea', {
			class: 'fn-settings-input fn-mihomo-input',
			rows: 8,
			wrap: 'off',
			placeholder: sourceMode === 'links' ? _('vless://, vmess://, ss:// or trojan:// — one per line') : _('https://example.com/subscription — one URL per line')
		}, status.provider_input || '');
		const port = E('input', { class: 'fn-settings-input', type: 'number', min: 1, max: 65535, value: status.mixed_port || 7890 });
		const allowLan = checkbox(_('Allow access from LAN'), !!status.allow_lan);
		const webUi = checkbox(_('Open Mihomo Web UI'), !!status.web_ui);
		const apply = E('button', { class: 'fn-settings-btn fn-settings-btn-primary', type: 'button' }, _('Apply configuration'));
		const serviceButtons = [ 'start', 'stop', 'restart' ].map(action => E('button', {
			class: 'fn-settings-btn', type: 'button', click: () => this.service(action)
		}, { start: _('Start'), stop: _('Stop'), restart: _('Restart') }[action]));
		const logButton = E('button', { class: 'fn-settings-btn', type: 'button', click: () => this.showLogs() }, _('Logs'));
		const log = E('pre', { class: 'fn-mihomo-log', hidden: true });

		mode.addEventListener('change', () => {
			input.placeholder = mode.value === 'links'
				? _('vless://, vmess://, ss:// or trojan:// — one per line')
				: _('https://example.com/subscription — one URL per line');
		});
		apply.addEventListener('click', () => this.applyConfig({ mode, input, port, allowLan, webUi, apply }));
		this.mihomoFields = { mode, input, port, allowLan, webUi, apply, log };

		return E('div', { class: 'fn-mihomo-page' }, [
			E('div', { class: 'fn-card fn-mihomo-hero' }, [
				E('div', { class: 'fn-card-head' }, [ E('h3', {}, _('Mihomo')), statusPill(status) ]),
				E('div', { class: 'fn-card-body' }, [
					E('p', { class: 'fn-info-empty' }, _('Mihomo converts proxy links and subscriptions locally on the router. No Node.js or cloud converter is required.')),
					E('div', { class: 'fn-mihomo-meta' }, [
						E('span', {}, _('Version: %s').format(status.version || _('Unknown'))),
						E('span', {}, _('Controller: %s').format(status.controller || '127.0.0.1:9090'))
					])
				])
			]),
			E('div', { class: 'fn-mihomo-layout' }, [
				E('section', { class: 'fn-card fn-mihomo-card' }, [
					E('div', { class: 'fn-card-head' }, [ E('h3', {}, _('Configuration')) ]),
					E('div', { class: 'fn-card-body' }, [
						inputField(_('Source type'), mode, _('Mihomo parses links and remote subscriptions itself.')),
						inputField(_('Sources'), input, _('One item per line. Existing local links are loaded when available.')),
						inputField(_('Mixed port'), port, _('Port exposed by Mihomo for local clients.')),
						E('div', { class: 'fn-mihomo-checks' }, [ allowLan, webUi ]),
						E('div', { class: 'fn-mihomo-actions' }, [ apply ])
					])
				]),
				E('section', { class: 'fn-card fn-mihomo-card' }, [
					E('div', { class: 'fn-card-head' }, [ E('h3', {}, _('Service')), statusPill(status) ]),
					E('div', { class: 'fn-card-body' }, [
						E('div', { class: 'fn-mihomo-actions' }, serviceButtons.concat([ logButton ])),
						log
					])
				])
			])
		]);
	},

	applyConfig(fields) {
		const button = fields.apply;
		button.disabled = true;
		uiHelper.content(button, _('Applying…'));
		return apiCall('apply', {
			source_mode: fields.mode.value,
			input: fields.input.value,
			mixed_port: Number(fields.port.value),
			allow_lan: fields.allowLan.querySelector('input').checked,
			web_ui: fields.webUi.querySelector('input').checked
		}).then(result => {
			this.status = result.status || this.status;
			notify(_('Mihomo configuration applied.'), 'info');
			return this.refreshStatus();
		}).catch(error => notify(_('Failed to apply Mihomo configuration: %s').format(error.message || error), 'danger'))
			.finally(() => {
				button.disabled = false;
				uiHelper.content(button, _('Apply configuration'));
			});
	},

	service(action) {
		return apiCall('service', { action: action })
			.then(result => {
				this.status = result.status || this.status;
				notify(_('Mihomo service updated.'), 'info');
				return this.refreshStatus();
			})
			.catch(error => notify(_('Mihomo service action failed: %s').format(error.message || error), 'danger'));
	},

	showLogs() {
		const log = this.mihomoFields && this.mihomoFields.log;
		if (!log)
			return;
		log.hidden = false;
		log.textContent = _('Loading logs…');
		return apiCall('logs').then(data => {
			log.textContent = data.text || _('No logs yet.');
		}).catch(error => { log.textContent = error.message || String(error); });
	},

	refreshStatus() {
		return apiCall('status').then(status => {
			this.status = status;
			return status;
		});
	},

	addFooter() { return E([]); }
});
