'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'view', 'system', 'freenetic-apps.js'), 'utf8');
const originalFormat = String.prototype.format;

function format(...values) {
	let index = 0;
	return String(this).replace(/%s/g, () => String(values[index++]));
}

function evaluate(execDirect, notifications, createElement = () => ({})) {
	const view = { extend(value) { return value; } };
	const uiHelper = {
		empty() {},
		content(node, value) { node.textContent = value; },
		notifyLong(message, level) { notifications.push({ message: String(message), level }); }
	};
	return new Function('view', 'fs', 'uiHelper', 'E', '_', source)(
		view, { exec_direct: execDirect }, uiHelper, createElement, value => value);
}

function initialize(application) {
	application.packageIndexRefresh = null;
	application.packageOperationInProgress = 0;
	application.packageStatusRefreshPending = false;
	application.installedNames = {};
	application.activeFilter = 'recommended';
	application.renderCatalog = () => {};
}

async function successCase() {
	const calls = [];
	const notifications = [];
	const application = evaluate((helper, args) => {
		calls.push(args.slice());
		if (args[0] === 'update')
			return Promise.resolve({ code: 0 });
		if (args[0] === 'install')
			return Promise.resolve({ code: 0 });
		throw new Error(`unexpected helper call: ${helper} ${args.join(' ')}`);
	}, notifications);
	initialize(application);

	const item = { name: 'L2TP/IPsec', packages: [ 'xl2tpd', 'strongswan-default' ] };
	const button = { disabled: false, textContent: '', className: '' };
	const pill = { textContent: '', className: '' };
	await application.toggleItem(item, false, button, pill, {});

	assert.deepEqual(calls.filter(args => args[0] === 'update' || args[0] === 'install'), [
		[ 'update' ],
		[ 'install', 'xl2tpd', 'strongswan-default' ]
	], 'fresh installs must update package indexes before invoking install');
	assert.equal(calls.length, 3, 'a completed operation must query the package state again');
	assert.equal(application.installedNames.xl2tpd, true);
	assert.equal(application.installedNames['strongswan-default'], true);
	assert.equal(notifications.at(-1).level, 'info');
}

async function failedUpdateCase() {
	const calls = [];
	const notifications = [];
	const application = evaluate((helper, args) => {
		calls.push(args.slice());
		return Promise.resolve({ code: 4, stderr: 'network unavailable' });
	}, notifications);
	initialize(application);

	const item = { name: 'L2TP/IPsec', packages: [ 'xl2tpd' ] };
	const button = { disabled: false, textContent: '', className: '' };
	await application.toggleItem(item, false, button, { textContent: '', className: '' }, {});

	assert.deepEqual(calls, [ [ 'update' ] ], 'a failed index refresh must prevent installation');
	assert.equal(button.disabled, false);
	assert.match(notifications.at(-1).message, /network unavailable/);
	assert.equal(application.packageIndexRefresh, null, 'a failed refresh must be retryable');
}

async function sharedRemovalCase() {
	const calls = [];
	const notifications = [];
	const application = evaluate((helper, args) => {
		calls.push(args.slice());
		return Promise.resolve({ code: 0 });
	}, notifications);
	initialize(application);
	application.installedNames = {
		xl2tpd: true,
		'ppp-mod-pppol2tp': true,
		'kmod-l2tp': true,
		'kmod-pppol2tp': true,
		'strongswan-default': true,
		'luci-proto-ppp': true,
		'strongswan-mod-eap-identity': true,
		'strongswan-mod-eap-mschapv2': true,
		xfrm: true,
		'kmod-xfrm-interface': true,
		'luci-proto-xfrm': true
	};
	const item = {
		id: 'l2tp_ipsec', name: 'L2TP/IPsec',
		packages: [ 'xl2tpd', 'ppp-mod-pppol2tp', 'kmod-l2tp', 'kmod-pppol2tp', 'strongswan-default', 'luci-proto-ppp' ]
	};
	const button = { disabled: false, textContent: '', className: '' };
	const pill = { textContent: '', className: '' };
	await application.toggleItem(item, true, button, pill, {});

	assert.deepEqual(calls.filter(args => args[0] === 'remove'),
		[ [ 'remove', 'xl2tpd', 'kmod-l2tp', 'kmod-pppol2tp', 'luci-proto-ppp' ] ]);
	assert.equal(application.installedNames['ppp-mod-pppol2tp'], true);
	assert.equal(application.installedNames['strongswan-default'], true);
	assert.equal(application.installedNames.xl2tpd, undefined);
}

async function mwanRemovalRecoveryCase() {
	const calls = [];
	const application = evaluate((helper, args) => {
		calls.push([ helper, args.slice() ]);
		return Promise.resolve(helper.endsWith('freenetic-tailscale-recover')
			? { ok: true, scheduled: true }
			: { code: 0 });
	}, []);
	initialize(application);
	application.installedNames = { mwan3: true, 'luci-app-mwan3': true };
	const item = { id: 'mwan3', name: 'Multi-WAN', packages: [ 'mwan3', 'luci-app-mwan3' ] };
	await application.toggleItem(item, true, { disabled: false, textContent: '', className: '' },
		{ textContent: '', className: '' }, {});

	assert.equal(calls[0][0], '/usr/libexec/freenetic-tailscale-recover');
	assert.deepEqual(calls[0][1], [ 'schedule' ]);
	assert.equal(calls[1][0], '/usr/libexec/package-manager-call');
	assert.deepEqual(calls[1][1], [ 'remove', 'mwan3', 'luci-app-mwan3' ]);
}

async function zapret2ReleaseInstallCase() {
	const calls = [];
	const notifications = [];
	const application = evaluate((helper, args) => {
		calls.push([ helper, args.slice() ]);
		return Promise.resolve({ code: 0, stdout: 'installed' });
	}, notifications);
	initialize(application);
	const item = {
		id: 'nfqws2', name: 'Zapret2 (NFQWS2)', packages: [ 'freenetic-zapret2' ],
		installHelper: '/usr/libexec/freenetic-zapret2-package'
	};
	await application.toggleItem(item, false, { disabled: false, textContent: '', className: '' },
		{ textContent: '', className: '' }, {});

	assert.deepEqual(calls.slice(0, 1), [
		[ '/usr/libexec/freenetic-zapret2-package', [ 'install' ] ]
	], 'Zapret2 must install from the signed Freenetic release instead of the upstream OpenWrt feed');
	assert.equal(application.installedNames['freenetic-zapret2'], true);
	assert.equal(notifications.at(-1).level, 'info');
}

async function retainedPackageCase() {
	const notifications = [];
	const application = evaluate((helper, args) => {
		if (helper.endsWith('freenetic-package-status'))
			return Promise.resolve({ ok: true, packages: { xl2tpd: { installed: true, available: true } } });
		if (args[0] === 'remove')
			return Promise.resolve({ code: 0 });
		throw new Error(`unexpected helper call: ${helper} ${args.join(' ')}`);
	}, notifications);
	initialize(application);
	application.installedNames = { xl2tpd: true };
	const item = { id: 'l2tp', name: 'L2TP', packages: [ 'xl2tpd' ] };
	await application.toggleItem(item, true, { disabled: false, textContent: '', className: '' },
		{ textContent: '', className: '' }, {});
	assert.equal(application.installedNames.xl2tpd, true,
		'a package retained by apk must remain installed in the card');
	assert.equal(notifications.at(-1).level, 'warning');
}

async function refreshedStatusCase() {
	const application = evaluate((helper) => {
		if (helper.endsWith('freenetic-package-status'))
			return Promise.resolve({ ok: true, packages: { xl2tpd: { installed: false, available: true } } });
		if (helper.endsWith('freenetic-mihomo-package'))
			return Promise.resolve({ ok: true, installed: false });
		throw new Error(`unexpected helper call: ${helper}`);
	}, []);
	initialize(application);
	application.installedNames = { xl2tpd: true };
	await application.refreshPackageStatus();
	assert.equal(application.installedNames.xl2tpd, undefined,
		'a fresh lookup must replace stale installed-package names');
}

function staleIndexCardCase() {
	const nodes = [];
	const createElement = (tag, attrs, children) => {
		const node = {
			tag, attrs: attrs || {}, children,
			addEventListener(name, callback) { this[name] = callback; }
		};
		nodes.push(node);
		return node;
	};
	const application = evaluate(() => Promise.resolve({ code: 0 }), [], createElement);
	initialize(application);
	application.externalStatus = {};
	application.packageAvailabilityKnown = true;
	application.packageStatus = { missing: { installed: false, available: false } };
	application.focusedAppId = '';
	application.renderItem({ id: 'missing', name: 'Missing', desc: 'Example', packages: [ 'missing' ] },
		{ tier: 'recommended' });
	const button = nodes.find(node => node.tag === 'button');
	assert.equal(button.attrs.disabled, undefined,
		'a missing local index must still allow the install action that refreshes indexes');
	assert.equal(typeof button.click, 'function');
}

async function concurrentOperationCase() {
	const calls = [];
	const notifications = [];
	const application = evaluate((helper, args) => {
		calls.push([ helper, args ]);
		return Promise.resolve({ code: 0 });
	}, notifications);
	initialize(application);
	application.packageOperationInProgress = 1;
	await application.toggleItem({ id: 'pbr', name: 'PBR', packages: [ 'pbr' ] }, false,
		{ disabled: false }, {}, {});
	assert.deepEqual(calls, [], 'concurrent package changes must not reach apk');
	assert.equal(notifications.at(-1).level, 'warning');
}

async function repeatedInstallCase() {
	const operations = [];
	const application = evaluate((helper, args) => {
		if (helper.endsWith('package-manager-call'))
			operations.push(args[0]);
		return Promise.resolve({ code: 0 });
	}, []);
	initialize(application);
	for (const name of [ 'pbr', 'ddns-scripts' ]) {
		await application.toggleItem({ id: name, name, packages: [ name ] }, false,
			{ disabled: false, textContent: '', className: '' },
			{ textContent: '', className: '' }, {});
	}
	assert.deepEqual(operations, [ 'update', 'install', 'update', 'install' ],
		'each separate install must refresh package lists');
}

String.prototype.format = format;
Promise.resolve()
	.then(successCase)
	.then(failedUpdateCase)
	.then(sharedRemovalCase)
	.then(mwanRemovalRecoveryCase)
	.then(zapret2ReleaseInstallCase)
	.then(retainedPackageCase)
	.then(refreshedStatusCase)
	.then(staleIndexCardCase)
	.then(concurrentOperationCase)
	.then(repeatedInstallCase)
	.then(() => console.log('Applications package install runtime: ok'))
	.finally(() => {
		if (originalFormat)
			String.prototype.format = originalFormat;
		else
			delete String.prototype.format;
	});
