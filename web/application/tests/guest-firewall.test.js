'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const modulePath = path.join(__dirname, '..', 'htdocs', 'luci-static',
	'resources', 'freenetic-network.js');
const source = fs.readFileSync(modulePath, 'utf8');

const state = {
	firewall: {
		guest: { '.type': 'zone', '.name': 'guest', input: 'ACCEPT' },
		unrelated_rule: { '.type': 'rule', '.name': 'unrelated_rule', target: 'DROP' }
	}
};
let addCount = 0;

const uci = {
	get(config, section, option) {
		const value = state[config] && state[config][section];
		if (value == null)
			return null;
		if (option == null)
			return value;
		return value[option] == null ? null : value[option];
	},
	add(config, type, section) {
		assert.equal(state[config][section], undefined, 'named UCI section must not be duplicated');
		state[config][section] = { '.type': type, '.name': section };
		addCount++;
		return section;
	},
	set(config, section, option, value) {
		assert.ok(state[config][section], 'UCI section must exist before set()');
		state[config][section][option] = value;
	},
	remove(config, section) {
		delete state[config][section];
	}
};

const networkHelper = new Function('baseclass', 'uci', source)(
	{ extend: value => value },
	uci
);

networkHelper.ensureGuestFirewall();

assert.equal(state.firewall.guest.input, 'REJECT');
assert.deepEqual(state.firewall.freenetic_guest_dhcp, {
	'.type': 'rule',
	'.name': 'freenetic_guest_dhcp',
	name: 'Allow guest DHCP',
	src: 'guest',
	proto: 'udp',
	dest_port: '67',
	target: 'ACCEPT',
	family: 'ipv4',
	freenetic_managed: '1'
});
assert.deepEqual(state.firewall.freenetic_guest_dns.proto, [ 'tcp', 'udp' ]);
assert.equal(state.firewall.freenetic_guest_dns.dest_port, '53');
assert.equal(state.firewall.freenetic_guest_dns.target, 'ACCEPT');

networkHelper.ensureGuestFirewall();
assert.equal(addCount, 2, 'repeated provisioning must reuse the two managed rules');

networkHelper.removeGuestFirewallRules();
assert.equal(state.firewall.freenetic_guest_dhcp, undefined);
assert.equal(state.firewall.freenetic_guest_dns, undefined);
assert.ok(state.firewall.unrelated_rule, 'unrelated firewall rules must be preserved');

for (const relativeView of [
	'view/status/freenetic-dashboard.js',
	'view/network/freenetic-mynetworks.js'
]) {
	const view = fs.readFileSync(path.join(path.dirname(modulePath), relativeView), 'utf8');
	assert.match(view, /networkHelper\.ensureGuestFirewall\(\)/,
		`${relativeView} must apply the shared guest firewall policy`);
}

console.log('guest firewall policy: ok');
