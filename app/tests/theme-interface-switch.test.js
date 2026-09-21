'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const settings = fs.readFileSync(path.join(root, 'web', 'theme', 'htdocs',
	'luci-static', 'resources', 'settings-freenetic.js'), 'utf8');
const login = fs.readFileSync(path.join(root, 'web', 'theme', 'ucode', 'template',
	'themes', 'freenetic', 'sysauth.ut'), 'utf8');

assert.match(settings, /commitUci = rpc\.declare\([\s\S]*object: 'uci'[\s\S]*method: 'commit'/,
	'the theme settings drawer must have a direct luci commit RPC');
assert.match(settings, /uci\.save\(\)\.then\(\(\) => commitUci\('luci'\)\)/,
	'interface selection must commit luci.main.mediaurlbase directly');
assert.doesNotMatch(settings, /uci\.save\(\)\.then\(\(\) => uci\.apply\(\)\)/,
	'interface selection must not leave a rollback timer');
assert.match(settings, /freenetic-clear-luci-cache/,
	'interface selection must clear the cached menu after changing theme');
assert.match(login, /uci\.set\('luci', 'main', 'mediaurlbase', targetinterface\)[\s\S]*uci\.commit\('luci'\)/,
	'the login escape hatch must persist the selected interface');

console.log('theme interface switch contract: ok');
