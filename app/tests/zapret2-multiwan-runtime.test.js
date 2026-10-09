'use strict';

const assert = require('node:assert/strict');
const childProcess = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const root = path.resolve(__dirname, '..', '..');
const source = fs.readFileSync(path.join(root,
	'app/freenetic-zapret2/files/usr/libexec/zapret2/compiler.sh'), 'utf8');
const collect = source.match(/^collect_freenetic_wans\(\) \{[\s\S]*?^\}/m)?.[0];
const resolve = source.match(/^resolve_network_file\(\) \{[\s\S]*?^\}/m)?.[0];
assert.ok(collect && resolve, 'WAN functions must be available for the runtime check');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'freenetic-zapret2-wan-'));
try {
	const script = `${collect}\n${resolve}\n
wan_file='${temp}/wan'
printf 'wan\\n' > "$wan_file"
safe_network() { case "$1" in ''|*[!A-Za-z0-9_.:-]*) return 1;; esac; }
add_warning() { printf '%s\\n' "$*" >&2; }
set_error() { printf '%s\\n' "$*" >&2; return 1; }
uci() {
  if [ "$1 $2 $3" = '-q show mwan3' ]; then
    printf '%s\\n' 'mwan3.backup=interface' 'mwan3.foreign=interface'
    return
  fi
  case "$3" in
    mwan3.backup.enabled|mwan3.foreign.enabled) printf '1\\n' ;;
    network.backup.freenetic_managed) printf '1\\n' ;;
    network.foreign.freenetic_managed) printf '0\\n' ;;
    network.backup.freenetic_scope) printf 'ethernet-port\\n' ;;
    network.wan|network.backup) printf 'interface\\n' ;;
    *) return 1 ;;
  esac
}
network_get_device() {
  case "$2" in
    backup) eval "$1=lo" ;;
    wan) eval "$1=missing_freenetic_test_device" ;;
    *) eval "$1=" ;;
  esac
}
collect_freenetic_wans
grep -Fxq backup "$wan_file" || exit 11
grep -Fxq foreign "$wan_file" && exit 12
resolve_network_file "$wan_file" WAN || exit 13
[ "$wan_devices" = lo ] || exit 14
printf 'bogus\\n' > "$wan_file"
resolve_network_file "$wan_file" WAN && exit 15
exit 0
`;
	const result = childProcess.spawnSync('/bin/sh', [ '-c', script ], { encoding: 'utf8' });
	assert.equal(result.status, 0, result.stderr);
}
finally {
	fs.rmSync(temp, { recursive: true, force: true });
}

console.log('Zapret2 Multi-WAN runtime: ok');
