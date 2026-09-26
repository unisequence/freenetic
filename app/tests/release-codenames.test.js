'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const releases = require(path.join(root, 'app', 'release-codenames.js'));

const expected = {
	'0.1': 'Misery',
	'0.2': 'Onyx',
	'0.3': 'Noxium',
	'0.4': 'Oxidice'
};

assert.deepEqual(releases.RELEASE_CODENAMES, expected);
assert.equal(releases.releaseTitle('v0.1.0'), 'Freenetic 0.1.0 — Misery');
assert.equal(releases.releaseTitle('v0.2.6'), 'Freenetic 0.2.6 — Onyx');
assert.equal(releases.releaseTitle('v0.2.7'), 'Freenetic 0.2.7 — Onyx Hotfix');
assert.equal(releases.releaseTitle('v0.2.0-alpha.3'), 'Freenetic 0.2.0-alpha.3 — Onyx');
assert.equal(releases.releaseTitle('v0.3.0-alpha.1'), 'Freenetic 0.3.0a-1');
assert.equal(releases.releaseTitle('v0.3.0-alpha.2'), 'Freenetic 0.3.0a-2');
assert.equal(releases.releaseTitle('v0.3.0-alpha.3'), 'Freenetic 0.3.0a-3');
assert.equal(releases.releaseTitle('v0.3.0-alpha.4'), 'Freenetic 0.3.0a-4');
assert.equal(releases.releaseTitle('v0.3.0-beta.1'), 'Freenetic 0.3.0b-1');
assert.equal(releases.releaseTitle('v0.3.0-rc.1'), 'Freenetic 0.3.0rc-1');
assert.equal(releases.releaseTitle('v0.3.0'), 'Introducing Freenetic 0.3.0 Noxium');
assert.equal(releases.releaseTitle('v0.4.0-alpha.1'), 'Freenetic 0.4.0a-1');
assert.equal(releases.releaseTitle('v0.4.0-alpha.6'), 'Freenetic 0.4.0a-6');
assert.equal(releases.releaseTitle('v0.4.0-beta.1'), 'Freenetic 0.4.0b-1');
assert.equal(releases.releaseTitle('v0.4.0-beta.2'), 'Freenetic 0.4.0b-2');
assert.equal(releases.releaseTitle('v0.4.0'), 'Introducing Freenetic 0.4.0 Oxidice');
assert.equal(releases.releaseTitle('v0.4.1'), 'Freenetic 0.4.1 — Oxidice');
assert.throws(() => releases.releaseTitle('v0.4.0-alpha1'), /unsupported prerelease version/,
	'nonstandard alpha tags must not bypass concealed prerelease naming');
assert.equal(releases.concealedAlphaTitle('0.3.0-beta.1'), null);
assert.throws(() => releases.releaseTitle('0.2.6'), /invalid release tag/);

console.log('Release codename contract: ok');
