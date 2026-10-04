'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const resource = relative => fs.readFileSync(path.join(root, 'web', 'application',
	'htdocs', 'luci-static', 'resources', relative), 'utf8');

const wan = resource('view/network/freenetic-wan.js');
const networks = resource('view/network/freenetic-mynetworks.js');
const apps = resource('view/system/freenetic-apps.js');
const system = resource('view/system/freenetic-system.js');
const clients = resource('view/status/freenetic-clients.js');
const routing = resource('view/network/freenetic-routing.js');
const ddns = resource('view/network/freenetic-ddns.js');
const otherConnections = resource('view/network/freenetic-other-connections.js');
const wifiAcl = resource('view/network/freenetic-wifi-acl.js');
const wifiMonitor = resource('view/status/freenetic-wifimonitor.js');
const multiwan = resource('view/network/freenetic-multiwan.js');
const zapret2 = resource('view/network/freenetic-zapret2.js');
const zapret2Config = resource('view/zapret2/v4r30/config.js');

assert.match(wan, /Existing protocol: %s \(preserved\)/,
	'WAN must expose and preserve protocols outside its compact editor');
assert.match(wan, /if \(!editableProtocol\)\s+return uci\.save\(\)/,
	'WAN must not rewrite protocol-specific fields for unknown protocols');
assert.match(networks, /card\.adv\.channelSelect\.value !== original\.channel/,
	'radio-wide settings must only be written after an explicit change');
assert.match(networks, /const currentHtmode = configuredHtmode \|\| defaultHtmodeForBand\(radio\.band, htmodes\)/,
	'unset channel width must receive a band-specific hardware-backed default');
assert.match(networks, /\[ 'HE80', 'VHT80',[\s\S]*?\[ 'HE20', 'HT20'/,
	'5 GHz and 2.4 GHz must not share the same default channel-width policy');
assert.match(networks, /original: \{ channel: currentChannel, htmode: configuredHtmode/,
	'a generated channel-width default must be persisted on Save');
assert.match(networks, /writeOptionalRadioSetting\(card\.radioName, 'txpower'/,
	'transmit power Automatic must remove an existing UCI override');
assert.match(networks, /const currentTxpower = radio\.txpower != null \? String\(radio\.txpower\) : ''/,
	'live transmit power must not masquerade as an explicit UCI override');
assert.match(networks, /Channel settings remain independent/,
	'the credentials link must explicitly keep radio settings independent');
assert.match(networks, /uci\.set\('network', ifaceName, 'proto', 'none'\)/,
	'the IPv4 switch must actually disable IPv4 on the home segment');
assert.match(networks, /freenetic-avahi-reflector/,
	'the mDNS switch must have a real backend');
assert.match(apps, /removablePackages\(item\)/,
	'application removal must account for shared packages');
assert.match(apps, /operationPackages\.length && item\.restartNetifdOnInstall/,
	'network protocol removals must restart netifd too');
assert.match(apps, /requestedAppId\(\)[\s\S]*?searchParams\.get\('focus'\)/,
	'applications must accept a safe focused-card request');
assert.match(apps, /fn-apps-row-focused/,
	'applications must visibly identify the requested package card');
assert.match(apps, /id: 'nfqws2',[\s\S]*?packages: \[ 'zapret2', 'luci-app-zapret2' \]/,
	'Applications must retain the upstream Zapret2 runtime as an install option');
assert.match(apps, /configurePath: \[ 'admin', 'network', 'zapret2' \]/,
	'Applications must configure either Zapret2 runtime through the Freenetic entry page');
assert.doesNotMatch(apps, /id: 'zapret',[\s\S]*?packages: \[ 'zapret' \]/,
	'Applications must not present legacy Zapret as Zapret2');
assert.match(multiwan, /applicationsUrl\('mwan3'\)/,
	'the missing Multi-WAN package notice must target its catalog card');
assert.match(zapret2, /applicationsUrl\(\)/,
	'the missing Zapret2 package notice must target its catalog card');
assert.match(zapret2, /zapret2\.v4r30\.rpc as api[\s\S]*fn-zapret-home-links/,
	'the Zapret2 entry point must render the Freenetic status page before native editors');
assert.match(zapret2Config, /api\.validate\(model\.candidate\(\)\)/,
	'the Zapret2 settings page must validate the complete candidate before saving');
assert.match(zapret2Config, /api\.service\('reload'\)/,
	'the Zapret2 settings page must apply validated settings through the native service API');
assert.match(ddns, /applicationsUrl\('ddns'\)/,
	'the missing DDNS package notice must target its catalog card');
assert.ok(otherConnections.indexOf("'require freenetic-connections-ipsec as ipsecView';") <
	otherConnections.indexOf('function applicationsUrl(appId)'),
	'LuCI module directives must remain before executable helper declarations');
for (const id of [ 'wireguard', 'openvpn' ])
	assert.match(otherConnections, new RegExp(`applicationAction\\('${id}'\\)`),
		`the missing ${id} package notice must target its catalog card`);
assert.match(otherConnections, /openL2tpForm\(null\), 'l2tp_ipsec'/,
	'the missing L2TP package notice must target its catalog card');
assert.match(otherConnections, /openIkev2Form\(null\), 'ikev2_ipsec'/,
	'the missing IKEv2 package notice must target its catalog card');
assert.match(wifiAcl, /applications'\) \+ '\?focus=pbr'/,
	'the missing policy-routing package notice must target its catalog card');
assert.match(multiwan, /class: 'fn-multiwan-gate-content', inert: ''/,
	'unavailable Multi-WAN controls must not remain interactive');
const flashHandler = system.slice(system.indexOf('\tflashUploadedFirmware()'), system.indexOf('\thandleSysupgrade()'));
assert.match(flashHandler, /const reconnectTimer = window\.setTimeout\(startReconnect, 1500\)/,
	'a successful sysupgrade that drops rpcd must still start reconnect polling');
assert.match(flashHandler, /result && result\.code !== 0[\s\S]*?clearTimeout\(reconnectTimer\)[\s\S]*?showFailure/,
	'a local sysupgrade failure must cancel reconnect polling and remain visible in the modal');
assert.match(flashHandler, /if \(error && \/network\|connection\|request\/[\s\S]*?startReconnect\(\)[\s\S]*?clearTimeout\(reconnectTimer\)[\s\S]*?showFailure/,
	'only an expected connection loss may transition from flashing to reconnect polling');
assert.match(clients, /this\.blockClient\(row\.mac, zone\)/,
	'client blocking must pass the detected firewall zone');
assert.match(clients, /uci\.set\('firewall', section, 'src', sourceZone\)/,
	'client blocking must preserve every detected firewall zone');
assert.doesNotMatch(clients, /sourceZone === 'guest'/,
	'dedicated Ethernet segments must not be collapsed into the LAN zone');
assert.match(routing, /section\.disabled !== '1'/,
	'route automatic state must use netifd disabled semantics');
assert.match(routing, /uci\.unset\('dhcp', dns\.section, 'server'\)/,
	'deleting the last DNS route must unset the UCI list');
assert.match(ddns, /result\.code !== 0/,
	'DDNS commands must reject non-zero exit codes');
assert.match(wifiMonitor, /ubusCall\('iwinfo', 'scan'/,
	'the Wi-Fi air map must use the router scan data');
assert.match(wifiMonitor, /confirmRecommendedChannel\([\s\S]*?applyRecommendedChannel\(/,
	'the Wi-Fi air map must apply its recommended channel after confirmation');
assert.match(wifiMonitor, /uci\.set\('wireless', radio\.name, 'channel', channel\)[\s\S]*?applyChanges\(60\)/,
	'recommended channel changes must be saved through rollback-protected UCI apply');
assert.match(wifiMonitor, /class: 'fn-wifi-band-loading'/,
	'band changes must hide stale Wi-Fi data behind a loading state');
assert.match(wifiMonitor, /Promise\.all\(\[ update, animationFloor \]\)/,
	'band loading must wait for both fresh data and the transition floor');
assert.match(wifiMonitor, /const placedLabels = \[\]/,
	'air-map SSID labels must use collision-aware placement');
assert.doesNotMatch(wifiMonitor, /frequencies\.length < 18 \|\| i % 2/,
	'the 5 GHz axis must not hide every other channel label');
assert.match(wifiMonitor, /const broadcasting = currentChannel > 0 && currentFrequency > 0/,
	'the air map must distinguish configured radios from radios that are actually broadcasting');
assert.match(wifiMonitor, /Configured: %s, %d MHz/,
	'an inactive radio must show its configured channel and width instead of invented live values');
assert.match(wifiMonitor, /ownChannel \? channelFrequency\(ownChannel, radio\.band\) : 0/,
	'the air map must not draw an inactive radio from its configured channel');

const helper = path.join(root, 'app', 'luci-app-freenetic', 'root', 'usr', 'libexec',
	'freenetic-avahi-reflector');
const acl = JSON.parse(fs.readFileSync(path.join(root, 'app', 'luci-app-freenetic', 'root',
	'usr', 'share', 'rpcd', 'acl.d', 'luci-app-freenetic.json'), 'utf8'))['luci-app-freenetic'];
assert.ok(fs.statSync(helper).mode & 0o111, 'mDNS reflector helper must be executable');
assert.ok(acl.read.file['/usr/libexec/freenetic-avahi-reflector status']);
assert.ok(acl.write.file['/usr/libexec/freenetic-avahi-reflector enable']);
assert.ok(acl.write.file['/usr/libexec/freenetic-avahi-reflector disable']);
assert.ok(acl.read.ubus.iwinfo.includes('scan'), 'Wi-Fi scans must be granted read-only');

console.log('audit regression contracts: ok');
