'use strict';
'require view';
'require fs';
'require zapret2.v4r30.rpc as api';
'require freenetic-ui as uiHelper';

const NATIVE_RUNTIME_PACKAGE = 'zapret2';
const FREENETIC_RUNTIME_PACKAGE = 'freenetic-zapret2';
const NATIVE_UI_PACKAGE = 'luci-app-zapret2';

function applicationsUrl() {
	return L.url('admin/system/applications') + '?focus=nfqws2';
}

function packageStatus() {
	return fs.exec_direct('/usr/libexec/freenetic-package-status', [
		NATIVE_RUNTIME_PACKAGE, FREENETIC_RUNTIME_PACKAGE, NATIVE_UI_PACKAGE
	], 'json').then(result => result && result.packages || null).catch(() => null);
}

function installed(packages, name) {
	return !!(packages && packages[name] && packages[name].installed);
}

function route(name) {
	return L.url('admin/network/zapret2/' + name);
}

return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	load() {
		return Promise.all([
			packageStatus(),
			api.status().catch(error => ({ error: error }))
		]);
	},

	refreshStatus() {
		return api.status().then(status => {
			this.setStatus(status);
		}).catch(error => {
			uiHelper.notify(_('Could not read Zapret2 status: %s').format(error.message || error), 'danger');
		});
	},

	setStatus(status) {
		this.currentStatus = status;
		if (!this.statusLabel)
			return;
		const running = !!status.running;
		this.statusLabel.className = 'fn-status-pill ' + (running ? 'fn-status-ok' : 'fn-status-off');
		this.statusLabel.textContent = running ? _('Running') : status.enabled ? _('Stopped') : _('Disabled');
		this.profileCount.textContent = '%d / %d'.format(status.enabled_profile_count || 0, status.profile_count || 0);
		this.startButton.disabled = this.serviceBusy || running || !status.enabled || status.config_state === 'incompatible';
		this.reloadButton.disabled = this.serviceBusy || !running;
		this.stopButton.disabled = this.serviceBusy || !running;
		this.lastError.textContent = status.last_error || '';
		this.lastError.hidden = !status.last_error;
	},

	service(action) {
		if (this.serviceBusy)
			return;
		this.serviceBusy = true;
		this.setStatus(this.currentStatus);
		return api.service(action).then(status => {
			this.serviceBusy = false;
			this.setStatus(status);
			uiHelper.notify(_('Zapret2 service updated.'), 'info');
		}).catch(error => {
			this.serviceBusy = false;
			uiHelper.notify(_('Could not update Zapret2: %s').format(error.message || error), 'danger');
		}).finally(() => this.refreshStatus());
	},

	render(data) {
		const packages = data[0];
		if (!installed(packages, NATIVE_RUNTIME_PACKAGE) && !installed(packages, FREENETIC_RUNTIME_PACKAGE)) {
			return E('section', { class: 'fn-card fn-zapret-missing' }, [
				E('div', { class: 'fn-card-body' }, [
					E('strong', {}, _('Zapret2 is not installed')),
					E('p', {}, _('Install Zapret2 from Applications. Installation does not enable traffic processing.')),
					E('a', { class: 'fn-settings-btn fn-settings-btn-primary', href: applicationsUrl() }, _('Open Applications'))
				])
			]);
		}

		const status = data[1] && !data[1].error ? data[1] : null;
		if (!status) {
			const fallback = installed(packages, NATIVE_UI_PACKAGE)
				? E('a', { class: 'fn-settings-btn', href: L.url('admin/services/zapret2') }, _('Open installed Zapret2 interface')) : null;
			return E('section', { class: 'fn-card fn-zapret-missing' }, [
				E('div', { class: 'fn-card-body' }, [
					E('strong', {}, _('Zapret2 status is unavailable')),
					E('p', {}, _('The installed runtime does not expose the Zapret2 API used by this page. Its existing settings were not changed.')),
					fallback || ''
				])
			]);
		}

		this.serviceBusy = false;
		this.statusLabel = E('span', { class: 'fn-status-pill' });
		this.profileCount = E('strong');
		this.lastError = E('p', { class: 'fn-zapret-error', hidden: '' });
		this.startButton = E('button', { class: 'fn-settings-btn fn-settings-btn-primary', click: () => this.service('start') }, _('Start'));
		this.reloadButton = E('button', { class: 'fn-settings-btn', click: () => this.service('reload') }, _('Reload'));
		this.stopButton = E('button', { class: 'fn-settings-btn fn-settings-btn-danger', click: () => this.service('stop') }, _('Stop'));

		const page = E('div', { class: 'fn-zapret-home' }, [
			E('div', { class: 'fn-zapret-title-row' }, [
				E('div', {}, [ E('h2', {}, _('Zapret2')), E('p', { class: 'fn-pf-description' }, _('Traffic interception and bypass profiles on this router.')) ]),
				this.statusLabel
			]),
			E('section', { class: 'fn-card fn-zapret-card' }, [
				E('div', { class: 'fn-card-head' }, E('strong', {}, _('Service'))),
				E('div', { class: 'fn-card-body' }, [
					E('div', { class: 'fn-zapret-runtime-meta' }, [
						E('span', {}, [ _('Enabled profiles'), ': ', this.profileCount ]),
						this.lastError
					]),
					E('div', { class: 'fn-zapret-home-actions' }, [ this.startButton, this.reloadButton, this.stopButton ])
				])
			]),
			E('div', { class: 'fn-zapret-home-links' }, [
				[ 'config', _('Settings'), _('Traffic interception and service parameters.') ],
				[ 'profiles', _('Bypass profiles'), _('Ports, protocols and traffic rules.') ],
				[ 'lists', _('Local lists'), _('Domain and IP lists used by the profiles.') ],
				[ 'log', _('System log'), _('Recent Zapret2 service messages.') ]
			].map(item => E('a', { class: 'fn-card fn-zapret-home-link', href: route(item[0]) }, [
				E('strong', {}, item[1]), E('span', {}, item[2]), E('span', { 'aria-hidden': 'true' }, '→')
			])))
		]);
		this.setStatus(status);
		return page;
	},

	addFooter() { return E([]); }
});
