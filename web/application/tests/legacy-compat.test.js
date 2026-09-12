'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..', '..');
const resources = path.join(root, 'web', 'application', 'htdocs', 'luci-static', 'resources');
const read = relative => fs.readFileSync(path.join(resources, relative), 'utf8');

const networkSource = read('freenetic-network.js');
const networkHelper = new Function('baseclass', 'uci', networkSource)(
	{ extend: value => value },
	{}
);
assert.equal(networkHelper.connectedRouteTarget({ address: '192.168.1.173', mask: 24 }), '192.168.1.0/24');
assert.equal(networkHelper.connectedRouteTarget({ address: '10.20.30.40', mask: 0 }), '0.0.0.0/0');
assert.equal(networkHelper.connectedRouteTarget({ address: '2001:db8:abcd:12ff::7', mask: 56 }), '2001:db8:abcd:1200::/56');
assert.equal(networkHelper.connectedRouteTarget({ address: 'fe80::1234', mask: 64 }), 'fe80::/64');
assert.equal(networkHelper.connectedRouteTarget({ address: 'not-an-address', mask: 24 }), null);

const firewallSource = read('view/network/freenetic-firewall.js');
const firewallPrefix = firewallSource.slice(0, firewallSource.indexOf('return view.extend'));
const protocols = new Function('rpc', 'uiHelper', '_', firewallPrefix +
	'\nreturn { protoLabel, protoValue, protocolChoice };')(
	{ call() {} },
	{ empty() {}, notify() {}, applyChanges() {} },
	value => value
);
assert.equal(protocols.protoLabel('igmp'), 'IGMP');
assert.equal(protocols.protoLabel([ 'esp' ]), 'ESP');
assert.equal(protocols.protoLabel([ 'udp', 'tcp' ]), 'TCP+UDP');
assert.equal(protocols.protocolChoice('sctp').value, 'sctp');
assert.ok(protocols.protocolChoice('sctp').options.some(option => option[0] === 'sctp'),
	'the editor must preserve protocols it does not know');

const myNetworks = read('view/network/freenetic-mynetworks.js');
const dashboard = read('view/status/freenetic-dashboard.js');
const clients = read('view/status/freenetic-clients.js');
assert.match(myNetworks, /iface\.disabled === '1' \|\| radio\.disabled === '1'/,
	'Home Network must show the effective radio and SSID state');
assert.match(myNetworks, /uci\.set\('wireless', card\.radioName, 'disabled', '0'\)/,
	'enabling an SSID must enable its radio');
assert.match(dashboard, /iface\.disabled === '1' \|\| radio\.disabled === '1'/,
	'Dashboard must show the effective radio and SSID state');
assert.match(dashboard, /toggleWifi\(iface\['\.name'\], iface\.device, toggle\)/,
	'Dashboard toggles must identify the parent radio');
assert.match(dashboard, /section: radioName, values: \{ disabled: '0' \}/,
	'Dashboard must enable the parent radio before enabling an SSID');
assert.match(dashboard, /renderClientsCard\(leases, wifiStations, activeArpMacs, dhcpConfig, guestInfo\)/,
	'Dashboard must render its client summary from data available on legacy LuCI');
assert.match(dashboard, /ubusCall\('iwinfo', 'devices'\)/,
	'Dashboard must discover AP interfaces without relying on network.wireless status');
assert.match(dashboard, /ubusCall\('iwinfo', 'assoclist', \{ device \}\)/,
	'Dashboard must read authoritative association data for every AP interface');
assert.match(dashboard, /Promise\.all\(\[ getDhcpLeases\(\), getWifiStations\(\), getActiveArpMacs\(\) \]\)/,
	'Dashboard client summary must refresh from legacy-compatible ubus objects');
assert.match(clients, /ubusCall\('iwinfo', 'devices'\)/,
	'Client List must discover AP interfaces without relying on network.wireless status');
assert.match(clients, /ubusCall\('iwinfo', 'assoclist', \{ device \}\)/,
	'Client List must read authoritative association data for every AP interface');
assert.match(clients, /live\.online \? _\('Wired'\) : _\('Not connected'\)/,
	'Client List must not treat a stale DHCP lease as a wired connection');

const wifiAcl = read('view/network/freenetic-wifi-acl.js');
const policyCard = wifiAcl.slice(
	wifiAcl.indexOf('\trenderPolicyCard(name)'),
	wifiAcl.indexOf('\trenderDevicePolicyCard(client)')
);
assert.doesNotMatch(policyCard, /:\s*null\s*,/,
	'network policy cards must not pass null children to LuCI E()');
const devicePolicyCard = wifiAcl.slice(
	wifiAcl.indexOf('\trenderDevicePolicyCard(client)'),
	wifiAcl.indexOf('\treorderManagedPbrPolicies()')
);
assert.match(devicePolicyCard, /\]\.filter\(Boolean\)\)/,
	'device policy cards must remove optional null children before calling LuCI E()');
const aclEntries = wifiAcl.slice(
	wifiAcl.indexOf('const renderEntries = () =>'),
	wifiAcl.indexOf('const addMac = (value, label)')
);
assert.match(aclEntries, /\]\.filter\(Boolean\)\)/,
	'Wi-Fi ACL entries must remove optional null children before calling LuCI E()');

const routing = read('view/network/freenetic-routing.js');
assert.match(routing, /networkHelper\.connectedRouteTarget\(address\)/,
	'active routes must include connected interface networks');

const css = fs.readFileSync(path.join(root, 'web', 'theme', 'htdocs', 'luci-static',
	'freenetic', 'cascade.css'), 'utf8');
assert.match(css, /body\[data-page="admin-system-package-manager"\] #maincontent #view > \.cbi-map-descr \+ \.controls[\s\S]*?@media \(max-width: 480px\)/,
	'the legacy package manager toolbar must reflow on tablets and phones');
assert.match(css, /\.fn-mac-value\s*\{[\s\S]*?white-space:\s*nowrap/,
	'MAC addresses must stay on one line');
assert.match(css, /\.fn-client-table > \.fn-table-row > \*\s*\{[\s\S]*?align-self:\s*stretch/,
	'client table cells must fill their shared grid row so separators stay aligned');
assert.match(css, /\.fn-dashboard-client-list\s*\{[\s\S]*?max-height:\s*560px/,
	'dashboard client rows must remain bounded on networks with many leases');

console.log('OpenWrt 24.10 compatibility contract: ok');
