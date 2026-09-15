'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..', '..');
const workflow = fs.readFileSync(path.join(root, '.github', 'workflows', 'quality.yml'), 'utf8');
const prepare = fs.readFileSync(path.join(root, 'app', 'prepare-release.js'), 'utf8');

assert.match(workflow, /name: OpenWrt 24\.10\.8 mediatek\/filogic \(IPK\)[\s\S]*?include_fnc: true/,
	'filogic IPK build must publish the legacy-ABI fnc artifact');
assert.match(workflow, /name: OpenWrt 25\.12\.5 ramips\/mt7621 \(APK \+ fnc\)/,
	'the matrix must build an MT7621 fnc binary for the APK ABI');
assert.match(workflow, /fnc-\$asset_version-\$ASSET_ARCH-\$PACKAGE_FORMAT/,
	'fnc assets must identify their package-manager ABI');
assert.match(workflow, /asset_arch: mipsel_24kc/, 'the MT7621 build must declare its release architecture');
assert.match(workflow, /release-assets/, 'target builds must prepare release assets');
assert.match(workflow, /-path '\*\/release-assets\/\*'/,
	'release publication must find assets below the downloaded artifact root');
assert.match(workflow, /actions\/download-artifact@v4/, 'release publication must consume the verified build artifacts');
assert.strictEqual((workflow.match(/fetch-depth: 0/g) || []).length, 3,
	'static, package and release jobs must use full history for source revision calculation');
assert.match(workflow, /publish-release:/, 'the workflow must publish tagged releases');
assert.match(workflow, /needs: \[static, openwrt-packages\]/,
	'release publication must wait for static checks as well as package builds');
assert.match(workflow, /startsWith\(github\.ref, 'refs\/tags\/v'\)/,
	'release publication must be restricted to version tags');
assert.match(workflow, /contents: write/, 'the release job must have explicit release permission');
assert.match(workflow, /--verify-tag/, 'release publication must verify the pushed tag');
assert.match(workflow, /app\/prepare-release\.js/, 'release publication must generate installer metadata from final assets');
assert.match(workflow, /\$GITHUB_WORKSPACE\/docs\/CHANGELOG\.md/,
	'release publication must read release notes from the documentation directory');
assert.match(workflow, /asset_count.*-eq 21/, 'the release must contain packages, binaries, APK key, installer and manifest');
assert.match(workflow, /freenetic-apk-release-key-\$asset_version\.pem/,
	'the APK package signing key must be published beside the signed packages');
assert.match(workflow, /xargs -0 -r -n1 "\$SDK_DIR\/staging_dir\/host\/bin\/apk"[\s\\]*\n[\s\\]*--allow-untrusted adbsign[\s\\]*\n[\s\\]*--reset-signatures --sign-key "\$SDK_DIR\/private-key\.pem"/,
	'the final APK payloads must be explicitly signed by the exported release key');
assert.match(workflow, /--keys-dir "\$key_dir" verify/,
	'the package matrix must verify APK signatures before publishing artifacts');
assert.match(workflow, /pre-0\.2\.6 dashboard can discover this release/,
	'the release must retain architecture-only fnc names for older dashboards');
assert.match(workflow, /--notes-file/, 'release publication must use the generated changelog notes');
assert.match(workflow, /node app\/release-codenames\.js "\$RELEASE_TAG"/,
	'release publication must derive its human title from the codename registry');
assert.match(workflow, /--title "\$release_title"/,
	'release publication must use the codename-bearing human title');
assert.match(workflow, /--latest=false/,
	'the retrospective 0.2.8 release must not replace the newer stable line as Latest');
assert.match(workflow, /\*-\*\) release_flags\+=\(--prerelease\)/,
	'pre-release tags must create GitHub prereleases rather than stable releases');
assert.match(workflow, /"\$\{release_flags\[@\]\}"/,
	'release publication must pass its pre-release classification to GitHub CLI');
assert.match(workflow, /Verify immutable annotated release tag/,
	'release publication must require an annotated tag pointing at the tested checkout');
assert.match(workflow, /git fetch --no-tags origin "refs\/tags\/\$RELEASE_TAG"[\s\S]*git cat-file -t FETCH_HEAD[\s\S]*git rev-list -n 1 FETCH_HEAD/,
	'release publication must verify the remote annotated tag object even when checkout peels its local ref');
assert.doesNotMatch(workflow, /git tag [^\n]*-f|git push [^\n]*--force/,
	'release publication must never rewrite an existing release tag');
assert.match(workflow, /uses: actions\/attest@v4/,
	'release assets must receive signed keyless provenance');
assert.match(workflow, /subject-path: \$\{\{ steps\.release\.outputs\.release_dir \}\}\/\*/,
	'the attestation must cover every published release asset');
assert.match(workflow, /id-token: write[\s\S]*attestations: write[\s\S]*artifact-metadata: write/,
	'the release job must explicitly grant only the permissions required for Sigstore attestations');
assert.match(prepare, /SHA256SUMS\.txt/, 'the release preparation helper must publish checksums for every asset');

console.log('Release workflow contract: ok');
