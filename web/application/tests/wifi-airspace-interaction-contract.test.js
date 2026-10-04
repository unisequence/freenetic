'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..', '..');
const source = fs.readFileSync(path.join(root, 'web', 'application', 'htdocs',
	'luci-static', 'resources', 'view', 'status', 'freenetic-wifimonitor.js'), 'utf8');

assert.match(source, /fn-airspace-apply[\s\S]*?disabled: !recommendation/,
	'the apply button must only be disabled when no channel can be recommended');
assert.match(source, /confirmRecommendedChannel\([\s\S]*?Wi-Fi clients may briefly disconnect/,
	'channel changes must warn that Wi-Fi may disconnect before applying');
assert.match(source, /uci\.set\('wireless', radio\.name, 'channel', channel\)[\s\S]*?uci\.save\(\)\.then\(\(\) => applyChanges\(60\)\)/,
	'applying a recommendation must save the radio channel and use rollback-protected UCI apply');
assert.doesNotMatch(source, /Channel changes are disabled in this preview/,
	'the channel button must not remain a disabled preview control');

console.log('Wi-Fi airspace interaction contract: ok');
