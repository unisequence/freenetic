'use strict';
'require view';
'require ui';
'require uci';
'require freenetic-view-guard as guard';
'require freenetic-rpc as rpc';
'require freenetic-ui as uiHelper';

/*
 * Routing is deliberately implemented on top of the stock UCI models rather
 * than a Freenetic-specific daemon.  IPv4/IPv6 routes are netifd sections in
 * `network`; DNS routes are the standard dnsmasq `server` list in `dhcp`.
 * This keeps the page useful on a plain OpenWrt install and leaves the
 * resulting configuration editable from stock LuCI as well.
 */
const ubusCall = rpc.call;
const dom_empty = uiHelper.empty;
const dom_content = uiHelper.content;
const notify = uiHelper.notify;
const applyChanges = uiHelper.applyChanges;

function listValue(value) {
	if (value == null)
		return [];
	return Array.isArray(value) ? value.slice() : [ value ];
}

function sectionName(section) {
	return section && (section['.name'] || section.name);
}

function ipv4(value) {
	const parts = String(value || '').split('.');
	return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && +part >= 0 && +part <= 255);
}

function ipv4Netmask(value) {
	if (!ipv4(value))
		return false;
	const bits = String(value).split('.').map(part => (+part).toString(2).padStart(8, '0')).join('');
	return /^1*0*$/.test(bits);
}

function netmaskToPrefix(value) {
	if (!ipv4Netmask(value))
		return null;
	const bits = String(value).split('.').map(part => (+part).toString(2).padStart(8, '0')).join('');
	return bits.indexOf('0') === -1 ? 32 : bits.indexOf('0');
}

function prefixToNetmask(value) {
	value = +value;
	if (!Number.isInteger(value) || value < 0 || value > 32)
		return null;
	if (value === 0)
		return '0.0.0.0';
	const mask = (0xffffffff << (32 - value)) >>> 0;
	return [ mask >>> 24, (mask >>> 16) & 255, (mask >>> 8) & 255, mask & 255 ].join('.');
}

function ipv6(value) {
	value = String(value || '').trim();
	if (!value || value.indexOf(':') === -1 || /[^0-9a-f:]/i.test(value))
		return false;

	/* A compact validation is enough for a form guard; the kernel remains the
	 * final authority when netifd applies the configuration.  Reject malformed
	 * multiple-compression addresses while accepting normal `::` forms. */
	if ((value.match(/::/g) || []).length > 1)
		return false;
	const halves = value.split('::');
	const count = part => part ? part.split(':').filter(Boolean).length : 0;
	if (halves.length === 1)
		return count(halves[0]) === 8;
	return count(halves[0]) + count(halves[1]) < 8;
}

function metric(value) {
	return value === '' || (/^\d+$/.test(value) && +value <= 4294967295);
}

function prefix(value, max) {
	return /^\d+$/.test(value) && +value >= 0 && +value <= max;
}

function dnsDomain(value) {
	return /^(?:\*|\.?[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?)$/.test(value || '');
}

function dnsServer(value) {
	value = String(value || '').trim();
	if (!value)
		return false;

	let address = value;
	const hash = value.lastIndexOf('#');
	if (hash !== -1) {
		const port = value.slice(hash + 1);
		if (!/^\d+$/.test(port) || +port < 1 || +port > 65535)
			return false;
		address = value.slice(0, hash);
	}

	if (address[0] === '[' && address[address.length - 1] === ']')
		address = address.slice(1, -1);

	return ipv4(address) || ipv6(address);
}

function parseDnsServer(raw) {
	const match = String(raw || '').match(/^\/([^/]+)\/(.+)$/);
	if (!match || !dnsDomain(match[1]) || !dnsServer(match[2]))
		return null;
	return { raw: raw, domain: match[1], server: match[2] };
}

function encodeDnsServer(domain, server) {
	return '/' + domain + '/' + server;
}

function routeTarget(route, family) {
	const target = route.target || (family === 'ipv4' ? '0.0.0.0' : '::');
	if (route.netmask && target.indexOf('/') === -1) {
		const mask = family === 'ipv4' ? netmaskToPrefix(route.netmask) : route.netmask;
		if (mask != null)
			return target + '/' + mask;
	}
	return target;
}

function routeTargetParts(value) {
	const match = String(value || '').match(/^(.+?)(?:\/(\d+))?$/);
	return { address: match ? match[1] : value, prefix: match && match[2] != null ? match[2] : '' };
}

function routeTypeFor(route, family) {
	const target = routeTarget(route, family);
	const parts = routeTargetParts(target);
	const max = family === 'ipv6' ? 128 : 32;
	if (parts.prefix === '0')
		return 'default';
	if (parts.prefix === String(max))
		return 'host';
	return 'network';
}

function interfaceFriendlyLabel(name) {
	const labels = {
		wan: _('Internet'),
		wan6: _('Internet (IPv6)'),
		lan: _('Home network'),
		guest: _('Guest network'),
		'br-lan': _('Home network'),
		'br-guest': _('Guest network')
	};
	return labels[name] || name || '–';
}

function routeKey(route, family, interfaceName) {
	const target = routeTarget(route, family);
	return [ family, target, route.gateway || '', interfaceName || '', route.metric || '' ].join('|');
}

function importedRouteKey(route, interfaceName) {
	const target = route.family === 'ipv4'
		? route.target + '/' + netmaskToPrefix(route.netmask)
		: route.target;
	return [ route.family, target, route.gateway || '', interfaceName || '', route.metric || '' ].join('|');
}

function routeLineError(line, number, message) {
	return { line: number, text: line.trim(), message: message };
}

function normalizeImportedRoute(family, target, netmask, gateway, metricValue, line, number) {
	target = String(target || '').trim();
	netmask = String(netmask || '').trim();
	gateway = String(gateway || '').trim();
	metricValue = String(metricValue || '').trim();

	if (family === 'ipv4') {
		const parts = routeTargetParts(target);
		if (!ipv4(parts.address))
			return routeLineError(line, number, _('invalid IPv4 destination'));
		if (parts.prefix !== '')
			netmask = prefixToNetmask(parts.prefix);
		if (!ipv4Netmask(netmask))
			return routeLineError(line, number, _('invalid IPv4 netmask'));
		if (gateway && !ipv4(gateway))
			return routeLineError(line, number, _('invalid IPv4 gateway'));
	}
	else {
		const parts = routeTargetParts(target);
		if (!ipv6(parts.address))
			return routeLineError(line, number, _('invalid IPv6 destination'));
		if (parts.prefix !== '' && !prefix(parts.prefix, 128))
			return routeLineError(line, number, _('invalid IPv6 prefix'));
		if (gateway && !ipv6(gateway))
			return routeLineError(line, number, _('invalid IPv6 gateway'));
	}

	if (metricValue && !metric(metricValue))
		return routeLineError(line, number, _('invalid metric'));

	return {
		family: family,
		target: family === 'ipv4' ? routeTargetParts(target).address : target,
		netmask: family === 'ipv4' ? netmask : '',
		gateway: gateway,
		metric: metricValue,
		line: number,
		source: line.trim()
	};
}

function parseRouteLine(line, number) {
	const cleaned = String(line || '').replace(/\s*(?:#|;).*$/, '').trim();
	if (!cleaned)
		return null;

	const tokens = cleaned.split(/\s+/);
	const lower = tokens.map(token => token.toLowerCase());
	const isWindowsRoute = lower[0] === 'route' || lower[0] === 'route6';

	if (isWindowsRoute) {
		let index = 1;
		let family = lower[0] === 'route6' ? 'ipv6' : 'ipv4';
		if (lower[index] === '-6') {
			family = 'ipv6';
			index++;
		}
		if (lower[index] === '-4') {
			family = 'ipv4';
			index++;
		}
		if (lower[index] === '-p')
			index++;
		if (lower[index] !== 'add')
			return routeLineError(line, number, _('expected an ADD route record'));
		index++;

		const target = tokens[index++];
		let netmask = '';
		if (family === 'ipv4' && lower[index] === 'mask') {
			netmask = tokens[index + 1];
			index += 2;
		}
		else if (family === 'ipv4' && target && target.indexOf('/') === -1) {
			/* Windows normally includes MASK. A missing mask is treated as a host
			 * route instead of silently creating a broad network route. */
			netmask = '255.255.255.255';
		}

		const gateway = tokens[index] && !/^(metric|if)$/i.test(tokens[index]) ? tokens[index++] : '';
		let metricValue = '';
		for (; index < lower.length - 1; index++)
			if (lower[index] === 'metric') {
				metricValue = tokens[index + 1];
				break;
			}

		return normalizeImportedRoute(family, target, netmask, gateway, metricValue, line, number);
	}

	/* Also accept a compact text form: `destination netmask gateway` for IPv4
	 * and `destination/prefix gateway` for IPv6. This makes hand-written files
	 * useful without accepting arbitrary shell commands. */
	if (tokens.length >= 3 && ipv4(tokens[0]) && ipv4(tokens[1]))
		return normalizeImportedRoute('ipv4', tokens[0], tokens[1], tokens[2], '', line, number);

	return null;
}

function parseRouteFile(text) {
	const result = { routes: [], errors: [], ignored: 0 };
	String(text || '').split(/\r?\n/).forEach((line, index) => {
		const parsed = parseRouteLine(line, index + 1);
		if (!parsed) {
			if (line.trim() && !/^\s*(?:#|;)/.test(line))
				result.ignored++;
			return;
		}
		if (parsed.message)
			result.errors.push(parsed);
		else
			result.routes.push(parsed);
	});
	return result;
}

function routeInterfaceLabel(name, interfaces) {
	const found = interfaces.find(item => item.value === name);
	return found ? found.label : (name || '–');
}

return view.extend({
	__init__() {
		/* admin/network/routes is a stock LuCI path on many images.  Keep the
		 * original page available when Freenetic is not the active theme. */
		if (window.__freeneticSpaConstructingView)
			return;

		return guard.isForeignTheme().then(foreign => {
			if (foreign)
				return L.require('view.network.routes');
			return this.super('__init__', []);
		});
	},

	load() {
		return Promise.all([
			uci.load('network').catch(() => {}),
			uci.load('dhcp').catch(() => {}),
			ubusCall('network.interface', 'dump').catch(() => ({ interface: [] }))
		]);
	},

	render(data) {
		this.interfaceDump = data[2] || { interface: [] };
		this.interfaces = this.getInterfaces();
		this.activeFamily = 'ipv4';
		this.formPanel = E('div', { hidden: true });
		this.importPanel = E('div', { hidden: true });
		this.table = E('div', { class: 'fn-table' });
		this.activeTable = E('div', { class: 'fn-table' });
		this.tabButtons = {};
		this.editingSection = null;
		this.editingDnsIndex = null;
		this.routeModalOpen = false;
		this.importDialogOpen = false;
		this.importInterfaceValue = '';
		this.selectedRoutes = {};
		this.activeTitle = E('h3', {}, _('Active IPv4 routes'));
		this.activeDescription = E('p', { class: 'fn-info-empty' }, _('Routes currently installed in the kernel, including connected and default routes.'));
		this.userRoutesTitle = E('h3', {}, _('User routes'));

		const addButton = E('button', {
			type: 'button',
			class: 'fn-settings-btn fn-settings-btn-primary',
			style: 'width:auto; padding:7px 16px;',
			click: () => this.openForm(null, this.activeFamily)
		}, _('Add route'));
		this.addButton = addButton;
		const importInput = E('input', {
			type: 'file',
			accept: '.txt,.route,text/plain',
			class: 'fn-route-file-input',
			'aria-label': _('Route file')
		});
		importInput.addEventListener('change', event => {
			const file = event.target.files && event.target.files[0];
			if (file)
				this.readImportFile(file);
			event.target.value = '';
		});
		this.importInput = importInput;
		const importButton = E('button', {
			type: 'button',
			class: 'fn-settings-btn',
			style: 'width:auto; padding:7px 16px;',
			click: () => this.openImportDialog()
		}, _('Upload'));
		const saveButton = E('button', {
			type: 'button',
			class: 'fn-settings-btn',
			style: 'width:auto; padding:7px 16px;',
			click: () => this.saveSelectedRoutes(saveButton)
		}, _('Save'));
		const deleteButton = E('button', {
			type: 'button',
			class: 'fn-settings-btn fn-settings-btn-danger',
			style: 'width:auto; padding:7px 16px;',
			click: () => this.deleteSelectedRoutes(deleteButton)
		}, _('Delete'));
		saveButton.disabled = true;
		deleteButton.disabled = true;
		this.saveButton = saveButton;
		this.deleteButton = deleteButton;

		const tabs = E('div', { class: 'fn-tabs', role: 'tablist' }, [
			this.makeTab('ipv4', _('IPv4 routes')),
			this.makeTab('ipv6', _('IPv6 routes')),
			this.makeTab('dns', _('DNS routes'))
		]);

		this.fillTable();
		this.fillActiveTable();

		return E('div', { class: 'fn-dash' }, [
			E('div', { class: 'fn-card', style: 'grid-column: 1 / -1' }, [
				E('div', { class: 'fn-card-head' }, [ E('h3', {}, _('Routing')) ]),
				E('div', { class: 'fn-card-body' }, [
					E('p', { class: 'fn-info-empty fn-route-intro' }, _('User routes take priority over dynamically learned routes. Configure access to IP addresses and networks through a selected gateway or network interface.')),
					tabs,
					E('div', { class: 'fn-route-user-head' }, [
						this.userRoutesTitle,
						E('div', { class: 'fn-route-head-actions' }, [ addButton, importButton, saveButton, deleteButton, importInput ])
					]),
					this.importPanel,
					this.formPanel,
					this.table
				])
			]),
			E('div', { class: 'fn-card', style: 'grid-column: 1 / -1' }, [
				E('div', { class: 'fn-card-head' }, [ this.activeTitle ]),
				E('div', { class: 'fn-card-body' }, [
					this.activeDescription,
					this.activeTable
				])
			])
		]);
	},

	makeTab(family, label) {
		const button = E('button', {
			type: 'button',
			class: 'fn-tab',
			role: 'tab',
			'aria-selected': family === this.activeFamily ? 'true' : 'false',
			click: () => this.setFamily(family)
		}, label);
		this.tabButtons[family] = button;
		if (family === this.activeFamily)
			button.classList.add('fn-active');
		return button;
	},

	setFamily(family) {
		this.activeFamily = family;
		this.selectedRoutes = {};
		Object.keys(this.tabButtons).forEach(key => {
			const active = key === family;
			this.tabButtons[key].classList.toggle('fn-active', active);
			this.tabButtons[key].setAttribute('aria-selected', active ? 'true' : 'false');
		});
		dom_content(this.addButton, family === 'dns' ? _('Add DNS route') : _('Add route'));
		dom_content(this.userRoutesTitle, family === 'dns' ? _('DNS routes') : _('User routes'));
		this.closeImportDialog();
		this.closeImport();
		this.closeForm();
		this.fillTable();
		this.fillActiveTable();
	},

	selectionKey(family, value) {
		return family + ':' + value;
	},

	setRouteSelected(key, selected) {
		if (selected)
			this.selectedRoutes[key] = true;
		else
			delete this.selectedRoutes[key];
		this.updateSelectionButtons();
	},

	selectedRouteKeys() {
		const prefix = this.activeFamily + ':';
		return Object.keys(this.selectedRoutes).filter(key => key.indexOf(prefix) === 0);
	},

	updateSelectionButtons() {
		const hasSelection = !!this.selectedRouteKeys().length;
		if (this.saveButton)
			this.saveButton.disabled = !hasSelection;
		if (this.deleteButton)
			this.deleteButton.disabled = !hasSelection;
	},

	saveSelectedRoutes(button) {
		const selected = this.selectedRouteKeys();
		if (!selected.length)
			return;

		button.disabled = true;
		return uci.save().then(() => applyChanges()).then(() => {
			notify(_('Saved routes: %d.').format(selected.length), 'info');
			this.selectedRoutes = {};
			return this.refresh();
		}).catch(error => {
			button.disabled = false;
			this.updateSelectionButtons();
			notify(_('Failed to save routes: %s').format(error.message || error), 'danger');
		});
	},

	deleteSelectedRoutes(button) {
		const selected = this.selectedRouteKeys();
		if (!selected.length)
			return;
		if (!window.confirm(_('Delete selected routes (%d)?').format(selected.length)))
			return;

		if (this.activeFamily === 'dns') {
			const dns = this.getDnsConfig();
			selected.map(key => +key.slice('dns:'.length)).sort((a, b) => b - a).forEach(index => {
				if (index >= 0 && index < dns.servers.length)
					dns.servers.splice(index, 1);
			});
			if (dns.section)
				uci.set('dhcp', dns.section, 'server', dns.servers);
		}
		else {
			selected.forEach(key => uci.remove('network', key.slice((this.activeFamily + ':').length)));
		}

		button.disabled = true;
		return uci.save().then(() => applyChanges()).then(() => {
			notify(_('Deleted routes: %d.').format(selected.length), 'info');
			this.selectedRoutes = {};
			return this.refresh();
		}).catch(error => {
			button.disabled = false;
			this.updateSelectionButtons();
			notify(_('Failed to delete routes: %s').format(error.message || error), 'danger');
		});
	},

	getInterfaces() {
		const result = [];
		const seen = {};
		uci.sections('network', 'interface').forEach(section => {
			const value = sectionName(section);
			if (!value || value === 'loopback' || section.proto === 'none')
				return;
			seen[value] = true;
			result.push({ value: value, label: section.label || section.description || interfaceFriendlyLabel(value) });
		});

		/* A route may refer to an interface supplied by another package. Keep it
		 * selectable when editing even if the package did not expose a UCI
		 * interface section in the current snapshot. */
		['route', 'route6'].forEach(type => uci.sections('network', type).forEach(route => {
			const value = route.interface;
			if (value && !seen[value]) {
				seen[value] = true;
				result.push({ value: value, label: interfaceFriendlyLabel(value) });
			}
		}));

		return result;
	},

	getConfiguredRoutes(family) {
		const type = family === 'ipv6' ? 'route6' : 'route';
		return uci.sections('network', type).map(section => ({
			section: sectionName(section),
			target: routeTarget(section, family),
			gateway: section.gateway || '',
			interface: section.interface || '',
			metric: section.metric || '',
			table: section.table || '',
			description: section.freenetic_description || section.description || section.comment || '',
			automatic: section.freenetic_auto !== '0',
			raw: section
		}));
	},

	getDnsConfig() {
		const sections = uci.sections('dhcp', 'dnsmasq');
		const section = sections[0];
		const servers = section ? listValue(section.server) : [];
		return {
			section: sectionName(section),
			servers: servers,
			entries: servers.map((raw, index) => {
				const parsed = parseDnsServer(raw);
				return parsed ? Object.assign(parsed, { index: index }) : null;
			}).filter(Boolean),
			otherCount: servers.filter(raw => !parseDnsServer(raw)).length
		};
	},

	fillTable() {
		const table = this.table;
		dom_empty(table);
		if (this.activeFamily === 'dns') {
			this.fillDnsTable(table);
			return;
		}

		const routes = this.getConfiguredRoutes(this.activeFamily);
		const rowClass = 'fn-table-row fn-route-row';
		if (!routes.length) {
			table.appendChild(E('div', { class: 'fn-route-empty' }, _('No active routes')));
			this.updateSelectionButtons();
			return;
		}

		const routeChecks = [];
		const selectAll = E('input', {
			type: 'checkbox',
			'aria-label': _('Select all routes'),
			change: event => routeChecks.forEach(check => {
				check.checked = event.target.checked;
				this.setRouteSelected(check.dataset.routeKey, check.checked);
			})
		});
		table.appendChild(E('div', { class: rowClass + ' fn-table-head' }, [
			E('div', {}, selectAll),
			E('div', {}, _('Destination')),
			E('div', {}, _('Gateway')),
			E('div', {}, _('Interface')),
			E('div', {}, _('Metric')),
			E('div', {}, '')
		]));

		routes.forEach(route => table.appendChild(E('div', { class: rowClass }, [
			(() => {
				const check = E('input', {
					type: 'checkbox',
					'aria-label': _('Select route %s').format(route.target || ''),
					change: event => {
						this.setRouteSelected(event.target.dataset.routeKey, event.target.checked);
						selectAll.checked = routeChecks.length && routeChecks.every(item => item.checked);
					}
				});
				check.dataset.routeKey = this.selectionKey(this.activeFamily, route.section);
				check.checked = !!this.selectedRoutes[check.dataset.routeKey];
				routeChecks.push(check);
				return E('div', { class: 'fn-route-select-cell' }, check);
			})(),
			E('div', { 'data-label': _('Destination') }, route.target || '–'),
			E('div', { 'data-label': _('Gateway') }, route.gateway || '–'),
			E('div', { 'data-label': _('Interface') }, routeInterfaceLabel(route.interface, this.interfaces)),
			E('div', { 'data-label': _('Metric') }, route.metric || '–'),
			E('div', { class: 'fn-table-actions', 'data-label': _('Actions') }, [
				E('button', { type: 'button', class: 'fn-settings-btn', click: () => this.openForm(route, this.activeFamily) }, _('Edit')),
				E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-danger', click: () => this.deleteRoute(route.section, this.activeFamily) }, _('Delete'))
				])
			])));
		this.updateSelectionButtons();
	},

	fillDnsTable(table) {
		const dns = this.getDnsConfig();
		if (!dns.entries.length) {
			table.appendChild(E('div', { class: 'fn-route-empty' }, _('No DNS routes configured.')));
			this.updateSelectionButtons();
			return;
		}

		const routeChecks = [];
		const selectAll = E('input', {
			type: 'checkbox',
			'aria-label': _('Select all DNS routes'),
			change: event => routeChecks.forEach(check => {
				check.checked = event.target.checked;
				this.setRouteSelected(check.dataset.routeKey, check.checked);
			})
		});
		table.appendChild(E('div', { class: 'fn-table-row fn-route-dns-row fn-table-head' }, [
			E('div', {}, selectAll),
			E('div', {}, _('Domain')),
			E('div', {}, _('DNS server')),
			E('div', {}, '')
		]));

		dns.entries.forEach(entry => table.appendChild(E('div', { class: 'fn-table-row fn-route-dns-row' }, [
			(() => {
				const check = E('input', {
					type: 'checkbox',
					'aria-label': _('Select DNS route %s').format(entry.domain),
					change: event => {
						this.setRouteSelected(event.target.dataset.routeKey, event.target.checked);
						selectAll.checked = routeChecks.length && routeChecks.every(item => item.checked);
					}
				});
				check.dataset.routeKey = this.selectionKey('dns', entry.index);
				check.checked = !!this.selectedRoutes[check.dataset.routeKey];
				routeChecks.push(check);
				return E('div', { class: 'fn-route-select-cell' }, check);
			})(),
			E('div', { 'data-label': _('Domain') }, entry.domain),
			E('div', { 'data-label': _('DNS server') }, entry.server),
			E('div', { class: 'fn-table-actions', 'data-label': _('Actions') }, [
				E('button', { type: 'button', class: 'fn-settings-btn', click: () => this.openForm(entry, 'dns') }, _('Edit')),
				E('button', { type: 'button', class: 'fn-settings-btn fn-settings-btn-danger', click: () => this.deleteDnsRoute(entry.index) }, _('Delete'))
			])
		])));

		if (dns.otherCount)
			table.appendChild(E('p', { class: 'fn-info-empty fn-route-preserved' }, _('Other dnsmasq server entries preserved: %d.').format(dns.otherCount)));
		this.updateSelectionButtons();
	},

	fillActiveTable() {
		const table = this.activeTable;
		dom_empty(table);
		if (this.activeFamily === 'dns') {
			dom_content(this.activeTitle, _('DNS routing'));
			dom_content(this.activeDescription, _('DNS forwarding rules are listed in the DNS routes table above.'));
			table.appendChild(E('div', { class: 'fn-info-empty' }, _('There are no kernel routes to display for DNS routing.')));
			return;
		}

		dom_content(this.activeTitle, this.activeFamily === 'ipv6' ? _('Active IPv6 routes') : _('Active IPv4 routes'));
		dom_content(this.activeDescription, _('Routes currently installed in the kernel, including connected and default routes.'));
		const rows = [];
		(this.interfaceDump.interface || []).forEach(iface => {
			(iface.route || []).forEach(route => {
				const familyKey = String(route.target || '').indexOf(':') !== -1 ? 'ipv6' : 'ipv4';
				if (familyKey !== this.activeFamily)
					return;
				const suffix = route.mask != null && route.mask !== '' ? '/' + route.mask : '';
				const interfaceName = route.interface || iface.interface || iface.l3_device || '';
				rows.push({
					target: (route.target || '–') + suffix,
					gateway: route.nexthop || '–',
					interface: routeInterfaceLabel(interfaceName, this.interfaces)
				});
			});
		});

		table.appendChild(E('div', { class: 'fn-table-row fn-route-active-row fn-table-head' }, [
			E('div', {}, _('Destination')),
			E('div', {}, _('Gateway')),
			E('div', {}, _('Interface'))
		]));

		if (!rows.length) {
			table.appendChild(E('div', { class: 'fn-info-empty' }, _('No active routes reported by netifd.')));
			return;
		}

		rows.forEach(route => table.appendChild(E('div', { class: 'fn-table-row fn-route-active-row' }, [
			E('div', { 'data-label': _('Destination') }, route.target),
			E('div', { 'data-label': _('Gateway') }, route.gateway),
			E('div', { 'data-label': _('Interface') }, route.interface)
		])));
	},

	openForm(route, family) {
		this.closeForm();
		this.editingSection = family === 'dns' ? null : (route && route.section);
		this.editingDnsIndex = family === 'dns' && route ? route.index : null;
		if (family === 'dns') {
			dom_empty(this.formPanel);
			this.renderDnsForm(route);
			this.formPanel.hidden = false;
			this.formPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
		}
		else {
			this.renderRouteForm(route, family);
		}
	},

	renderRouteForm(route, family) {
		const isV6 = family === 'ipv6';
		const routeType = route ? routeTypeFor(route, family) : 'host';
		const targetValue = route ? route.target : '';
		const targetParts = routeTargetParts(targetValue);
		let displayedTarget = route ? targetParts.address : '';
		if (route && routeType !== 'host' && routeType !== 'default')
			displayedTarget = targetValue;
		if (route && routeType === 'default')
			displayedTarget = isV6 ? '::/0' : '0.0.0.0/0';

		const routeTypeSelect = E('select', { class: 'fn-input' }, [
			E('option', { value: 'host' }, _('Route to host')),
			E('option', { value: 'network' }, _('Route to network')),
			E('option', { value: 'default' }, _('Default route'))
		]);
		routeTypeSelect.value = routeType;
		const descriptionInput = E('input', {
			type: 'text', class: 'fn-input', value: route ? (route.description || '') : '',
			placeholder: _('Optional description'), maxlength: '160'
		});
		const targetInput = E('input', {
			type: 'text', class: 'fn-input', value: displayedTarget,
			placeholder: isV6 ? '2001:db8:100::/64' : '192.168.2.0',
			autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false'
		});
		const gatewayInput = E('input', {
			type: 'text', class: 'fn-input', value: route ? (route.gateway || '') : '',
			placeholder: isV6 ? '2001:db8:100::1' : '192.168.1.1',
			autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false'
		});
		const interfaceSelect = this.interfaceSelect(route ? route.interface : '', true);
		const metricInput = E('input', {
			type: 'number', class: 'fn-input', value: route ? (route.metric || '') : '',
			min: '0', max: '4294967295', step: '1', placeholder: _('Automatic')
		});
		const automaticInput = E('input', {
			type: 'checkbox', checked: route ? route.automatic : true
		});
		const targetLabel = E('label', {}, _('Destination address'));
		const targetError = E('div', { class: 'fn-route-modal-error', hidden: true });
		const gatewayError = E('div', { class: 'fn-route-modal-error', hidden: true });
		const interfaceHint = E('div', { class: 'fn-route-modal-hint' }, _('Choose a gateway or an interface for the route.'));
		const targetField = E('div', { class: 'fn-settings-field fn-route-modal-field' }, [ targetLabel, targetInput, targetError ]);
		const gatewayField = E('div', { class: 'fn-settings-field fn-route-modal-field' }, [ E('label', {}, _('Gateway')), gatewayInput, gatewayError ]);
		const interfaceField = E('div', { class: 'fn-settings-field fn-route-modal-field' }, [ E('label', {}, _('Interface')), interfaceSelect, interfaceHint ]);
		const autoField = E('label', { class: 'fn-route-modal-checkbox' }, [ automaticInput, E('span', {}, [
			E('span', { class: 'fn-route-modal-checkbox-title' }, _('Add automatically')),
			E('span', { class: 'fn-route-modal-hint' }, _('Apply the route when the selected gateway or interface is available.'))
		]) ]);

		const updateType = () => {
			const type = routeTypeSelect.value;
			const disabled = type === 'default';
			targetInput.disabled = disabled;
			if (disabled)
				targetInput.value = isV6 ? '::/0' : '0.0.0.0/0';
			else if (type === 'host' && (targetInput.value === '::/0' || targetInput.value === '0.0.0.0/0'))
				targetInput.value = '';
			dom_content(targetLabel, type === 'host' ? _('Host address') : _('Network address (CIDR)'));
			targetInput.placeholder = type === 'host'
				? (isV6 ? '2001:db8::10' : '192.168.2.10')
				: (isV6 ? '2001:db8:100::/64' : '192.168.2.0/24');
		};
		routeTypeSelect.addEventListener('change', updateType);
		updateType();

		const save = E('button', {
			type: 'button', class: 'fn-settings-btn fn-settings-btn-primary fn-route-modal-submit', style: 'width:auto; padding:8px 20px;',
			click: () => this.saveRoute({
				family: family,
				routeType: routeTypeSelect.value,
				target: targetInput.value.trim(),
				gateway: gatewayInput.value.trim(),
				interface: interfaceSelect.value,
				metric: metricInput.value.trim(),
				description: descriptionInput.value.trim(),
				automatic: automaticInput.checked,
				targetError: targetError,
				gatewayError: gatewayError
			}, save)
		}, this.editingSection ? _('Save') : _('Add route'));
		const cancel = E('button', { type: 'button', class: 'fn-settings-btn', style: 'width:auto; padding:8px 20px;', click: () => this.closeForm() }, _('Cancel'));
		const modalBody = [
			E('p', { class: 'fn-route-modal-description' }, _('Choose a route type and destination. Enter a gateway or select the interface through which traffic should be sent.')),
			E('div', { class: 'fn-settings-field fn-route-modal-field' }, [ E('label', {}, _('Route type')), routeTypeSelect ]),
			E('div', { class: 'fn-settings-field fn-route-modal-field' }, [ E('label', {}, _('Description')), descriptionInput ]),
			targetField,
			gatewayField,
			interfaceField,
			autoField,
			E('div', { class: 'fn-route-modal-advanced' }, [
				E('label', {}, _('Metric (optional)')),
				metricInput
			]),
			E('div', { class: 'fn-pf-actions fn-route-modal-actions' }, [ cancel, save ])
		];

		ui.showModal(this.editingSection ? _('Static route parameters') : _('Static route parameters'), modalBody);
		this.routeModalOpen = true;
		const modal = document.querySelector('#modal_overlay .modal');
		if (modal) {
			modal.classList.add('fn-route-modal');
			const close = E('button', {
				type: 'button', class: 'fn-route-modal-close',
				'aria-label': _('Close'), click: () => this.closeForm()
			}, '×');
			modal.insertBefore(close, modal.firstChild);
		}
	},

	interfaceSelect(value, allowAny) {
		const options = [];
		if (allowAny)
			options.push(E('option', { value: '' }, _('Any')));
		this.interfaces.forEach(item => options.push(E('option', { value: item.value }, item.label)));
		if (value && !this.interfaces.some(item => item.value === value))
			options.push(E('option', { value: value }, value));
		if (!options.length)
			options.push(E('option', { value: '' }, _('No network interfaces found')));
		const select = E('select', { class: 'fn-input' }, options);
		select.value = value || (allowAny ? '' : (this.interfaces[0] ? this.interfaces[0].value : ''));
		select.disabled = !allowAny && !this.interfaces.length && !value;
		return select;
	},

	renderDnsForm(route) {
		const domainInput = E('input', {
			type: 'text', class: 'fn-input', value: route ? route.domain : '',
			placeholder: 'example.com', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false'
		});
		const serverInput = E('input', {
			type: 'text', class: 'fn-input', value: route ? route.server : '',
			placeholder: '1.1.1.1 or 2001:4860:4860::8888#53', autocapitalize: 'none', autocorrect: 'off', spellcheck: 'false'
		});
		const save = E('button', {
			type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', style: 'width:auto; padding:8px 20px;',
			click: () => this.saveDnsRoute({ domain: domainInput.value.trim(), server: serverInput.value.trim() }, save)
		}, route ? _('Save') : _('Add DNS route'));
		const cancel = E('button', { type: 'button', class: 'fn-settings-btn', style: 'width:auto; padding:8px 20px;', click: () => this.closeForm() }, _('Cancel'));

		this.formPanel.appendChild(E('div', { class: 'fn-pf-form' }, [
			E('div', { class: 'fn-pf-row' }, [
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('Domain')), domainInput ]),
				E('div', { class: 'fn-settings-field' }, [ E('label', {}, _('DNS server')), serverInput ])
			]),
			E('p', { class: 'fn-info-empty' }, _('Queries for this domain will be forwarded to the selected DNS server.')),
			E('div', { class: 'fn-pf-actions' }, [ save, cancel ])
		]));
	},

	closeForm() {
		if (this.routeModalOpen) {
			ui.hideModal();
			this.routeModalOpen = false;
		}
		if (!this.formPanel)
			return;
		this.formPanel.hidden = true;
		dom_empty(this.formPanel);
		this.editingSection = null;
		this.editingDnsIndex = null;
	},

	openImportDialog() {
		if (this.importDialogOpen)
			return;

		const interfaceSelect = this.interfaceSelect(this.importInterfaceValue || '');
		interfaceSelect.addEventListener('change', () => {
			this.importInterfaceValue = interfaceSelect.value;
		});

		const chooseButton = E('button', {
			type: 'button',
			class: 'fn-settings-btn fn-settings-btn-primary',
			style: 'width:auto; padding:8px 20px;',
			click: () => {
				this.importInterfaceValue = interfaceSelect.value;
				this.importInput.click();
			}
		}, _('Choose file'));
		const cancelButton = E('button', {
			type: 'button',
			class: 'fn-settings-btn',
			style: 'width:auto; padding:8px 20px;',
			click: () => this.closeImportDialog()
		}, _('Cancel'));

		ui.showModal(_('Upload route list from computer'), [
			E('p', { class: 'fn-route-upload-description' }, _('You can add routes from a Windows operating system batch file or any text file containing route records in a compatible format.')),
			E('p', { class: 'fn-route-upload-example' }, [
				E('span', {}, _('Example of a valid route record:')),
				E('code', {}, 'route ADD 157.0.0.0 MASK 255.0.0.0 157.55.80.1')
			]),
			E('div', { class: 'fn-settings-field fn-route-upload-interface' }, [
				E('label', {}, _('OpenWrt interface for imported routes')),
				interfaceSelect,
				E('span', { class: 'fn-route-upload-hint' }, _('All routes from this file will be assigned to the selected interface.'))
			]),
			E('div', { class: 'fn-pf-actions fn-route-upload-actions' }, [ chooseButton, cancelButton ])
		]);
		this.importDialogOpen = true;

		const modal = document.querySelector('#modal_overlay .modal');
		if (modal) {
			modal.classList.add('fn-route-upload-modal');
			const close = E('button', {
				type: 'button', class: 'fn-route-modal-close',
				'aria-label': _('Close'), click: () => this.closeImportDialog()
			}, '×');
			modal.insertBefore(close, modal.firstChild);
		}
	},

	closeImportDialog() {
		if (!this.importDialogOpen)
			return;
		ui.hideModal();
		this.importDialogOpen = false;
	},

	readImportFile(file) {
		const interfaceName = this.importInterfaceValue;
		this.closeImportDialog();
		if (file.size > 2 * 1024 * 1024) {
			notify(_('Route files are limited to 2 MiB.'), 'warning');
			return;
		}

		const reader = new FileReader();
		reader.addEventListener('load', () => this.renderImportPreview(file.name, parseRouteFile(reader.result), interfaceName));
		reader.addEventListener('error', () => notify(_('Unable to read the selected route file.'), 'danger'));
		reader.readAsText(file);
	},

	closeImport() {
		if (!this.importPanel)
			return;
		this.importPanel.hidden = true;
		dom_empty(this.importPanel);
		this.importState = null;
	},

	renderImportPreview(fileName, parsed, interfaceName) {
		this.closeForm();
		this.closeImportDialog();
		const state = {
			routes: parsed.routes,
			checks: []
		};
		this.importState = state;

		const interfaceSelect = this.interfaceSelect(interfaceName || '');
		const preview = E('div', { class: 'fn-route-import-preview' });
		const table = E('div', { class: 'fn-table fn-route-import-table' });
		table.appendChild(E('div', { class: 'fn-table-row fn-route-import-row fn-table-head' }, [
			E('div', {}, ''),
			E('div', {}, _('Family')),
			E('div', {}, _('Destination')),
			E('div', {}, _('Gateway')),
			E('div', {}, _('Metric'))
		]));

		parsed.routes.forEach(route => {
			const check = E('input', { type: 'checkbox' });
			check.checked = true;
			state.checks.push(check);
			table.appendChild(E('div', { class: 'fn-table-row fn-route-import-row' }, [
				E('div', {}, check),
				E('div', { 'data-label': _('Family') }, route.family === 'ipv6' ? 'IPv6' : 'IPv4'),
				E('div', { 'data-label': _('Destination') }, route.family === 'ipv4' ? route.target + '/' + netmaskToPrefix(route.netmask) : route.target),
				E('div', { 'data-label': _('Gateway') }, route.gateway || '–'),
				E('div', { 'data-label': _('Metric') }, route.metric || '–')
			]));
		});

		const messages = [];
		if (parsed.routes.length)
			messages.push(E('p', { class: 'fn-info-empty' }, _('Parsed route records: %d from %s. Select the records to import and choose their OpenWrt interface.').format(parsed.routes.length, fileName)));
		else
			messages.push(E('p', { class: 'fn-info-empty' }, _('No compatible route records were found in %s.').format(fileName)));
		if (parsed.ignored)
			messages.push(E('p', { class: 'fn-info-empty' }, parsed.ignored === 1
				? _('1 unrelated line was ignored.')
				: _('%d unrelated lines were ignored.').format(parsed.ignored)));
		if (parsed.errors.length) {
			messages.push(E('p', { class: 'fn-route-import-errors-title' }, parsed.errors.length === 1
				? _('1 route line needs attention:')
				: _('%d route lines need attention:').format(parsed.errors.length)));
			const errors = E('div', { class: 'fn-route-import-errors' });
			parsed.errors.slice(0, 20).forEach(error => errors.appendChild(E('div', {}, _('Line %d: %s').format(error.line, error.message))));
			if (parsed.errors.length > 20)
				errors.appendChild(E('div', {}, _('Only the first 20 errors are shown.')));
			messages.push(errors);
		}

		const importButton = E('button', {
			type: 'button', class: 'fn-settings-btn fn-settings-btn-primary', style: 'width:auto; padding:8px 20px;',
			click: () => this.importRoutes(interfaceSelect, importButton)
		}, _('Import selected'));
		importButton.disabled = !parsed.routes.length || !this.interfaces.length;
		const cancelButton = E('button', {
			type: 'button', class: 'fn-settings-btn', style: 'width:auto; padding:8px 20px;',
			click: () => this.closeImport()
		}, _('Cancel'));

		preview.appendChild(E('div', { class: 'fn-route-import-messages' }, messages));
		if (parsed.routes.length) {
			preview.appendChild(E('div', { class: 'fn-settings-field fn-route-import-interface' }, [
				E('label', {}, _('OpenWrt interface for imported routes')),
				interfaceSelect
			]));
			preview.appendChild(table);
		}
		preview.appendChild(E('div', { class: 'fn-pf-actions' }, [ importButton, cancelButton ]));

		dom_empty(this.importPanel);
		this.importPanel.appendChild(preview);
		this.importPanel.hidden = false;
		this.importPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
	},

	importRoutes(interfaceSelect, button) {
		const state = this.importState;
		if (!state)
			return;
		if (!interfaceSelect.value) {
			notify(_('Select an OpenWrt interface for the imported routes.'), 'warning');
			return;
		}

		const selected = state.routes.filter((_route, index) => state.checks[index].checked);
		if (!selected.length) {
			notify(_('Select at least one route to import.'), 'warning');
			return;
		}

		const existing = {};
		['ipv4', 'ipv6'].forEach(family => this.getConfiguredRoutes(family).forEach(route => {
			existing[routeKey(route, family, route.interface)] = true;
		}));

		let added = 0;
		let skipped = 0;
		selected.forEach(route => {
			const key = importedRouteKey(route, interfaceSelect.value);
			if (existing[key]) {
				skipped++;
				return;
			}
			existing[key] = true;
			const section = uci.add('network', route.family === 'ipv6' ? 'route6' : 'route');
			uci.set('network', section, 'interface', interfaceSelect.value);
			uci.set('network', section, 'target', route.target);
			if (route.family === 'ipv4')
				uci.set('network', section, 'netmask', route.netmask);
			if (route.gateway)
				uci.set('network', section, 'gateway', route.gateway);
			if (route.metric)
				uci.set('network', section, 'metric', route.metric);
			added++;
		});

		if (!added) {
			notify(_('All selected routes already exist for this interface.'), 'info');
			return;
		}

		button.disabled = true;
		return uci.save().then(() => applyChanges()).then(() => {
			const suffix = skipped ? ' ' + _('Skipped duplicate routes: %d.').format(skipped) : '';
			notify(_('Imported routes: %d.').format(added) + suffix, 'info');
			this.closeImport();
			return this.refresh();
		}).catch(error => {
			button.disabled = false;
			notify(_('Failed to import routes: %s').format(error.message || error), 'danger');
		});
	},

	validateRoute(fields) {
		const error = (message, field) => ({ message: message, field: field });
		const isV6 = fields.family === 'ipv6';
		const max = isV6 ? 128 : 32;

		if (!metric(fields.metric))
			return error(_('Metric must be a non-negative number.'), 'metric');
		if (fields.gateway && (isV6 ? !ipv6(fields.gateway) : !ipv4(fields.gateway)))
			return error(isV6 ? _('Gateway must be a valid IPv6 address.') : _('Gateway must be a valid IPv4 address.'), 'gateway');
		if (!fields.gateway && !fields.interface)
			return error(_('Enter a gateway or choose an interface.'), 'gateway');

		if (fields.routeType === 'default') {
			fields.normalizedTarget = isV6 ? '::/0' : '0.0.0.0';
			fields.normalizedNetmask = isV6 ? '' : '0.0.0.0';
			return null;
		}

		const parts = routeTargetParts(fields.target);
		if (isV6) {
			if (!ipv6(parts.address))
				return error(_('Destination must be a valid IPv6 address or CIDR.'), 'target');
			if (parts.prefix !== '' && !prefix(parts.prefix, max))
				return error(_('IPv6 prefix must be between 0 and 128.'), 'target');
			if (fields.routeType === 'host') {
				if (parts.prefix !== '' && +parts.prefix !== max)
					return error(_('A host route must use the /128 prefix.'), 'target');
				fields.normalizedTarget = parts.address + '/128';
			}
			else {
				if (parts.prefix === '')
					return error(_('A network route must include a CIDR prefix.'), 'target');
				if (+parts.prefix === max)
					return error(_('Use Route to host for a /128 destination.'), 'target');
				fields.normalizedTarget = parts.address + '/' + parts.prefix;
			}
			fields.normalizedNetmask = '';
			return null;
		}

		if (!ipv4(parts.address))
			return error(_('Destination must be a valid IPv4 address or CIDR.'), 'target');
		if (parts.prefix !== '' && !prefix(parts.prefix, max))
			return error(_('IPv4 prefix must be between 0 and 32.'), 'target');
		if (fields.routeType === 'host') {
			if (parts.prefix !== '' && +parts.prefix !== max)
				return error(_('A host route must use the /32 prefix.'), 'target');
			fields.normalizedTarget = parts.address;
			fields.normalizedNetmask = '255.255.255.255';
		}
		else {
			if (parts.prefix === '')
				return error(_('A network route must include a CIDR prefix.'), 'target');
			if (+parts.prefix === max)
				return error(_('Use Route to host for a /32 destination.'), 'target');
			fields.normalizedTarget = parts.address;
			fields.normalizedNetmask = prefixToNetmask(parts.prefix);
		}
		return null;
	},

	saveRoute(fields, button) {
		const error = this.validateRoute(fields);
		if (error) {
			if (fields.targetError) {
				dom_content(fields.targetError, error.field === 'target' ? error.message : '');
				fields.targetError.hidden = error.field !== 'target';
			}
			if (fields.gatewayError) {
				dom_content(fields.gatewayError, error.field === 'gateway' ? error.message : '');
				fields.gatewayError.hidden = error.field !== 'gateway';
			}
			notify(error.message, 'warning');
			return Promise.resolve();
		}
		if (fields.targetError)
			fields.targetError.hidden = true;
		if (fields.gatewayError)
			fields.gatewayError.hidden = true;

		button.disabled = true;
		const type = fields.family === 'ipv6' ? 'route6' : 'route';
		const section = this.editingSection || uci.add('network', type);
		if (fields.interface)
			uci.set('network', section, 'interface', fields.interface);
		else
			uci.unset('network', section, 'interface');
		uci.set('network', section, 'target', fields.normalizedTarget);
		if (fields.family === 'ipv4')
			uci.set('network', section, 'netmask', fields.normalizedNetmask);
		else if (fields.normalizedTarget.indexOf('/') !== -1)
			uci.unset('network', section, 'netmask');
		if (fields.gateway)
			uci.set('network', section, 'gateway', fields.gateway);
		else
			uci.unset('network', section, 'gateway');
		if (fields.metric)
			uci.set('network', section, 'metric', fields.metric);
		else
			uci.unset('network', section, 'metric');
		if (fields.description)
			uci.set('network', section, 'freenetic_description', fields.description);
		else
			uci.unset('network', section, 'freenetic_description');
		uci.set('network', section, 'freenetic_auto', fields.automatic ? '1' : '0');

		return uci.save().then(() => applyChanges()).then(() => {
			notify(this.editingSection ? _('Route saved.') : _('Route added.'), 'info');
			this.closeForm();
			return this.refresh();
		}).catch(error => {
			button.disabled = false;
			notify(_('Failed to save route: %s').format(error.message || error), 'danger');
		});
	},

	deleteRoute(section, family) {
		if (!window.confirm(_('Delete this %s route?').format(family === 'ipv6' ? 'IPv6' : 'IPv4')))
			return;
		uci.remove('network', section);
		return uci.save().then(() => applyChanges()).then(() => {
			notify(_('Route deleted.'), 'info');
			return this.refresh();
		}).catch(error => notify(_('Failed to delete route: %s').format(error.message || error), 'danger'));
	},

	validateDns(fields) {
		if (!dnsDomain(fields.domain))
			return _('Enter a valid domain pattern.');
		if (!dnsServer(fields.server))
			return _('DNS server must be an IPv4/IPv6 address, optionally followed by #port.');
		return null;
	},

	saveDnsRoute(fields, button) {
		const error = this.validateDns(fields);
		if (error) {
			notify(error, 'warning');
			return Promise.resolve();
		}

		button.disabled = true;
		let section = this.getDnsConfig().section;
		if (!section)
			section = uci.add('dhcp', 'dnsmasq');

		const servers = this.getDnsConfig().servers;
		const raw = encodeDnsServer(fields.domain, fields.server);
		if (this.editingDnsIndex != null && this.editingDnsIndex >= 0 && this.editingDnsIndex < servers.length)
			servers[this.editingDnsIndex] = raw;
		else
			servers.push(raw);
		uci.set('dhcp', section, 'server', servers);

		return uci.save().then(() => applyChanges()).then(() => {
			notify(this.editingDnsIndex != null ? _('DNS route saved.') : _('DNS route added.'), 'info');
			this.closeForm();
			return this.refresh();
		}).catch(error => {
			button.disabled = false;
			notify(_('Failed to save DNS route: %s').format(error.message || error), 'danger');
		});
	},

	deleteDnsRoute(index) {
		if (!window.confirm(_('Delete this DNS route?')))
			return;
		const dns = this.getDnsConfig();
		if (index < 0 || index >= dns.servers.length)
			return;
		dns.servers.splice(index, 1);
		if (dns.section)
			uci.set('dhcp', dns.section, 'server', dns.servers);
		return uci.save().then(() => applyChanges()).then(() => {
			notify(_('DNS route deleted.'), 'info');
			return this.refresh();
		}).catch(error => notify(_('Failed to delete DNS route: %s').format(error.message || error), 'danger'));
	},

	refresh() {
		return this.load().then(data => {
			this.interfaceDump = data[2] || { interface: [] };
			this.interfaces = this.getInterfaces();
			this.selectedRoutes = {};
			this.fillTable();
			this.fillActiveTable();
		});
	},

	addFooter() { return E([]); }
});
