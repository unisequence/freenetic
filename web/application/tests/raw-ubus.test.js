'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const resourcesPath = path.join(__dirname, '..', 'htdocs', 'luci-static', 'resources');
const modulePath = path.join(resourcesPath, 'freenetic-rpc.js');
const source = fs.readFileSync(modulePath, 'utf8');
const requests = [];
const responses = [
	{ result: [ 0, { ok: true } ] },
	{ result: [ 0, null ] },
	{ result: [ 4, null ] },
	{ unexpected: true }
];

const fetchMock = (url, options) => {
	requests.push({ url, options });
	return Promise.resolve({ json: () => Promise.resolve(responses.shift()) });
};
const rpc = new Function('baseclass', 'fetch', 'L', source)(
	{ extend: value => value },
	fetchMock,
	{ url: value => '/cgi-bin/luci/' + value, env: { sessionid: 'test-session' } }
);

(async () => {
	const call = rpc.call;
	assert.deepEqual(await call('system', 'board'), { ok: true },
		'the helper must remain safe when passed around as an unbound function');
	assert.deepEqual(await call('network.interface', 'dump', { verbose: true }), {});

	assert.equal(requests[0].url, '/cgi-bin/luci/admin/ubus');
	assert.equal(requests[0].options.method, 'POST');
	assert.equal(requests[0].options.credentials, 'include');
	assert.equal(requests[0].options.headers['Content-Type'], 'application/json');
	assert.deepEqual(JSON.parse(requests[0].options.body), {
		jsonrpc: '2.0',
		id: 1,
		method: 'call',
		params: [ 'test-session', 'system', 'board', {} ]
	});
	assert.equal(JSON.parse(requests[1].options.body).id, 2);

	await assert.rejects(call('uci', 'get'), /object=uci method=get, code 4/);
	await assert.rejects(call('system', 'info'), /Malformed ubus reply/);

	const expectedViews = [
		'view/network/freenetic-firewall.js',
		'view/network/freenetic-mynetworks.js',
		'view/network/freenetic-portforward.js',
		'view/network/freenetic-routing.js',
		'view/network/freenetic-wan.js',
		'view/status/freenetic-clients.js',
		'view/status/freenetic-dashboard.js',
		'view/status/freenetic-traffic.js',
		'view/status/freenetic-wifimonitor.js',
		'view/system/freenetic-diagnostics.js',
		'view/system/freenetic-system.js'
	];

	for (const relativeView of expectedViews) {
		const view = fs.readFileSync(path.join(resourcesPath, relativeView), 'utf8');
		assert.match(view, /'require freenetic-rpc as rpc';/,
			`${relativeView} must load the shared raw ubus helper`);
		assert.match(view, /const ubusCall = rpc\.call;/,
			`${relativeView} must use the shared raw ubus helper`);
		assert.doesNotMatch(view, /function ubusCall|let ubusReqId/,
			`${relativeView} must not carry a private raw ubus implementation`);
	}

	console.log('raw ubus helper: ok');
})().catch(error => {
	console.error(error);
	process.exitCode = 1;
});
