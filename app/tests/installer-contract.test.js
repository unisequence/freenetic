'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const installer = fs.readFileSync(path.join(__dirname, '../../install.sh'), 'utf8');

assert(installer.startsWith('#!/bin/sh'), 'installer must be POSIX sh');
for (const marker of [
	"RELEASE_TAG=\"v0.2.0\"",
	"mediatek/filogic",
	"ramips/mt7621",
	"aarch64_cortex-a53",
	"mipsel_24kc",
	"luci-theme-freenetic-${ASSET_VERSION}-${target_suffix}.apk",
	"luci-app-freenetic-${ASSET_VERSION}-${target_suffix}.apk",
	"luci-i18n-theme-freenetic-ru-${ASSET_VERSION}-${target_suffix}.apk",
	"luci-i18n-freenetic-ru-${ASSET_VERSION}-${target_suffix}.apk",
	"FNC_BIN=\"fnc-${ASSET_VERSION}-${target_suffix}\"",
	"sha256sum",
	"apk add --allow-untrusted",
	"/usr/bin/fnc",
	"fnc show version"
]) {
	assert(installer.includes(marker), `installer is missing: ${marker}`);
}

const checksumCount = (installer.match(/download_checked /g) || []).length;
assert.strictEqual(checksumCount, 5, 'installer must verify exactly five assets');

console.log('installer contract: ok');
