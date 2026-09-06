'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const childProcess = require('node:child_process');

const repositoryRoot = path.join(__dirname, '..', '..', '..');
const resourcesPath = path.join(__dirname, '..', 'htdocs', 'luci-static', 'resources');
const moduleSource = fs.readFileSync(path.join(resourcesPath, 'freenetic-diagnostics.js'), 'utf8');
const diagnostics = new Function('baseclass', moduleSource)({ extend: value => value });

const summary = diagnostics.summarizeInterfaces({
	interface: [
		{ interface: 'lan', up: true, route: [] },
		{
			interface: 'wan', up: true, proto: 'dhcp', l3_device: 'eth1',
			'ipv4-address': [ { address: '192.0.2.2', mask: 24 } ],
			route: [ { target: '0.0.0.0', mask: 0, nexthop: '192.0.2.1' } ],
			'dns-server': [ '192.0.2.53', '2001:db8::53' ]
		},
		{
			interface: 'wan_backup', up: true, proto: 'static', device: 'eth2',
			'ipv6-address': [ { address: '2001:db8::2', mask: 64 } ],
			route: [ { target: '::', mask: 0, nexthop: '2001:db8::1' } ]
		}
	]
});

assert.deepEqual(summary, [
	{
		name: 'wan', up: true, protocol: 'dhcp', device: 'eth1',
		addresses: [ '192.0.2.2/24' ], gateway: '192.0.2.1',
		dns: [ '192.0.2.53', '2001:db8::53' ]
	},
	{
		name: 'wan_backup', up: true, protocol: 'static', device: 'eth2',
		addresses: [ '2001:db8::2/64' ], gateway: '2001:db8::1', dns: []
	}
]);

assert.deepEqual(diagnostics.summarizeInterfaces({
	interface: [ { interface: 'wan', up: false, proto: 'dhcp', route: [] } ]
}), [ {
	name: 'wan', up: false, protocol: 'dhcp', device: '–',
	addresses: [], gateway: '', dns: []
} ]);

for (const target of [ '1.1.1.1', 'router.example.org', '2001:db8::1', ' host.local ' ])
	assert.ok(diagnostics.normalizeTarget(target));
for (const target of [ '', '-c', 'host name', 'host;reboot', '$(reboot)', 'a'.repeat(254) ])
	assert.equal(diagnostics.normalizeTarget(target), null);

const helperPath = path.join(repositoryRoot, 'app', 'luci-app-freenetic', 'root',
	'usr', 'libexec', 'freenetic-diagnostics-call');
for (const args of [ [], [ 'unknown', 'example.org' ], [ 'ping', '-c' ], [ 'ping', 'host;reboot' ] ]) {
	const result = childProcess.spawnSync(helperPath, args, { encoding: 'utf8' });
	assert.equal(result.status, 2, `unsafe helper arguments must be rejected: ${args.join(' ')}`);
}

console.log('diagnostics boundary and parsing: ok');
