'use strict';
'require baseclass';
'require uci';

/* Guest clients must not inherit access to every service listening on the
 * router. Keep the zone input policy closed and allow only the two services
 * required to obtain an IPv4 lease and resolve names. These named sections
 * are owned by Freenetic so provisioning is idempotent and deletion can be
 * conservative around user-managed firewall rules. */
const GUEST_INPUT_RULES = [
	{
		section: 'freenetic_guest_dhcp',
		values: {
			name: 'Allow guest DHCP',
			src: 'guest',
			proto: 'udp',
			dest_port: '67',
			target: 'ACCEPT',
			family: 'ipv4',
			freenetic_managed: '1'
		}
	},
	{
		section: 'freenetic_guest_dns',
		values: {
			name: 'Allow guest DNS',
			src: 'guest',
			proto: [ 'tcp', 'udp' ],
			dest_port: '53',
			target: 'ACCEPT',
			family: 'ipv4',
			freenetic_managed: '1'
		}
	}
];

function ensureRule(rule) {
	const existing = uci.get('firewall', rule.section);

	if (existing == null)
		uci.add('firewall', 'rule', rule.section);
	else if (existing['.type'] !== 'rule')
		throw new Error('firewall.%s exists but is not a rule'.format(rule.section));

	Object.keys(rule.values).forEach(option =>
		uci.set('firewall', rule.section, option, rule.values[option]));
}

return baseclass.extend({
	ensureGuestFirewall() {
		const zone = uci.get('firewall', 'guest');

		if (zone == null || zone['.type'] !== 'zone')
			throw new Error('firewall.guest zone must exist before it is secured');

		uci.set('firewall', 'guest', 'input', 'REJECT');
		GUEST_INPUT_RULES.forEach(ensureRule);
	},

	removeGuestFirewallRules() {
		GUEST_INPUT_RULES.forEach(rule => {
			if (uci.get('firewall', rule.section, 'freenetic_managed') === '1')
				uci.remove('firewall', rule.section);
		});
	}
});
