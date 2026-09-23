'use strict';
'require view';

/* MagiTrickle owns its control plane and serves a complete web application on
 * port 8080.  Keep the LuCI entry deliberately thin: it gives the service a
 * native place in Freenetic's Services group without duplicating its UI or
 * state model. */
return view.extend({
	handleSave: null,
	handleSaveApply: null,
	handleReset: null,

	render: function() {
		var hostname = window.location.hostname;
		var url = 'http://' + hostname + ':8080';

		if (window.location.protocol === 'https:') {
			return E('div', { class: 'fn-card fn-magitrickle-https' }, [
				E('h2', {}, _('MagiTrickle is served over HTTP')),
				E('p', {}, _('The embedded interface cannot be loaded from an HTTPS LuCI session because the browser blocks mixed content.')),
				E('a', {
					'class': 'fn-settings-btn fn-settings-btn-primary',
					'href': url,
					'target': '_blank',
					'rel': 'noopener'
				}, _('Open MagiTrickle'))
			]);
		}

		return E('div', { class: 'fn-magitrickle-page' }, E('iframe', {
			src: url,
			'class': 'fn-magitrickle-frame',
			'title': _('MagiTrickle'),
			'loading': 'eager'
		}));
	}
});
