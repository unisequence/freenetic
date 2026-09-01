'use strict';
'require view';
'require poll';

/* Same raw-fetch ubus approach as the rest of this theme's custom views —
   see freenetic-dashboard.js for why (headless-tab requestAnimationFrame
   hang). Reuses the exact channel-survey tool already built for the
   Dashboard's "Wi-Fi Monitor" card, promoted to a dedicated full-width page
   with a per-band summary row — replaces stock LuCI's Channel Analysis
   (admin/status/channel_analysis) in the sidebar. */
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

function svgIcon(d, size) {
	size = size || 18;
	const span = E('span', { class: 'fn-icon' });
	span.innerHTML = '<svg viewBox="0 0 24 24" width="' + size + '" height="' + size + '">' +
		'<path d="' + d + '" fill="none" stroke="currentColor" stroke-width="2" ' +
		'stroke-linecap="round" stroke-linejoin="round"/></svg>';
	return span;
}

function getWirelessConfig() {
	return ubusCall('uci', 'get', { config: 'wireless' }).then(r => r.values || {}).catch(() => ({}));
}

function getWifiRadios(wireless) {
	const radios = Object.keys(wireless)
		.map(k => wireless[k])
		.filter(s => s['.type'] === 'wifi-device');

	return Promise.all([
		ubusCall('iwinfo', 'devices').then(r => r.devices || []).catch(() => []),
		Promise.all(radios.map(r =>
			ubusCall('iwinfo', 'phyname', { section: r['.name'] }).then(p => p.phyname).catch(() => null)))
	]).then(([activeDevices, phynames]) => radios.map((r, i) => {
		const phy = phynames[i];
		const dev = phy ? activeDevices.find(d => d.indexOf(phy + '-') === 0) : null;
		return { name: r['.name'], band: r.band, channel: r.channel, disabled: r.disabled === '1', device: dev || null };
	}));
}

function mhzToChannel(mhz, band) {
	return band === '5g' ? Math.round((mhz - 5000) / 5) : Math.round((mhz - 2407) / 5);
}

function getWirelessStatus() {
	return ubusCall('network.wireless', 'status').catch(() => ({}));
}

function getIwinfoInfo(device) {
	return ubusCall('iwinfo', 'info', { device: device }).catch(() => null);
}

function findIfaceEntry(wstatus, sectionName) {
	for (const r in wstatus)
		for (const i of (wstatus[r].interfaces || []))
			if (i.section === sectionName)
				return i;
	return null;
}

function stationCountFor(wstatus, sectionName) {
	const entry = findIfaceEntry(wstatus, sectionName);
	return entry ? (entry.stations || []).length : 0;
}

return view.extend({
	load() {
		return getWirelessConfig().then(wireless =>
			Promise.all([ wireless, getWifiRadios(wireless), getWirelessStatus() ]));
	},

	render(data) {
		const wireless = data[0];
		const radios = data[1];
		const wstatus = data[2];

		this.wireless = wireless;
		this.wstatus = wstatus;
		this.radios = radios;

		if (!radios.length) {
			return E('div', { class: 'fn-dash' }, [
				E('div', { class: 'fn-card', style: 'grid-column: 1 / -1' }, [
					E('div', { class: 'fn-card-body' }, [
						E('div', { class: 'fn-info-empty' }, _('No wireless radios found.'))
					])
				])
			]);
		}

		const summary = E('div', { class: 'fn-info-grid' });
		const chart = E('div', { class: 'fn-survey-chart' });
		this.summaryGrid = summary;
		this.surveyChart = chart;

		const tabs = E('div', { class: 'fn-survey-tabs' });
		radios.forEach((radio, i) => {
			const label = radio.band === '5g' ? '5 GHz' : '2.4 GHz';
			const btn = E('button', {
				type: 'button',
				class: 'fn-survey-tab' + (i === 0 ? ' fn-active' : ''),
				click: (ev) => {
					tabs.querySelectorAll('.fn-survey-tab').forEach(b => b.classList.remove('fn-active'));
					ev.target.classList.add('fn-active');
					this.activeRadio = radio;
					this.pollSurvey();
					this.fillSummary(radio);
				}
			}, label);
			tabs.appendChild(btn);
		});

		this.activeRadio = radios[0];
		this.fillSummary(this.activeRadio);

		const container = E('div', { class: 'fn-dash' }, [
			E('div', { class: 'fn-card', style: 'grid-column: 1 / -1' }, [
				E('div', { class: 'fn-card-head' }, [
					svgIcon('M3 3v18h18M7 16v-4M11 16V8M15 16v-7M19 16v-2', 20),
					E('h3', {}, _('Wi-Fi Monitor'))
				]),
				E('div', { class: 'fn-card-body' }, [ tabs, summary, chart ])
			])
		]);

		this.pollSurvey();
		poll.add(L.bind(this.pollSurvey, this), 5);

		return container;
	},

	fillSummary(radio) {
		const grid = this.summaryGrid;
		dom_empty(grid);
		if (!grid)
			return;

		const ifaceCount = Object.keys(this.wireless)
			.map(k => this.wireless[k])
			.filter(s => s['.type'] === 'wifi-iface' && s.device === radio.name);
		const clients = ifaceCount.reduce((sum, ifc) => sum + stationCountFor(this.wstatus, ifc['.name']), 0);

		const row = (label, value) => grid.appendChild(E('div', { class: 'fn-info-item' }, [
			E('div', { class: 'fn-info-label' }, label),
			E('div', { class: 'fn-info-value' }, value)
		]));

		row(_('Status'), radio.disabled ? _('Disabled') : _('Enabled'));
		row(_('Channel'), radio.channel || '–');
		row(_('Connected clients'), String(clients));

		if (!radio.device) {
			row(_('Live info'), _('Not available'));
			return;
		}

		getIwinfoInfo(radio.device).then(L.bind(function(info) {
			if (this.activeRadio !== radio || !grid.isConnected)
				return;
			if (info && info.channel)
				grid.children[1].querySelector('.fn-info-value').textContent = String(info.channel);
			if (info && info.txpower != null)
				row(_('TX power'), info.txpower + ' dBm');
			if (info && info.bitrate)
				row(_('Bitrate'), (info.bitrate / 1000).toFixed(0) + ' Mbit/s');
		}, this)).catch(() => {});
	},

	pollSurvey() {
		const radio = this.activeRadio;
		const chart = this.surveyChart;

		if (!radio || !radio.device) {
			dom_empty(chart);
			chart.appendChild(E('div', { class: 'fn-info-empty' },
				radio && radio.disabled ? _('This radio is disabled.') : _('No data yet.')));
			return Promise.resolve();
		}

		return ubusCall('iwinfo', 'survey', { device: radio.device }).then(L.bind(function(res) {
			if (this.activeRadio !== radio)
				return;

			dom_empty(chart);
			(res.results || []).forEach(entry => {
				const channel = mhzToChannel(entry.mhz, radio.band);
				if (channel < 1)
					return;
				const busy = entry.active_time > 0 ? (entry.busy_time / entry.active_time) * 100 : 0;
				const level = busy > 70 ? 'fn-survey-high' : busy > 30 ? 'fn-survey-mid' : 'fn-survey-low';

				chart.appendChild(E('div', { class: 'fn-survey-bar' }, [
					E('div', { class: 'fn-survey-bar-track' }, [
						E('div', { class: 'fn-survey-bar-fill ' + level, style: 'height:' + Math.max(2, busy) + '%' })
					]),
					E('div', { class: 'fn-survey-bar-label' }, String(channel))
				]));
			});
		}, this)).catch(() => {
			dom_empty(chart);
			chart.appendChild(E('div', { class: 'fn-info-empty' }, _('Failed to read channel survey.')));
		});
	},

	addFooter() { return E([]); }
});
