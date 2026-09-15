'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const releases = require(path.join(root, 'app', 'release-codenames.js'));

const expected = {
	'0.1': 'Misery',
	'0.2': 'Onyx'
};

assert.deepEqual(releases.RELEASE_CODENAMES, expected);
assert.equal(releases.releaseTitle('v0.1.0'), 'Freenetic 0.1.0 — Misery');
assert.equal(releases.releaseTitle('v0.2.6'), 'Freenetic 0.2.6 — Onyx');
assert.equal(releases.releaseTitle('v0.2.7'), 'Freenetic 0.2.7 — Onyx Hotfix');
assert.equal(releases.releaseTitle('v0.2.0-alpha.3'), 'Freenetic 0.2.0-alpha.3 — Onyx');
assert.equal(releases.releaseTitle('v0.3.0-alpha.1'), 'Freenetic 0.3.0a-1');
assert.equal(releases.releaseTitle('v0.3.0-alpha.2'), 'Freenetic 0.3.0a-2');
assert.equal(releases.releaseTitle('v0.3.0-alpha.3'), 'Freenetic 0.3.0a-3');
assert.throws(() => releases.releaseTitle('0.2.6'), /invalid release tag/);
assert.throws(() => releases.releaseTitle('v0.3.0'), /no codename configured/);

console.log('Release codename contract: ok');
