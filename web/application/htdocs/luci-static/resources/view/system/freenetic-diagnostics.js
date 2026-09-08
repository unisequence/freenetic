'use strict';
'require view';
'require fs';
'require freenetic-diagnostics as diagnostics';
'require freenetic-rpc as rpc';
'require freenetic-ui as uiHelper';

const ubusCall = rpc.call;
const setContent = uiHelper.content;
const notify = uiHelper.notify;

function infoRow(label, value) {
	return E('div', { class: 'fn-info-row' }, [
		E('div', { class: 'fn-info-label' }, label),
		E('div', { class: 'fn-info-value' }, value || '–')
	]);
}

function humanUplinkName(name) {
	const value = String(name || '').trim();
	const match = value.match(/^wan(\d+)$/i);

	if (/^wan$/i.test(value))
		return _('Internet connection');
	if (match)
		return _('Internet connection %s').format(match[1]);

	return value || _('Internet connection');
}

function humanProtocol(protocol) {
	const value = String(protocol || '').trim();
	return value && value !== '–' ? value.toUpperCase() : '–';
}

function humanInterface(device) {
	const value = String(device || '').trim();
	return value && value !== '–' ? value.toUpperCase() : '–';
}

function renderUplink(uplink) {
	return E('div', { class: 'fn-diag-uplink' }, [
		E('div', { class: 'fn-info-group-title' }, humanUplinkName(uplink.name)),
		infoRow(_('Connection status'), E('span', {
			class: 'fn-status-pill ' + (uplink.up ? 'fn-status-ok' : 'fn-status-off')
		}, uplink.up ? _('Connected') : _('Disconnected'))),
		infoRow(_('Connection type'), humanProtocol(uplink.protocol)),
		infoRow(_('Interface'), humanInterface(uplink.device)),
		infoRow(_('IP address'), uplink.addresses.join(', ')),
		infoRow(_('Gateway'), uplink.gateway),
		infoRow(_('DNS'), uplink.dns.join(', '))
	]);
}

return view.extend({
	load() {
		return ubusCall('network.interface', 'dump').catch(() => ({ interface: [] }));
	},

	render(interfaceDump) {
		this.uplinks = diagnostics.summarizeInterfaces(interfaceDump);
		const defaultTarget = (this.uplinks.find(item => item.up && item.gateway) || {}).gateway || '1.1.1.1';
		const networkBody = this.uplinks.length
			? this.uplinks.map(renderUplink)
			: [ E('div', { class: 'fn-info-empty' }, _('No WAN interface or default route was found.')) ];

		this.targetInput = E('input', {
			type: 'text',
			value: defaultTarget,
			placeholder: _('Host name or IP address'),
			autocapitalize: 'none',
			autocorrect: 'off',
			spellcheck: 'false'
		});
		this.targetInput.addEventListener('keydown', event => {
			if (event.key === 'Enter') {
				event.preventDefault();
				this.runDiagnostic('ping');
			}
		});

		this.pingButton = E('button', {
			type: 'button',
			class: 'fn-settings-btn fn-settings-btn-primary',
			click: () => this.runDiagnostic('ping')
		}, _('Ping'));
		this.traceButton = E('button', {
			type: 'button',
			class: 'fn-settings-btn',
			click: () => this.runDiagnostic('traceroute')
		}, _('Traceroute'));
		this.resultStatus = E('span', { class: 'fn-status-pill fn-status-off' }, _('Not started'));
		this.output = E('pre', {
			class: 'fn-diag-output',
			'aria-live': 'polite'
		}, _('Run a check to see its output here.'));

		return E('div', { class: 'fn-dash' }, [
			E('div', { class: 'fn-card', style: 'grid-column: 1 / -1' }, [
				E('div', { class: 'fn-card-head' }, [
					E('h3', {}, _('Internet diagnostics'))
				]),
				E('div', { class: 'fn-card-body fn-info-list' }, networkBody)
			]),
			E('div', { class: 'fn-card', style: 'grid-column: 1 / -1' }, [
				E('div', { class: 'fn-card-head' }, [
					E('h3', {}, _('Network check')),
					this.resultStatus
				]),
				E('div', { class: 'fn-card-body' }, [
					E('p', { class: 'fn-info-empty' }, _('Check whether a host is reachable or inspect the route taken by packets.')),
					E('div', { class: 'fn-diag-controls' }, [
						E('div', { class: 'fn-kn-field' }, [
							E('label', {}, _('Target')),
							this.targetInput
						]),
						E('div', { class: 'fn-diag-actions' }, [ this.pingButton, this.traceButton ])
					]),
					this.output
				])
			])
		]);
	},

	runDiagnostic(operation) {
		const target = diagnostics.normalizeTarget(this.targetInput.value);
		if (!target) {
			notify(_('Enter a valid host name or IP address.'), 'warning');
			return Promise.resolve();
		}

		this.targetInput.value = target;
		this.setRunning(true);
		setContent(this.output, _('Running…'));

		return fs.exec('/usr/libexec/freenetic-diagnostics-call', [ operation, target ])
			.then(result => {
				const text = [ result.stdout, result.stderr ].filter(Boolean).join('\n').trim();
				setContent(this.output, text || _('The command produced no output.'));
				this.setResult(result.code === 0, result.code === 0 ? _('Passed') : _('Failed'));
			})
			.catch(error => {
				setContent(this.output, error.message || String(error));
				this.setResult(false, _('Failed'));
			})
			.finally(() => this.setRunning(false));
	},

	setRunning(running) {
		this.targetInput.disabled = running;
		this.pingButton.disabled = running;
		this.traceButton.disabled = running;
		if (running)
			this.setResult(false, _('Running'));
	},

	setResult(ok, label) {
		this.resultStatus.className = 'fn-status-pill ' + (ok ? 'fn-status-ok' : 'fn-status-off');
		setContent(this.resultStatus, label);
	}
});
