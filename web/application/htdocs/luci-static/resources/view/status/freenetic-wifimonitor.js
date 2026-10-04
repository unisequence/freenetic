'use strict';
'require view';
'require poll';
'require ui';
'require uci';
'require freenetic-rpc as rpc';
'require freenetic-ui as uiHelper';

/* Same raw-fetch ubus approach as the rest of this theme's custom views —
   see freenetic-dashboard.js for why (headless-tab requestAnimationFrame
   hang). Reuses the exact channel-survey tool already built for the
   Dashboard's "Wi-Fi Monitor" card, promoted to a dedicated full-width page
   with a per-band summary row — replaces stock LuCI's Channel Analysis
   (admin/status/channel_analysis) in the sidebar. */
const ubusCall = rpc.call;

const dom_empty = uiHelper.empty;
const notify = uiHelper.notify;
const applyChanges = uiHelper.applyChanges;

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
		return {
			name: r['.name'], band: r.band, channel: r.channel, htmode: r.htmode,
			disabled: r.disabled === '1', device: dev || null
		};
	}));
}

function mhzToChannel(mhz, band) {
	if (band !== '5g' && Number(mhz) === 2484)
		return 14;
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

const SVG_NS = 'http://www.w3.org/2000/svg';

function svgNode(name, attrs, text) {
	const node = document.createElementNS(SVG_NS, name);
	Object.keys(attrs || {}).forEach(key => node.setAttribute(key, attrs[key]));
	if (text != null)
		node.textContent = text;
	return node;
}

function channelWidth(entry) {
	const vht = entry && entry.vht_operation;
	const ht = entry && entry.ht_operation;
	const vhtWidth = Number(vht && vht.channel_width);
	if ([ 20, 40, 80, 160 ].indexOf(vhtWidth) !== -1)
		return vhtWidth;
	if (ht && ht.secondary_channel_offset && ht.secondary_channel_offset !== 'no secondary')
		return 40;
	return 20;
}

function channelFrequency(channel, band) {
	if (band !== '5g' && Number(channel) === 14)
		return 2484;
	return band === '5g' ? 5000 + Number(channel) * 5 : 2407 + Number(channel) * 5;
}

function activeChannelWidth(info) {
	const match = String(info && info.htmode || '').match(/(160|80|40|20)/);
	return match ? Number(match[1]) : 20;
}

function configuredChannelWidth(radio) {
	const match = String(radio && radio.htmode || '').match(/(160|80|40|20)/);
	return match ? Number(match[1]) : 20;
}

function scoreChannel(candidate, networks) {
	return networks.reduce((score, network) => {
		const halfSpan = (Number(candidate.width) || 20) / 2 + channelWidth(network) / 2;
		const overlap = Math.max(0, halfSpan - Math.abs(candidate.mhz - Number(network.mhz))) / halfSpan;
		const strength = Math.max(0.05, Math.min(1, (Number(network.signal) + 100) / 55));
		return score + overlap * strength * strength;
	}, 0);
}

function recommendChannel(radio, frequencies, networks) {
	let candidates = (frequencies || []).filter(f => !f.restricted && Number(f.channel) > 0);
	if (radio.band !== '5g') {
		const preferred = candidates.filter(f => [ 1, 6, 11 ].indexOf(Number(f.channel)) !== -1);
		if (preferred.length)
			candidates = preferred;
	}
	if (!candidates.length)
		return null;

	const width = configuredChannelWidth(radio);
	return candidates.map(candidate => ({
		channel: Number(candidate.channel),
		mhz: Number(candidate.mhz),
		width: width,
		score: scoreChannel({ mhz: Number(candidate.mhz), width: width }, networks)
	})).sort((a, b) => a.score - b.score || a.channel - b.channel)[0];
}

function signalQuality(signal) {
	if (signal >= -60)
		return _('Strong');
	if (signal >= -75)
		return _('Medium');
	return _('Weak');
}

return view.extend({
	load() {
		const wireless = getWirelessConfig();
		return Promise.all([ wireless, wireless.then(getWifiRadios), getWirelessStatus() ]);
	},

	render(data) {
		const wireless = data[0];
		const radios = data[1];
		const wstatus = data[2];

		this.wireless = wireless;
		this.wstatus = wstatus;
		this.radios = radios;
		this.channelChangeInProgress = false;

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
		this.overviewPane = E('div', { class: 'fn-wifi-overview' }, [ summary, chart ]);
		this.bandLoadingText = E('div', { class: 'fn-wifi-band-loading-text' });
		this.bandLoading = E('div', {
			class: 'fn-wifi-band-loading',
			hidden: true,
			'aria-live': 'polite'
		}, [
			E('div', { class: 'fn-wifi-band-loader', 'aria-hidden': 'true' }, [
				E('span'), E('span'), E('span'), E('span')
			]),
			this.bandLoadingText
		]);
		this.airspaceChart = E('div', { class: 'fn-airspace-chart' });
		this.airspaceSummary = E('div', { class: 'fn-airspace-summary' });
		this.airspaceList = E('div', { class: 'fn-airspace-list' });
		this.airspaceStatus = E('div', { class: 'fn-airspace-status' });
		this.airspaceRefresh = E('button', {
			type: 'button',
			class: 'fn-settings-btn fn-airspace-refresh',
			click: () => this.scanAirspace(true)
		}, _('Refresh'));
		this.airspacePane = E('div', { class: 'fn-airspace', hidden: true }, [
			E('div', { class: 'fn-airspace-toolbar' }, [
				this.airspaceStatus,
				this.airspaceRefresh
			]),
			this.airspaceSummary,
			this.airspaceChart,
			E('div', { class: 'fn-airspace-legend' }, [
				E('span', {}, [ E('i', { class: 'fn-air-legend-own' }), _('Our router') ]),
				E('span', {}, [ E('i', { class: 'fn-air-legend-neighbor' }), _('Nearby networks') ]),
				E('span', {}, [ E('i', { class: 'fn-air-legend-recommended' }), _('Recommended channel') ])
			]),
			this.airspaceList
		]);

		const modeTabs = E('div', { class: 'fn-wifi-monitor-modes', role: 'tablist' });
		[ [ 'overview', _('Overview') ], [ 'airspace', _('Air map') ] ].forEach((item, i) => {
			const button = E('button', {
				type: 'button',
				class: 'fn-wifi-mode-tab' + (i === 0 ? ' fn-active' : ''),
				role: 'tab',
				'aria-selected': i === 0 ? 'true' : 'false',
				click: () => this.selectView(item[0])
			}, item[1]);
			button.dataset.view = item[0];
			modeTabs.appendChild(button);
		});
		this.modeTabs = modeTabs;
		this.activeView = 'overview';

		const tabs = E('div', { class: 'fn-survey-tabs', role: 'tablist' });
		this.bandTabs = tabs;
		radios.forEach((radio, i) => {
			const label = radio.band === '5g' ? '5 GHz' : '2.4 GHz';
			const btn = E('button', {
				type: 'button',
				class: 'fn-survey-tab' + (i === 0 ? ' fn-active' : ''),
				role: 'tab',
				'aria-selected': i === 0 ? 'true' : 'false',
				click: () => {
					if (this.activeRadio === radio || this.bandLoadPending)
						return;
					tabs.querySelectorAll('.fn-survey-tab').forEach(b => b.classList.remove('fn-active'));
					tabs.querySelectorAll('.fn-survey-tab').forEach(b => b.setAttribute('aria-selected', 'false'));
					btn.classList.add('fn-active');
					btn.setAttribute('aria-selected', 'true');
					this.switchRadio(radio);
				}
			}, label);
			tabs.appendChild(btn);
		});

		this.activeRadio = radios[0];
		this.fillSummary(this.activeRadio);

		const container = E('div', { class: 'fn-dash' }, [
			E('div', { class: 'fn-card', style: 'grid-column: 1 / -1' }, [
				E('div', { class: 'fn-card-head fn-wifi-monitor-head' }, [
					svgIcon('M3 3v18h18M7 16v-4M11 16V8M15 16v-7M19 16v-2', 20),
					E('h3', {}, _('Wi-Fi Monitor')),
					modeTabs
				]),
				E('div', { class: 'fn-card-body fn-wifi-monitor-body' }, [
					tabs,
					this.bandLoading,
					this.overviewPane,
					this.airspacePane
				])
			])
		]);

		this.pollSurvey();
		poll.add(() => this.activeView === 'overview' && !this.bandLoadPending ? this.pollSurvey() : Promise.resolve(), 5);

		return container;
	},

	selectView(viewName) {
		this.activeView = viewName;
		this.overviewPane.hidden = viewName !== 'overview';
		this.airspacePane.hidden = viewName !== 'airspace';
		this.modeTabs.querySelectorAll('.fn-wifi-mode-tab').forEach(button => {
			const active = button.dataset.view === viewName;
			button.classList.toggle('fn-active', active);
			button.setAttribute('aria-selected', active ? 'true' : 'false');
		});
		this.refreshActiveView();
	},

	refreshActiveView() {
		return this.activeView === 'airspace' ? this.scanAirspace(false) : this.pollSurvey();
	},

	switchRadio(radio) {
		const label = radio.band === '5g' ? '5 GHz' : '2.4 GHz';
		this.activeRadio = radio;
		this.bandLoadPending = true;
		this.bandLoadingText.textContent = _('Loading %s data…').format(label);
		this.bandLoading.hidden = false;
		this.overviewPane.hidden = true;
		this.airspacePane.hidden = true;
		this.bandLoading.parentNode.setAttribute('aria-busy', 'true');
		this.bandTabs.querySelectorAll('.fn-survey-tab').forEach(button => { button.disabled = true; });
		this.modeTabs.querySelectorAll('.fn-wifi-mode-tab').forEach(button => { button.disabled = true; });

		const update = this.activeView === 'airspace'
			? this.scanAirspace(true)
			: Promise.all([ this.fillSummary(radio), this.pollSurvey() ]);
		const animationFloor = new Promise(resolve => window.setTimeout(resolve, 420));

		return Promise.all([ update, animationFloor ]).finally(L.bind(function() {
			this.bandLoadPending = false;
			this.bandLoading.hidden = true;
			this.overviewPane.hidden = this.activeView !== 'overview';
			this.airspacePane.hidden = this.activeView !== 'airspace';
			this.bandLoading.parentNode.removeAttribute('aria-busy');
			this.bandTabs.querySelectorAll('.fn-survey-tab').forEach(button => { button.disabled = false; });
			this.modeTabs.querySelectorAll('.fn-wifi-mode-tab').forEach(button => { button.disabled = false; });
		}, this));
	},

	fillSummary(radio) {
		const grid = this.summaryGrid;
		dom_empty(grid);
		if (!grid)
			return Promise.resolve();

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
			return Promise.resolve();
		}

		return getIwinfoInfo(radio.device).then(L.bind(function(info) {
			if (this.activeRadio !== radio || !grid.isConnected)
				return;
			if (info && info.channel) {
				grid.children[1].querySelector('.fn-info-value').textContent = String(info.channel);
			} else if (!radio.disabled) {
				grid.children[0].querySelector('.fn-info-value').textContent = _('Not broadcasting');
			}
			if (info && info.txpower != null)
				row(_('TX power'), info.txpower + ' dBm');
			if (info && info.bitrate)
				row(_('Bitrate'), (info.bitrate / 1000).toFixed(0) + ' Mbit/s');
		}, this)).catch(() => {});
	},

	scanAirspace(force) {
		const radio = this.activeRadio;
		const chart = this.airspaceChart;
		this.airspaceCache = this.airspaceCache || {};

		if (!radio || !radio.device) {
			dom_empty(chart);
			chart.appendChild(E('div', { class: 'fn-info-empty' },
				radio && radio.disabled ? _('This radio is disabled.') : _('No data yet.')));
			this.airspaceStatus.textContent = '';
			return Promise.resolve();
		}

		if (!force && this.airspaceCache[radio.name]) {
			this.renderAirspace(radio, this.airspaceCache[radio.name]);
			return Promise.resolve();
		}

		const request = (this.airspaceRequest || 0) + 1;
		this.airspaceRequest = request;
		this.airspaceRefresh.disabled = true;
		this.airspaceStatus.textContent = _('Scanning nearby networks…');

		return Promise.all([
			ubusCall('iwinfo', 'scan', { device: radio.device }),
			getIwinfoInfo(radio.device),
			ubusCall('iwinfo', 'freqlist', { device: radio.device }).catch(() => ({ results: [] }))
		]).then(L.bind(function(results) {
			if (this.airspaceRequest !== request)
				return;

			const data = {
				networks: (results[0].results || []).filter(network => Number(network.mhz) > 0),
				info: results[1] || {},
				frequencies: results[2].results || []
			};
			this.airspaceCache[radio.name] = data;
			if (this.activeRadio === radio && this.activeView === 'airspace')
				this.renderAirspace(radio, data);
		}, this)).catch(L.bind(function() {
			if (this.airspaceRequest !== request || this.activeRadio !== radio)
				return;
			dom_empty(chart);
			chart.appendChild(E('div', { class: 'fn-info-empty' }, _('Failed to scan nearby networks.')));
			this.airspaceStatus.textContent = _('Scan failed');
		}, this)).finally(L.bind(function() {
			if (this.airspaceRequest === request)
				this.airspaceRefresh.disabled = false;
		}, this));
	},

	renderAirspace(radio, data) {
		const networks = data.networks.slice().sort((a, b) => Number(b.signal) - Number(a.signal));
		const recommendation = recommendChannel(radio, data.frequencies, networks);
		this.airspaceStatus.textContent = _('Updated just now');
		this.renderAirspaceSummary(radio, data, recommendation);
		this.renderAirspaceChart(radio, data, recommendation);
		this.renderAirspaceList(networks);
	},

	renderAirspaceSummary(radio, data, recommendation) {
		const currentChannel = Number(data.info.channel) || 0;
		const currentFrequency = Number(data.info.frequency) || 0;
		const broadcasting = currentChannel > 0 && currentFrequency > 0;
		const width = broadcasting ? activeChannelWidth(data.info) : configuredChannelWidth(radio);
		const currentScore = broadcasting ? scoreChannel({ mhz: currentFrequency, width: width }, data.networks) : 0;
		let recommendationNote = _('Based on signal strength and channel overlap.');
		if (!broadcasting)
			recommendationNote = _('The radio is not broadcasting. The recommendation is based on the latest scan.');
		else if (recommendation && recommendation.channel === currentChannel)
			recommendationNote = _('The current channel already looks optimal.');
		else if (recommendation && currentScore > 0) {
			const improvement = Math.max(0, Math.min(99,
				Math.round((currentScore - recommendation.score) / currentScore * 100)));
			if (improvement > 0)
				recommendationNote = _('%d%% less estimated interference.').format(improvement);
		}

		const metric = (label, value, note, extraClass, action) => E('div', {
			class: 'fn-airspace-metric' + (extraClass ? ' ' + extraClass : '')
		}, [
			E('div', { class: 'fn-airspace-metric-label' }, label),
			E('div', { class: 'fn-airspace-metric-value' }, value),
			E('div', { class: 'fn-airspace-metric-note' }, note),
			action || E([])
		]);

		dom_empty(this.airspaceSummary);
		const applyButton = E('button', {
			type: 'button',
			class: 'fn-settings-btn fn-settings-btn-primary fn-airspace-apply',
			disabled: !recommendation,
			title: recommendation ? null : _('No available channel recommendation.')
		}, _('Apply'));
		applyButton.addEventListener('click', () =>
			this.confirmRecommendedChannel(radio, recommendation, applyButton));

		this.airspaceSummary.appendChild(metric(
			_('Recommended channel'),
			recommendation ? String(recommendation.channel) : '–',
			recommendationNote,
			'fn-airspace-metric-primary',
			applyButton
		));
		this.airspaceSummary.appendChild(metric(
			_('Current channel'),
			broadcasting ? String(currentChannel) : _('Not broadcasting'),
			broadcasting
				? _('%d MHz channel width').format(width)
				: _('Configured: %s, %d MHz').format(radio.channel === 'auto' ? _('Auto') : (radio.channel || '–'), width),
			broadcasting ? '' : 'fn-airspace-metric-warning'
		));
		this.airspaceSummary.appendChild(metric(
			_('Networks found'),
			String(data.networks.length),
			_('Visible during the latest scan')
		));
	},

	confirmRecommendedChannel(radio, recommendation, button) {
		if (!radio || !recommendation || this.channelChangeInProgress)
			return;

		ui.showModal(_('Apply recommended channel?'), [
			E('p', {}, _('Switch this radio to channel %d? Wi-Fi clients may briefly disconnect while the radio restarts.').format(recommendation.channel)),
			E('div', { class: 'button-row' }, [
				E('button', { class: 'btn', click: ui.hideModal }, _('Cancel')),
				E('button', {
					class: 'btn cbi-button-positive',
					click: () => {
						ui.hideModal();
						this.applyRecommendedChannel(radio, recommendation, button);
					}
				}, _('Apply'))
			])
		]);
	},

	applyRecommendedChannel(radio, recommendation, button) {
		if (!radio || !recommendation || this.channelChangeInProgress)
			return Promise.resolve();

		const channel = String(recommendation.channel);
		this.channelChangeInProgress = true;
		button.disabled = true;
		ui.showModal(_('Applying Wi-Fi channel…'), [
			E('p', { class: 'spinning' }, _('Saving the selected channel and restarting the radio.'))
		]);

		return uci.load('wireless').then(() => {
			const section = uci.sections('wireless', 'wifi-device')
				.find(item => item['.name'] === radio.name);
			if (!section)
				throw new Error(_('The selected Wi-Fi radio is no longer available.'));
			if (section.channel === channel)
				return false;

			uci.set('wireless', radio.name, 'channel', channel);
			return uci.save().then(() => applyChanges(60)).then(() => true);
		}).then(changed => {
			ui.hideModal();
			if (!changed) {
				notify(_('This radio is already configured for channel %d.').format(channel), 'info');
				return;
			}

			radio.channel = channel;
			const cached = this.airspaceCache && this.airspaceCache[radio.name];
			if (cached) {
				cached.info = Object.assign({}, cached.info, {
					channel: Number(channel),
					frequency: recommendation.mhz
				});
				this.renderAirspace(radio, cached);
			}
			notify(_('Channel %d applied. Wi-Fi clients may need a moment to reconnect.').format(channel), 'info');
		}).catch(error => {
			ui.hideModal();
			uci.unload('wireless');
			notify(_('Could not apply the recommended channel: %s').format(error.message || error), 'danger');
		}).finally(() => {
			this.channelChangeInProgress = false;
			button.disabled = !recommendation;
		});
	},

	renderAirspaceChart(radio, data, recommendation) {
		const chart = this.airspaceChart;
		dom_empty(chart);

		let frequencies = data.frequencies.filter(item => Number(item.mhz) > 0);
		if (!frequencies.length) {
			frequencies = data.networks.map(item => ({ channel: item.channel, mhz: item.mhz }));
			if (data.info.frequency)
				frequencies.push({ channel: data.info.channel, mhz: data.info.frequency });
		}
		if (!frequencies.length) {
			chart.appendChild(E('div', { class: 'fn-info-empty' }, _('No frequency data available.')));
			return;
		}

		const width = 1000;
		const height = 310;
		const margin = { left: 48, right: 22, top: 26, bottom: 48 };
		const baseline = height - margin.bottom;
		const minMhz = Math.min.apply(null, frequencies.map(item => Number(item.mhz))) - 12;
		const maxMhz = Math.max.apply(null, frequencies.map(item => Number(item.mhz))) + 12;
		const x = mhz => margin.left + (Number(mhz) - minMhz) / (maxMhz - minMhz) * (width - margin.left - margin.right);
		const svg = svgNode('svg', {
			class: 'fn-airspace-svg' + (radio.band === '5g' ? ' fn-airspace-svg-5g' : ''),
			viewBox: '0 0 ' + width + ' ' + height,
			role: 'img',
			'aria-label': _('Nearby Wi-Fi networks by channel and signal strength')
		});

		svg.appendChild(svgNode('rect', {
			x: margin.left, y: margin.top, width: width - margin.left - margin.right,
			height: baseline - margin.top, class: 'fn-airspace-plot-bg'
		}));

		[ -90, -70, -50, -30 ].forEach(signal => {
			const y = baseline - ((signal + 100) / 70) * (baseline - margin.top);
			svg.appendChild(svgNode('line', { x1: margin.left, y1: y, x2: width - margin.right, y2: y, class: 'fn-air-grid-line' }));
			svg.appendChild(svgNode('text', { x: margin.left - 7, y: y + 4, class: 'fn-air-axis-label', 'text-anchor': 'end' }, signal));
		});

		frequencies.forEach(frequency => {
			const gridX = x(frequency.mhz);
			svg.appendChild(svgNode('line', {
				x1: gridX, y1: margin.top, x2: gridX, y2: baseline,
				class: 'fn-air-channel-line' + (frequency.restricted ? ' fn-air-channel-restricted' : '')
			}));
			svg.appendChild(svgNode('text', {
				x: gridX,
				y: baseline + 20,
				class: 'fn-air-axis-label' + (frequency.restricted ? ' fn-air-axis-restricted' : ''),
				'text-anchor': 'middle'
			}, frequency.channel));
		});

		if (recommendation) {
			const recLeft = x(recommendation.mhz - recommendation.width / 2);
			const recRight = x(recommendation.mhz + recommendation.width / 2);
			svg.appendChild(svgNode('rect', {
				x: recLeft, y: margin.top, width: Math.max(2, recRight - recLeft),
				height: baseline - margin.top, class: 'fn-air-recommended-band'
			}));
		}

		const ownChannel = Number(data.info.channel) || 0;
		const ownMhz = Number(data.info.frequency) || (ownChannel ? channelFrequency(ownChannel, radio.band) : 0);
		const ownWidth = activeChannelWidth(data.info);
		if (ownMhz) {
			const ownLeft = x(ownMhz - ownWidth / 2);
			const ownRight = x(ownMhz + ownWidth / 2);
			svg.appendChild(svgNode('rect', {
				x: ownLeft, y: margin.top, width: Math.max(3, ownRight - ownLeft),
				height: baseline - margin.top, class: 'fn-air-own-band'
			}));
			svg.appendChild(svgNode('text', {
				x: (ownLeft + ownRight) / 2, y: margin.top + 17,
				class: 'fn-air-own-label', 'text-anchor': 'middle'
			}, (data.info.ssid || _('Our router')) + ' · ' + ownWidth + ' MHz'));
		}

		data.networks.forEach((network, index) => {
			const networkWidth = channelWidth(network);
			const left = Math.max(margin.left, x(Number(network.mhz) - networkWidth / 2));
			const right = Math.min(width - margin.right, x(Number(network.mhz) + networkWidth / 2));
			const strength = Math.max(0, Math.min(1, (Number(network.signal) + 100) / 70));
			const top = baseline - Math.max(18, strength * (baseline - margin.top - 18));
			const span = right - left;
			const path = svgNode('path', {
				d: 'M ' + left + ' ' + baseline + ' C ' + (left + span * .2) + ' ' + top + ', ' + (right - span * .2) + ' ' + top + ', ' + right + ' ' + baseline + ' Z',
				class: 'fn-air-network fn-air-network-' + (index % 5)
			});
			path.appendChild(svgNode('title', {}, (network.ssid || _('Hidden network')) +
				' · ' + _('Channel %d').format(network.channel) +
				' · ' + networkWidth + ' MHz · ' + network.signal + ' dBm'));
			svg.appendChild(path);
		});

		const placedLabels = [];
		data.networks.slice().sort((a, b) => Number(b.signal) - Number(a.signal)).slice(0, 8).forEach(network => {
			const strength = Math.max(0, Math.min(1, (Number(network.signal) + 100) / 70));
			const top = baseline - Math.max(18, strength * (baseline - margin.top - 18));
			let name = network.ssid || _('Hidden network');
			if (name.length > 15)
				name = name.slice(0, 14) + '…';
			const labelWidth = Math.max(36, Math.min(118, name.length * 6.5));
			const labelX = Math.max(margin.left + labelWidth / 2,
				Math.min(width - margin.right - labelWidth / 2, x(network.mhz)));
			const baseY = Math.max(margin.top + 35, top - 7);
			const offsets = [ 0, -16, 16, -32, 32, -48, 48, -64 ];
			let labelY = baseY;
			for (const offset of offsets) {
				const candidateY = Math.max(margin.top + 35, Math.min(baseline - 8, baseY + offset));
				const collides = placedLabels.some(label =>
					Math.abs(label.x - labelX) < (label.width + labelWidth) / 2 + 7 &&
					Math.abs(label.y - candidateY) < 15);
				if (!collides) {
					labelY = candidateY;
					break;
				}
			}
			placedLabels.push({ x: labelX, y: labelY, width: labelWidth });
			svg.appendChild(svgNode('text', {
				x: labelX, y: labelY,
				class: 'fn-air-network-label', 'text-anchor': 'middle'
			}, name));
		});

		svg.appendChild(svgNode('text', { x: 12, y: margin.top + 4, class: 'fn-air-axis-title' }, 'dBm'));
		svg.appendChild(svgNode('text', { x: width / 2, y: height - 7, class: 'fn-air-axis-title', 'text-anchor': 'middle' }, _('Channel')));
		chart.appendChild(svg);
	},

	renderAirspaceList(networks) {
		dom_empty(this.airspaceList);
		this.airspaceList.appendChild(E('h4', {}, _('Strongest nearby networks')));
		if (!networks.length) {
			this.airspaceList.appendChild(E('div', { class: 'fn-info-empty' }, _('No nearby networks found.')));
			return;
		}

		this.airspaceList.appendChild(E('div', { class: 'fn-airspace-network-row fn-airspace-network-head' }, [
			E('span', {}, _('Network')),
			E('span', {}, _('Channel')),
			E('span', {}, _('Width')),
			E('span', {}, _('Signal'))
		]));
		networks.slice(0, 12).forEach(network => {
			this.airspaceList.appendChild(E('div', { class: 'fn-airspace-network-row' }, [
				E('span', { class: 'fn-airspace-network-name', title: network.bssid || '' }, network.ssid || _('Hidden network')),
				E('span', {}, String(network.channel || '–')),
				E('span', {}, channelWidth(network) + ' MHz'),
				E('span', {}, [
					E('i', { class: 'fn-air-signal-dot ' + (network.signal >= -60 ? 'fn-air-signal-strong' : network.signal >= -75 ? 'fn-air-signal-medium' : '') }),
					String(network.signal) + ' dBm · ' + signalQuality(Number(network.signal))
				])
			]));
		});
	},

	pollSurvey() {
		const radio = this.activeRadio;
		const chart = this.surveyChart;
		chart.classList.toggle('fn-survey-chart-5g', !!radio && radio.band === '5g');

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
