'use strict';
'require view';
'require fs';
'require ui';
'require freenetic-ui as uiHelper';

const MIXOMO_HELPER = '/usr/libexec/freenetic-mixomo';
const MAGITRICKLE_HELPER = '/usr/libexec/freenetic-magitrickle-package';
const notify = uiHelper.notify;

/* MagiTrickle owns its web UI on port 8080. This toolbar manages only the
 * optional Mihomo tunnel that its Internet Helper list expects. */
return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	load() {
		return fs.exec_direct(MIXOMO_HELPER, [ 'status' ], 'json').catch(() => null);
	},

	refreshBridge() {
		return this.load().then(status => this.renderBridge(status));
	},

	renderBridge(status) {
		this.bridgeStatus = status;
		uiHelper.empty(this.bridgeActions);
		if (!status || status.code !== 0) {
			this.bridgeState.textContent = _('Tunnel status is unavailable.');
			return;
		}
		this.bridgeState.textContent = status.external_running ? _('Mixomo tunnel is connected.') :
			status.external_bridge ? _('Mixomo tunnel is configured but stopped.') :
			status.bridge_running ? _('Mihomo tunnel is connected.') :
			status.bridge_configured ? _('Mihomo tunnel is configured but stopped.') :
			_('Mihomo tunnel is not connected.');
		if (status.external_bridge) {
			this.bridgeActions.appendChild(E('span', { class: 'fn-magitrickle-hint' },
				_('This tunnel is managed by the Mixomo installer. Freenetic will not replace its network or firewall settings.')));
			if (status.external_running)
				this.bridgeActions.appendChild(E('button', {
					type: 'button', class: 'fn-settings-btn', click: () => this.confirmList()
				}, _('Install Internet Helper list')));
			return;
		}
		if (!status.mihomo_installed) {
			this.bridgeActions.appendChild(E('span', { class: 'fn-magitrickle-hint' },
				_('Install and start Mihomo to use the Internet Helper list. Other VPN interfaces can be selected in MagiTrickle.')));
			return;
		}
		const action = (label, handler, primary) => E('button', {
			type: 'button', class: 'fn-settings-btn' + (primary ? ' fn-settings-btn-primary' : ''),
			click: handler
		}, label);
		this.bridgeActions.appendChild(action(status.bridge_configured ? _('Reconnect tunnel') : _('Connect to Mihomo'),
			() => this.confirmBridge('connect'), true));
		if (status.bridge_configured)
			this.bridgeActions.appendChild(action(_('Disconnect tunnel'), () => this.confirmBridge('disconnect')));
		if (status.bridge_running)
			this.bridgeActions.appendChild(action(_('Install Internet Helper list'), () => this.confirmList()));
	},

	confirmBridge(action) {
		const connecting = action === 'connect';
		ui.showModal(connecting ? _('Connect MagiTrickle to Mihomo?') : _('Disconnect Mihomo tunnel?'), [
			E('p', {}, connecting
				? _('Freenetic will install hev-socks5-tunnel and add its own network and firewall sections. The network may briefly reload.')
				: _('Freenetic will remove only the tunnel sections it created. MagiTrickle and Mihomo remain installed.')),
			E('div', { class: 'button-row' }, [
				E('button', { class: 'btn', click: ui.hideModal }, _('Cancel')),
				E('button', { class: 'btn cbi-button-positive', click: () => this.runBridge(action) },
					connecting ? _('Connect') : _('Disconnect'))
			])
		]);
	},

	runBridge(action) {
		const firstConnection = action === 'connect' && this.bridgeStatus && !this.bridgeStatus.bridge_configured;
		ui.showModal(_('Updating Mihomo tunnel…'), [ E('p', { class: 'spinning' }, _('Applying the tunnel and firewall settings.')) ]);
		return fs.exec_direct(MIXOMO_HELPER, [ action ], 'json').then(result => {
			ui.hideModal();
			if (!result || result.code !== 0)
				throw new Error(result && (result.stderr || result.stdout) || _('unknown error'));
			return this.refreshBridge().then(() => {
				notify(action === 'connect' ? _('Mihomo tunnel connected.') : _('Mihomo tunnel disconnected.'), 'info');
				if (firstConnection)
					this.confirmList();
			});
		}).catch(error => {
			ui.hideModal();
			notify(_('Could not update the Mihomo tunnel: %s').format(error.message || error), 'danger');
			this.refreshBridge();
		});
	},

	confirmList() {
		const variant = E('select', { class: 'cbi-input-select' }, [
			E('option', { value: '1' }, _('Internet Helper #1')),
			E('option', { value: '2' }, _('Internet Helper #2'))
		]);
		ui.showModal(_('Install Internet Helper list?'), [
			E('p', {}, _('The list routes selected domains through the Mihomo tunnel. An existing MagiTrickle configuration will be backed up.')),
			E('label', { class: 'fn-magitrickle-list-choice' }, [ _('Choose a list'), variant ]),
			E('div', { class: 'button-row' }, [
				E('button', { class: 'btn', click: ui.hideModal }, _('Later')),
				E('button', { class: 'btn cbi-button-positive', click: () => this.installList(variant.value) }, _('Install list'))
			])
		]);
	},

	installList(variant) {
		ui.showModal(_('Installing Internet Helper list…'), [ E('p', { class: 'spinning' }, _('The list is being downloaded and applied to MagiTrickle.')) ]);
		return fs.exec_direct(MAGITRICKLE_HELPER, [ variant === '2' ? 'install-ih-list-2' : 'install-ih-list-1' ], 'json').then(result => {
			ui.hideModal();
			if (!result || result.code !== 0)
				throw new Error(result && (result.stderr || result.stdout) || _('unknown error'));
			notify(_('Internet Helper list installed.'), 'info');
			if (this.frame)
				this.frame.src = this.frame.src;
		}).catch(error => {
			ui.hideModal();
			notify(_('Failed to install the Internet Helper list: %s').format(error.message || error), 'danger');
		});
	},

	render(status) {
		const url = 'http://' + window.location.hostname + ':8080';
		this.bridgeState = E('span', { class: 'fn-magitrickle-bridge-state' });
		this.bridgeActions = E('div', { class: 'fn-magitrickle-actions' });
		this.renderBridge(status);
		const toolbar = E('div', { class: 'fn-card fn-magitrickle-toolbar' }, [
			E('div', {}, [ E('h2', {}, _('MagiTrickle and Mihomo')), this.bridgeState ]),
			this.bridgeActions
		]);
		if (window.location.protocol === 'https:') {
			return E('div', { class: 'fn-magitrickle-page' }, [ toolbar,
				E('div', { class: 'fn-card fn-magitrickle-https' }, [
					E('h2', {}, _('MagiTrickle is served over HTTP')),
					E('p', {}, _('The embedded interface cannot be loaded from an HTTPS LuCI session because the browser blocks mixed content.')),
					E('a', { class: 'fn-settings-btn fn-settings-btn-primary', href: url, target: '_blank', rel: 'noopener' }, _('Open MagiTrickle'))
				])
			]);
		}
		this.frame = E('iframe', { src: url, class: 'fn-magitrickle-frame', title: _('MagiTrickle'), loading: 'eager' });
		return E('div', { class: 'fn-magitrickle-page' }, [ toolbar, this.frame ]);
	}
});
