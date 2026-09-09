'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const helperPath = path.join(root, 'app', 'luci-app-freenetic', 'root', 'usr',
	'libexec', 'freenetic-network-restart');
const appsPath = path.join(root, 'web', 'application', 'htdocs', 'luci-static',
	'resources', 'view', 'system', 'freenetic-apps.js');
const connectionsPath = path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'view', 'network', 'freenetic-other-connections.js');
const aclPath = path.join(root, 'app', 'luci-app-freenetic', 'root', 'usr',
	'share', 'rpcd', 'acl.d', 'luci-app-freenetic.json');

const helper = fs.readFileSync(helperPath, 'utf8');
const apps = fs.readFileSync(appsPath, 'utf8');
const connections = fs.readFileSync(connectionsPath, 'utf8');
const acl = JSON.parse(fs.readFileSync(aclPath, 'utf8'))['luci-app-freenetic'];

assert.ok(fs.statSync(helperPath).mode & 0o111, 'network restart helper must be executable');
assert.match(helper, /\/etc\/init\.d\/network restart/, 'helper must restart the OpenWrt network service');
assert.match(helper, /pidof netifd/, 'helper must wait for netifd to return');
assert.match(apps, /restartNetifdOnInstall:\s*true/, 'WireGuard install must request a netifd restart');
assert.match(apps, /freenetic-network-restart/, 'Applications must call the network restart helper');
assert.match(connections, /freenetic-network-restart/, 'AWG installation must call the network restart helper');
assert.ok(acl.write.file['/usr/libexec/freenetic-network-restart'],
	'network restart helper must be covered by the rpcd ACL');

console.log('network package restart contract: ok');
