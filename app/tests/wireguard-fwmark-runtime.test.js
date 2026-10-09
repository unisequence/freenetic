'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root,
	'web/application/htdocs/luci-static/resources/freenetic-connections-wireguard.js'), 'utf8');
const method = source.match(/\bvalidateConnection\(fields\) \{[\s\S]*?\n\t\},/m)?.[0];
assert.ok(method);
const validate = new Function('_', 'validKey', 'validAddress', 'validPort', 'validNumber',
	'AWG_PROTO', 'AWG_OPTIONS', 'validHost', `return ({ ${method} }).validateConnection;`)(
	value => value, () => true, () => true, () => true, () => true,
	'awg', [], () => true);
const fields = {
	name: 'vpn', privateKey: 'dummy', addresses: [ '10.0.0.2/32' ],
	listenPort: '', mtu: '', fwmark: '', dns: [], protocol: 'wireguard', peers: []
};

for (const mark of [ '0x20000000', '0x40000000', '0x60000000', '0xffffffff' ])
	assert.match(validate({ ...fields, fwmark: mark }), /reserved/,
		`${mark} must be rejected before it can collide with Zapret2`);
for (const mark of [ '', '0x1000', '0x10000000' ])
	assert.equal(validate({ ...fields, fwmark: mark }), null,
		`${mark || 'empty mark'} must remain available`);

console.log('WireGuard fwmark runtime: ok');
