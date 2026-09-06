'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const resources = path.join(root, 'web', 'application', 'htdocs', 'luci-static', 'resources');
const aclPath = path.join(root, 'app', 'luci-app-freenetic', 'root', 'usr', 'share',
	'rpcd', 'acl.d', 'luci-app-freenetic.json');
const acl = JSON.parse(fs.readFileSync(aclPath, 'utf8'))['luci-app-freenetic'];

function walk(directory) {
	return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
		const item = path.join(directory, entry.name);
		return entry.isDirectory() ? walk(item) : [ item ];
	});
}

const ubusGrants = {};
for (const access of [ acl.read, acl.write ]) {
	for (const [object, methods] of Object.entries(access.ubus || {})) {
		ubusGrants[object] ||= new Set();
		methods.forEach(method => ubusGrants[object].add(method));
	}
}

const fileGrants = Object.keys(acl.read.file || {}).concat(Object.keys(acl.write.file || {}));
const missingUbus = new Set();
const missingFiles = new Set();

for (const filename of walk(resources).filter(file => file.endsWith('.js'))) {
	const source = fs.readFileSync(filename, 'utf8');
	let match;
	const ubusPattern = /ubusCall\('([^']+)',\s*'([^']+)'/g;
	const filePattern = /fs\.(?:read|exec|exec_direct)\('([^']+)'/g;

	while ((match = ubusPattern.exec(source)) != null) {
		const [, object, method] = match;
		/* rpcd's UCI ACL is expressed through read.uci/write.uci instead of
		 * the generic ubus method map. */
		if (object !== 'uci' && !ubusGrants[object]?.has(method))
			missingUbus.add(`${object}.${method}`);
	}

	while ((match = filePattern.exec(source)) != null) {
		const executable = match[1];
		if (!fileGrants.some(grant => grant === executable || grant.startsWith(executable + ' ')))
			missingFiles.add(executable);
	}
}

assert.deepEqual([ ...missingUbus ].sort(), [], 'literal ubus calls must be covered by rpcd ACL');
assert.deepEqual([ ...missingFiles ].sort(), [], 'literal file operations must be covered by rpcd ACL');
assert.ok(acl.read.uci.includes('luci'), 'theme detection requires read access to luci config');
assert.ok(acl.write.uci.includes('luci'), 'theme settings require write access to luci config');

console.log('rpcd ACL contract: ok');
