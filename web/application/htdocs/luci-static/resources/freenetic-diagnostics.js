'use strict';
'require baseclass';

function isDefaultRoute(route) {
	return !!route && route.mask === 0 &&
		(route.target === '0.0.0.0' || route.target === '::');
}

function addressList(iface) {
	return [ ...(iface['ipv4-address'] || []), ...(iface['ipv6-address'] || []) ]
		.filter(item => item && item.address)
		.map(item => item.address + (item.mask != null ? '/' + item.mask : ''));
}

function summarizeInterface(iface) {
	const defaultRoute = (iface.route || []).find(isDefaultRoute);
	return {
		name: iface.interface || '–',
		up: !!iface.up,
		protocol: iface.proto || '–',
		device: iface.l3_device || iface.device || '–',
		addresses: addressList(iface),
		gateway: defaultRoute && defaultRoute.nexthop || '',
		dns: (iface['dns-server'] || []).filter(Boolean)
	};
}

function summarizeInterfaces(reply) {
	const interfaces = Array.isArray(reply && reply.interface) ? reply.interface : [];
	let uplinks = interfaces.filter(iface => (iface.route || []).some(isDefaultRoute));

	/* An offline WAN has no default route but is still useful diagnostic
	 * information. Only use this fallback when no routed uplink exists. */
	if (!uplinks.length)
		uplinks = interfaces.filter(iface => /^wan(?:\d+|_\w+)?$/.test(iface.interface || ''));

	return uplinks.map(summarizeInterface);
}

function normalizeTarget(value) {
	const target = String(value || '').trim();
	if (!target || target.length > 253 || target[0] === '-' || !/^[A-Za-z0-9._:-]+$/.test(target))
		return null;
	return target;
}

return baseclass.extend({
	summarizeInterfaces: summarizeInterfaces,
	normalizeTarget: normalizeTarget
});
