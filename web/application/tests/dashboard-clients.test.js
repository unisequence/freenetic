'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..', '..');
const dashboard = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'view', 'status', 'freenetic-dashboard.js'), 'utf8');
const helperSource = dashboard.slice(
	dashboard.indexOf('function dashboardClientRows'),
	dashboard.indexOf('function getSystemBoard')
);
const upperString = value => typeof value === 'string' ? value.trim().toUpperCase() : '';
const ipInLan = (ip, network) => !!(ip && network && ip.startsWith(network.prefix));
const dashboardClientRows = new Function('upperString', 'ipInLan', '_', helperSource +
	'\nreturn dashboardClientRows;')(
	upperString, ipInLan, value => value
);

const leases = [
	{ macaddr: 'aa:bb:cc:00:00:02', hostname: 'Laptop', ipaddr: '192.168.1.22' },
	{ macaddr: 'aa:bb:cc:00:00:01', hostname: 'Phone', ipaddr: '192.168.50.4' }
];
const stations = {
	'AA:BB:CC:00:00:01': {
		band: '5 GHz',
		device: 'phy1-ap0',
		signal: -52
	}
};
const dhcp = {
	registered_laptop: {
		'.type': 'host',
		mac: 'AA:BB:CC:00:00:02',
		name: 'Work laptop'
	}
};

const rows = dashboardClientRows(leases, stations, { 'AA:BB:CC:00:00:02': true }, dhcp,
	{ prefix: '192.168.50.' });
assert.deepEqual(rows.map(row => row.name), [ 'Phone', 'Work laptop' ],
	'client rows must use saved names and sort them for stable rendering');
assert.deepEqual(rows[0], {
	mac: 'AA:BB:CC:00:00:01',
	name: 'Phone',
	ip: '192.168.50.4',
	segment: 'Guest network',
	connection: '5 GHz Wi-Fi',
	wifi: true,
	ethernet: false,
	online: true
});
assert.equal(rows[1].connection, 'Ethernet');
assert.equal(rows[1].segment, 'Home network');
assert.equal(rows[1].online, true);

const offline = dashboardClientRows([ {
	macaddr: 'AA:BB:CC:00:00:03', hostname: 'Sleeping phone', ipaddr: '192.168.1.30'
} ], {}, {}, {}, { prefix: '192.168.50.' })[0];
assert.equal(offline.connection, 'Not connected',
	'a stale DHCP lease must not be reported as an Ethernet client');
assert.equal(offline.online, false);

console.log('Freenetic dashboard client summary: ok');
