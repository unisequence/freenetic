'use strict';

const RELEASE_CODENAMES = Object.freeze({
	'0.1': 'Misery',
	'0.2': 'Onyx',
	'0.3': 'Noxium',
	'0.4': 'Oxidice'
});
const RELEASE_QUALIFIERS = Object.freeze({
	'0.2.7': 'Hotfix'
});

function releaseVersion(tag) {
	const match = /^v(\d+)\.(\d+)\.(\d+)(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?$/.exec(tag);
	if (!match)
		throw new Error(`invalid release tag: ${tag}`);
	return {
		line: `${match[1]}.${match[2]}`,
		version: tag.slice(1)
	};
}

function codenameForTag(tag) {
	const { line } = releaseVersion(tag);
	const codename = RELEASE_CODENAMES[line];
	if (!codename)
		throw new Error(`no codename configured for Freenetic ${line}.x`);
	return codename;
}

function concealedAlphaTitle(version) {
	const match = /^(\d+\.\d+\.\d+)-alpha\.(\d+)$/.exec(version);
	return match ? `Freenetic ${match[1]}a-${match[2]}` : null;
}

function concealedPrereleaseTitle(version) {
	const match = /^(\d+\.\d+\.\d+)-(alpha|beta|rc)\.(\d+)$/.exec(version);
	if (!match)
		return null;
	const stage = match[2] === 'alpha' ? 'a' : (match[2] === 'beta' ? 'b' : 'rc');
	return `Freenetic ${match[1]}${stage}-${match[3]}`;
}

function releaseTitle(tag) {
	const { line, version } = releaseVersion(tag);
	/* Keep the alpha/beta/RC history anonymous even after a stable codename
	 * becomes public. */
	if (line === '0.3' || line === '0.4') {
		const prereleaseTitle = concealedPrereleaseTitle(version);
		if (prereleaseTitle)
			return prereleaseTitle;
		if (version.includes('-'))
			throw new Error(`unsupported prerelease version: ${version}`);
	}
	const codename = RELEASE_CODENAMES[line];
	if (!codename) {
		const prereleaseTitle = concealedPrereleaseTitle(version);
		if (prereleaseTitle)
			return prereleaseTitle;
		throw new Error(`no codename configured for Freenetic ${line}.x`);
	}
	const qualifier = RELEASE_QUALIFIERS[version];
	if (version === '0.3.0' || version === '0.4.0')
		return `Introducing Freenetic ${version} ${codename}`;
	return `Freenetic ${version} — ${codename}${qualifier ? ` ${qualifier}` : ''}`;
}

if (require.main === module) {
	try {
		console.log(releaseTitle(process.argv[2] || ''));
	}
	catch (error) {
		console.error(`Cannot create release title: ${error.message}`);
		process.exitCode = 1;
	}
}

module.exports = { RELEASE_CODENAMES, RELEASE_QUALIFIERS, concealedAlphaTitle, concealedPrereleaseTitle, codenameForTag, releaseTitle, releaseVersion };
