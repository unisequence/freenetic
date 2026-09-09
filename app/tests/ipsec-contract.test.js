'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const viewPath = path.join(root, 'web', 'application', 'htdocs', 'luci-static',
	'resources', 'view', 'network', 'freenetic-other-connections.js');
const aclPath = path.join(root, 'app', 'luci-app-freenetic', 'root', 'usr',
	'share', 'rpcd', 'acl.d', 'luci-app-freenetic.json');
const appsPath = path.join(root, 'web', 'application', 'htdocs', 'luci-static',
	'resources', 'view', 'system', 'freenetic-apps.js');
const wifiPath = path.join(root, 'web', 'application', 'htdocs', 'luci-static',
	'resources', 'view', 'network', 'freenetic-wifi-acl.js');
const helperPath = path.join(root, 'app', 'luci-app-freenetic', 'root', 'usr',
	'libexec', 'freenetic-ipsec-restart');

const view = fs.readFileSync(viewPath, 'utf8');
const apps = fs.readFileSync(appsPath, 'utf8');
const wifi = fs.readFileSync(wifiPath, 'utf8');
const helper = fs.readFileSync(helperPath, 'utf8');
const acl = JSON.parse(fs.readFileSync(aclPath, 'utf8'))['luci-app-freenetic'];

assert.ok(fs.statSync(helperPath).mode & 0o111, 'IPsec restart helper must be executable');
assert.match(helper, /\/etc\/init\.d\/swanctl/, 'helper must support the swanctl service');
assert.match(helper, /\/etc\/init\.d\/ipsec/, 'helper must support the legacy ipsec service');
assert.match(view, /const L2TP_IPSEC_PROTO = 'l2tp_ipsec'/, 'Other Connections must expose L2TP/IPsec');
assert.match(view, /const IKEV2_PROTO = 'ikev2'/, 'Other Connections must expose IKEv2/IPsec');
assert.match(view, /proto === L2TP_PROTO && section\.freenetic_protocol === L2TP_IPSEC_PROTO/, 'managed L2TP interfaces must be listed');
assert.match(view, /proto === XFRM_PROTO && section\.freenetic_protocol === IKEV2_PROTO/, 'managed XFRM interfaces must be listed');
assert.match(view, /openL2tpForm\(null\)/, 'L2TP/IPsec must be selectable for a new connection');
assert.match(view, /openIkev2Form\(null\)/, 'IKEv2/IPsec must be selectable for a new connection');
assert.match(view, /uci\.set\(IPSEC_CONFIG, remoteName, 'keyexchange', 'ikev1'\)/, 'L2TP/IPsec must write IKEv1 transport configuration');
assert.match(view, /uci\.set\(IPSEC_CONFIG, remoteName, 'keyexchange', 'ikev2'\)/, 'IKEv2/IPsec must write IKEv2 configuration');
assert.match(view, /'dynamic\[udp\/l2tp\]'/, 'L2TP/IPsec must use the standard UDP/L2TP transport selectors');
assert.match(view, /uci\.set\(IPSEC_CONFIG, childName, 'if_id'/, 'IKEv2 must bind the child SA to the XFRM interface ID');
assert.match(view, /uci\.set\(IPSEC_CONFIG, connection\.remoteSection, 'enabled', '1'\)/, 'IPsec re-enable must explicitly set strongSwan enabled=1');
assert.match(apps, /id: 'l2tp_ipsec',[\s\S]*restartNetifdOnInstall:\s*true/, 'L2TP/IPsec package install must restart netifd');
assert.match(apps, /id: 'ikev2_ipsec',[\s\S]*restartNetifdOnInstall:\s*true/, 'IKEv2 package install must restart netifd');
assert.match(apps, /xl2tpd.*ppp-mod-pppol2tp.*strongswan-default/, 'L2TP/IPsec catalog must install xl2tpd, PPP and strongSwan');
assert.match(apps, /strongswan-mod-eap-mschapv2.*xfrm.*luci-proto-xfrm/, 'IKEv2 catalog must install EAP and XFRM support');
assert.match(wifi, /proto === 'l2tp' \|\| proto === 'xfrm'/, 'Access & Routing Policy must recognize IPsec interfaces');
assert.ok(acl.read.uci.includes('ipsec'), 'IPsec UCI reads must be covered by the rpcd ACL');
assert.ok(acl.write.uci.includes('ipsec'), 'IPsec UCI writes must be covered by the rpcd ACL');
assert.ok(acl.write.file['/usr/libexec/freenetic-ipsec-restart'], 'IPsec restart helper must be covered by the rpcd ACL');

console.log('IPsec connection contract: ok');
