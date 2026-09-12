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

function ipv4NetworkCidr(address, prefix) {
	const octets = String(address || '').split('.').map(Number);
	prefix = Number(prefix);
	if (octets.length !== 4 || octets.some(value => !Number.isInteger(value) || value < 0 || value > 255) ||
	    !Number.isInteger(prefix) || prefix < 0 || prefix > 32)
		return null;

	const value = ((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>> 0;
	const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
	const network = (value & mask) >>> 0;
	return [ network >>> 24, (network >>> 16) & 255, (network >>> 8) & 255, network & 255 ].join('.') + '/' + prefix;
}

function parseIpv6Words(address) {
	address = String(address || '').split('%')[0].toLowerCase();
	if (!address || (address.match(/::/g) || []).length > 1 || /[^0-9a-f:]/.test(address))
		return null;

	const halves = address.split('::');
	const parseHalf = value => {
		if (!value)
			return [];
		const groups = value.split(':');
		if (groups.some(group => !/^[0-9a-f]{1,4}$/.test(group)))
			return null;
		return groups.map(group => parseInt(group, 16));
	};
	const left = parseHalf(halves[0]);
	const right = parseHalf(halves[1] || '');
	if (!left || !right)
		return null;

	const missing = 8 - left.length - right.length;
	if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1))
		return null;
	return left.concat(Array(missing).fill(0), right);
}

function formatIpv6Words(words) {
	let bestStart = -1;
	let bestLength = 0;
	for (let start = 0; start < words.length;) {
		if (words[start] !== 0) {
			start++;
			continue;
		}
		let end = start;
		while (end < words.length && words[end] === 0)
			end++;
		if (end - start > bestLength) {
			bestStart = start;
			bestLength = end - start;
		}
		start = end;
	}

	const parts = words.map(word => word.toString(16));
	if (bestLength < 2)
		return parts.join(':');
	return parts.slice(0, bestStart).join(':') + '::' + parts.slice(bestStart + bestLength).join(':');
}

function ipv6NetworkCidr(address, prefix) {
	const words = parseIpv6Words(address);
	prefix = Number(prefix);
	if (!words || !Number.isInteger(prefix) || prefix < 0 || prefix > 128)
		return null;

	for (let index = 0; index < words.length; index++) {
		const keep = prefix - index * 16;
		if (keep <= 0)
			words[index] = 0;
		else if (keep < 16)
			words[index] &= (0xffff << (16 - keep)) & 0xffff;
	}
	return formatIpv6Words(words) + '/' + prefix;
}

function connectedRouteTarget(address) {
	if (!address || address.address == null || address.mask == null)
		return null;
	return String(address.address).indexOf(':') !== -1
		? ipv6NetworkCidr(address.address, address.mask)
		: ipv4NetworkCidr(address.address, address.mask);
}

return baseclass.extend({
	connectedRouteTarget,

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
