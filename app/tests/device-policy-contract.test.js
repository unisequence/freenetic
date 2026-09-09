'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const viewPath = path.join(root, 'web', 'application', 'htdocs', 'luci-static',
	'resources', 'view', 'network', 'freenetic-wifi-acl.js');
const cssPath = path.join(root, 'web', 'theme', 'htdocs', 'luci-static',
	'freenetic', 'cascade.css');
const view = fs.readFileSync(viewPath, 'utf8');
const css = fs.readFileSync(cssPath, 'utf8');

assert.match(view, /function managedDeviceSection\(mac\)/,
	'device policies need deterministic UCI section names');
assert.match(view, /uci\.set\('pbr', section, 'src_addr', mac\.toLowerCase\(\)\)/,
	'pbr device policies must match the client MAC address');
assert.match(view, /uci\.set\('firewall', section, 'src_mac', \[ mac\.toLowerCase\(\) \]\)/,
	'firewall device policies must match the client MAC address');
assert.match(view, /uci\.move\('pbr', devices\[i\]\['\.name'\], firstNetwork, false\)/,
	'device pbr policies must precede broader segment policies');
assert.match(view, /freenetic_scope', 'device'/,
	'device rules must be marked as Freenetic-managed device rules');
assert.match(view, /fn-wifi-device-policy-cards/,
	'device policies need a dedicated responsive UI container');
assert.match(css, /\.fn-wifi-device-policy-cards[\s\S]*grid-template-columns/,
	'device policy cards need responsive grid styling');

console.log('device policy contract: ok');
