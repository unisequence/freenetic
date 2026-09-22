'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const navigation = fs.readFileSync(path.join(root, 'web', 'theme', 'htdocs',
	'luci-static', 'resources', 'freenetic-navigation.js'), 'utf8');

assert.match(navigation, /freenetic-clear-luci-cache/,
	'Freenetic navigation must be able to clear a stale resolved menu cache');
assert.match(navigation, /sessionStorage\.getItem\(MENU_CACHE_RECOVERY_KEY\)/,
	'menu cache recovery must be guarded against reload loops');
assert.match(navigation, /satisfied === false/,
	'menu cache recovery must detect failed depends.uci results');
assert.match(navigation, /admin', 'network', 'internet/,
	'menu cache recovery must inspect a Freenetic network entry');
assert.match(navigation, /location\.reload\(\)/,
	'menu cache recovery must reload after clearing the cache');

console.log('menu cache recovery contract: ok');
