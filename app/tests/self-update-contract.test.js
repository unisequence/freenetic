'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const helperPath = path.join(root, 'app', 'luci-app-freenetic', 'root', 'usr', 'libexec',
	'freenetic-self-update');
const helper = fs.readFileSync(helperPath, 'utf8');
const acl = JSON.parse(fs.readFileSync(path.join(root, 'app', 'luci-app-freenetic', 'root',
	'usr', 'share', 'rpcd', 'acl.d', 'luci-app-freenetic.json'), 'utf8'))['luci-app-freenetic'];
const preflight = fs.readFileSync(path.join(root, 'app', 'freenetic-preflight.mk'), 'utf8');
const appMakefile = fs.readFileSync(path.join(root, 'app', 'luci-app-freenetic', 'Makefile'), 'utf8');
const themeMakefile = fs.readFileSync(path.join(root, 'app', 'luci-theme-freenetic', 'Makefile'), 'utf8');

assert.ok(fs.statSync(helperPath).mode & 0o111, 'self-update helper must be executable');
assert.ok(helper.startsWith('#!/bin/sh'), 'self-update helper must be POSIX sh');
assert.doesNotMatch(helper, /^set -u$/m,
	'OpenWrt 24.10 jshn expands optional variables and is incompatible with nounset');
assert.match(helper, /RAW_BASE_URL=https:\/\/raw\.githubusercontent\.com\/unisequence\/freenetic/,
	'installer source repository must be fixed router-side');
assert.match(helper, /RELEASES_BASE_URL=https:\/\/github\.com\/unisequence\/freenetic\/releases\/download/,
	'release asset repository must be fixed router-side');
assert.match(helper, /\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+/,
	'release tags must be constrained to Freenetic semver tags');
assert.match(helper, /mktemp -d \/tmp\/freenetic-self-update\.XXXXXX/,
	'updates must use an isolated staging directory');
assert.match(helper, /cp "\$0" "\$stage_dir\/runner"/,
	'the running updater must survive replacement of its installed package');
assert.match(helper, /grep -Fqx "RELEASE_TAG=\\"\$tag\\""/,
	'downloaded installers must declare the selected release tag exactly');
assert.match(helper, /MAX_INSTALLER_BYTES=262144/,
	'downloaded installer size must be bounded');
assert.match(helper, /sh -n "\$installer"/,
	'downloaded installers must pass a shell syntax check');
assert.match(helper, /FREENETIC_RELEASE_BASE_URL="\$RELEASES_BASE_URL\/\$tag" sh "\$installer"/,
	'asset downloads must stay pinned to the selected GitHub release');
assert.match(helper, /uci -q set "freenetic\.updates\.installed_release=\$tag"/,
	'a successful UI update must persist its release tag');

assert.deepEqual(acl.read.file['/usr/libexec/freenetic-self-update status'], [ 'exec' ]);
assert.deepEqual(acl.write.file['/usr/libexec/freenetic-self-update install *'], [ 'exec' ]);
assert.match(preflight, /FREENETIC_VERSION_PATHS:=.*app\/luci-app-freenetic.*app\/luci-theme-freenetic.*web\/application.*web\/theme/,
	'theme and application versions must cover both source trees');
assert.match(appMakefile, /-- \$\(FREENETIC_VERSION_PATHS\)/,
	'application package must use the shared release revision');
assert.match(themeMakefile, /-- \$\(FREENETIC_VERSION_PATHS\)/,
	'theme package must use the shared release revision');

console.log('Freenetic self-update contract: ok');
