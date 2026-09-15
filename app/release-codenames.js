'use strict';

const RELEASE_CODENAMES = Object.freeze({
	'0.1': 'Misery',
	'0.2': 'Onyx'
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

function releaseTitle(tag) {
	const { line, version } = releaseVersion(tag);
	const codename = RELEASE_CODENAMES[line];
	if (!codename) {
		const alphaTitle = concealedAlphaTitle(version);
		if (alphaTitle)
			return alphaTitle;
		throw new Error(`no codename configured for Freenetic ${line}.x`);
	}
	const qualifier = RELEASE_QUALIFIERS[version];
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

module.exports = { RELEASE_CODENAMES, RELEASE_QUALIFIERS, concealedAlphaTitle, codenameForTag, releaseTitle, releaseVersion };
