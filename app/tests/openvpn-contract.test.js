'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const viewPath = path.join(root, 'web', 'application', 'htdocs', 'luci-static',
	'resources', 'view', 'network', 'freenetic-other-connections.js');
const aclPath = path.join(root, 'app', 'luci-app-freenetic', 'root', 'usr',
	'share', 'rpcd', 'acl.d', 'luci-app-freenetic.json');
const helperPath = path.join(root, 'app', 'luci-app-freenetic', 'root', 'usr',
	'libexec', 'freenetic-openvpn-profile');
const acl = JSON.parse(fs.readFileSync(aclPath, 'utf8'))['luci-app-freenetic'];
const view = fs.readFileSync(viewPath, 'utf8');
const helper = fs.readFileSync(helperPath, 'utf8');

assert.ok(fs.statSync(helperPath).mode & 0o111, 'OpenVPN profile helper must be executable');
assert.match(helper, /mkdir -p \"\$profile_dir\"/, 'helper must create its managed profile directory');
assert.match(helper, /chmod 600 \"\$profile\"/, 'managed profiles must be private');
assert.match(view, /const OVPN_PROTO = 'openvpn'/, 'Other Connections must expose the OpenVPN protocol');
assert.match(view, /proto === WG_PROTO \|\| proto === AWG_PROTO \|\| proto === OVPN_PROTO/, 'OpenVPN interfaces must be listed with other connections');
assert.match(view, /openOpenvpnImportDialog\(\)/, 'OpenVPN profiles must be importable from the page');
assert.match(view, /storeOpenvpnProfile\(/, 'OpenVPN profiles must be persisted through the managed helper');
assert.match(view, /freenetic_profile/, 'OpenVPN interfaces must mark managed profile storage');
assert.ok(acl.read.file['/etc/openvpn/freenetic/*'], 'OpenVPN profile reads must be covered by the rpcd ACL');
assert.ok(acl.write.file['/tmp/freenetic-openvpn-*'], 'OpenVPN staging writes must be covered by the rpcd ACL');
assert.ok(acl.write.file['/usr/libexec/freenetic-openvpn-profile install *'], 'OpenVPN install helper must be covered by the rpcd ACL');
assert.ok(acl.write.file['/usr/libexec/freenetic-openvpn-profile remove *'], 'OpenVPN remove helper must be covered by the rpcd ACL');

console.log('OpenVPN connection contract: ok');
