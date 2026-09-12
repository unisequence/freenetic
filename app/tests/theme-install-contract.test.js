'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const defaults = path.join(root, 'app', 'luci-theme-freenetic', 'root', 'etc',
	'uci-defaults', '30_luci-theme-freenetic');
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'freenetic-theme-install-'));
const mockUci = path.join(temporary, 'uci');
const mockScript = [
	'#!/bin/sh',
	'[ "$1" = -q ] && shift',
	'case "$1" in',
	'\tget)',
	'\t\tline=$(grep -F "$2=" "$STATE_FILE" 2>/dev/null | tail -n 1)',
	'\t\t[ -n "$line" ] || exit 1',
	'\t\tprintf "%s\\n" "${line#*=}"',
	'\t\t;;',
	'\tset)',
	'\t\tprintf "%s\\n" "$2" >> "$STATE_FILE"',
	'\t\t;;',
	'\tcommit)',
	'\t\tprintf "%s\\n" "$2" >> "$COMMIT_FILE"',
	'\t\t;;',
	'\t*)',
	'\t\texit 2',
	'\t\t;;',
	'esac',
	''
].join('\n');
fs.writeFileSync(mockUci, mockScript);
fs.chmodSync(mockUci, 0o755);

function install(initial, upgrade) {
	const nonce = String(Math.random()).slice(2);
	const stateFile = path.join(temporary, 'state-' + nonce);
	const commitFile = path.join(temporary, 'commit-' + nonce);
	fs.writeFileSync(stateFile, Object.entries(initial).map(entry => entry.join('=')).join('\n') + '\n');
	fs.writeFileSync(commitFile, '');
	const env = {
		...process.env,
		PATH: temporary + path.delimiter + process.env.PATH,
		STATE_FILE: stateFile,
		COMMIT_FILE: commitFile
	};
	if (upgrade)
		env.PKG_UPGRADE = '1';
	const result = childProcess.spawnSync('/bin/sh', [ defaults ], { encoding: 'utf8', env });
	assert.equal(result.status, 0, result.stderr);

	const state = {};
	for (const line of fs.readFileSync(stateFile, 'utf8').trim().split('\n')) {
		const separator = line.indexOf('=');
		if (separator !== -1)
			state[line.slice(0, separator)] = line.slice(separator + 1);
	}
	return { state, committed: fs.readFileSync(commitFile, 'utf8').trim() };
}

try {
	const fresh = install({ 'luci.main.mediaurlbase': '/luci-static/bootstrap' }, false);
	assert.equal(fresh.state['luci.themes.Freenetic'], '/luci-static/freenetic');
	assert.equal(fresh.state['luci.main.mediaurlbase'], '/luci-static/freenetic',
		'a fresh install must activate Freenetic instead of relying on LuCI fallback');
	assert.equal(fresh.committed, 'luci');

	const upgrade = install({ 'luci.main.mediaurlbase': '/luci-static/bootstrap' }, true);
	assert.equal(upgrade.state['luci.themes.Freenetic'], '/luci-static/freenetic');
	assert.equal(upgrade.state['luci.main.mediaurlbase'], '/luci-static/bootstrap',
		'an upgrade must preserve the selected theme');

	const existing = install({
		'luci.main.mediaurlbase': '/luci-static/bootstrap',
		'luci.themes.Freenetic': '/luci-static/freenetic'
	}, false);
	assert.equal(existing.state['luci.main.mediaurlbase'], '/luci-static/bootstrap',
		'reinstalling an already registered theme must preserve the user choice');
	assert.equal(existing.committed, '');
}
finally {
	fs.rmSync(temporary, { recursive: true, force: true });
}

console.log('theme install activation contract: ok');
