'use strict';
'require view';
'require ui';
'require freenetic-rpc as rpc';
'require freenetic-view-guard as guard';

const callReboot = rpc.call;
const ICON_REBOOT = 'M20 7v5h-5M4 17v-5h5M5.6 9a7 7 0 0 1 11.5-2L20 12M4 12l2.9 5a7 7 0 0 0 11.5-2';

function svgIcon(path) {
	const span = E('span', { class: 'fn-icon fn-reboot-icon' });
	span.innerHTML = '<svg viewBox="0 0 24 24" width="34" height="34"><path d="' + path +
		'" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
	return span;
}

return view.extend({
	__init__() {
		if (window.__freeneticSpaConstructingView)
			return;

		return guard.isForeignTheme().then(foreign => {
			if (foreign)
				return L.require('view.system.reboot');
			return this.super('__init__', []);
		});
	},

	render() {
		return E('div', { class: 'fn-dash fn-reboot-page' }, [
			E('section', { class: 'fn-card fn-reboot-card' }, [
				E('div', { class: 'fn-card-head' }, [
					svgIcon(ICON_REBOOT),
					E('h3', {}, _('Restart router'))
				]),
				E('div', { class: 'fn-card-body fn-reboot-body' }, [
					E('div', { class: 'fn-reboot-copy' }, [
						E('p', { class: 'fn-reboot-lead' }, _('Restart the router to reload the operating system and its services.')),
						E('p', {}, _('Internet access and the web interface will be temporarily unavailable while the router restarts. Your saved settings will remain unchanged.')),
						E('div', { class: 'fn-reboot-note' }, [
							E('span', { class: 'fn-reboot-note-mark', 'aria-hidden': 'true' }, 'i'),
							E('span', {}, _('Make sure configuration changes are saved before restarting.'))
						])
					]),
					E('button', {
						type: 'button', class: 'fn-settings-btn fn-settings-btn-primary fn-reboot-action',
						click: ui.createHandlerFn(this, 'confirmReboot')
					}, _('Restart router'))
				])
			])
		]);
	},

	confirmReboot() {
		ui.showModal(_('Restart the router?'), [
			E('p', {}, _('All active connections will be interrupted briefly while the router restarts.')),
			E('div', { class: 'button-row' }, [
				E('button', { class: 'btn', click: ui.hideModal }, _('Cancel')),
				E('button', {
					class: 'btn cbi-button-positive',
					click: ui.createHandlerFn(this, 'reboot')
				}, _('Restart router'))
			])
		]);
	},

	reboot() {
		ui.showModal(_('Restarting router…'), [
			E('p', { class: 'spinning' }, _('The router is restarting. Wait a moment, then reconnect to the web interface.'))
		]);

		return callReboot('system', 'reboot').then(() => {
			window.setTimeout(() => ui.awaitReconnect(), 1200);
		}).catch(error => {
			const message = error && (error.message || String(error));
			if (/network|connection|timeout|fetch/i.test(message || '')) {
				window.setTimeout(() => ui.awaitReconnect(), 1200);
				return;
			}

			ui.hideModal();
			ui.addNotification(null, E('p', {}, _('Could not restart the router: %s').format(message || _('Unknown error'))));
		});
	}
});
