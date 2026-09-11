'use strict';
'require baseclass';

/*
 * LuCI's rpc module batches calls through requestAnimationFrame. Backgrounded
 * and headless tabs may never flush that batch, so custom Freenetic views use
 * the same ubus endpoint directly. Keep this workaround in one place.
 */
const REQUEST_TIMEOUT_MS = 15000;
let requestId = 1;
const streams = [];

function cgiRoot() {
	/* L.env.scriptname is normally /cgi-bin/luci, but may include a reverse
	 * proxy prefix. Keep the direct SSE CGI alongside that script instead of
	 * assuming the device is mounted at /cgi-bin. */
	const scriptName = String((L.env && (L.env.scriptname || L.env.cgi_base)) || '/cgi-bin/luci')
		.replace(/[?#].*$/, '')
		.replace(/\/+$/, '');
	const luciOffset = scriptName.indexOf('/luci');

	return luciOffset >= 0 ? (scriptName.substring(0, luciOffset) || '/cgi-bin') : (scriptName || '/cgi-bin');
}

function timedFetch(url, options) {
	const controller = typeof AbortController === 'function' ? new AbortController() : null;
	let timeoutId;
	const requestOptions = Object.assign({}, options);

	if (controller)
		requestOptions.signal = controller.signal;

	const request = fetch(url, requestOptions);
	const timeout = new Promise((resolve, reject) => {
		timeoutId = setTimeout(() => {
			if (controller)
				controller.abort();
			reject(new Error('ubus request timed out'));
		}, REQUEST_TIMEOUT_MS);
	});

	return Promise.race([ request, timeout ]).finally(() => clearTimeout(timeoutId));
}

return baseclass.extend({
	call: function(object, method, params) {
		return timedFetch(L.url('admin/ubus'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: requestId++,
				method: 'call',
				params: [ L.env.sessionid, object, method, params || {} ]
			})
		}).then(r => {
			if (!r.ok)
				throw new Error('ubus request failed (HTTP ' + r.status + ')');

			return r.json();
		}).then(msg => {
			if (!msg || !Array.isArray(msg.result))
				throw new Error('Malformed ubus reply');

			const [rc, data] = msg.result;
			if (rc !== 0)
				throw new Error('ubus error (object=' + object + ' method=' + method + ', code ' + rc + ')');

			return data || {};
		});
	},

	/* Open the authenticated server-to-client state stream. The endpoint is
	 * intentionally a plain CGI rather than a LuCI dispatcher action because
	 * dispatcher actions buffer their output and cannot stream SSE frames.
	 * Callers keep their existing polling fallback until the first snapshot is
	 * received, so an older image without the endpoint remains usable. */
	stream: function(onSnapshot, onError) {
		if (typeof window.EventSource !== 'function')
			return null;

		/* LuCI's auth cookie is scoped to its CGI directory. The stream is a
		 * sibling CGI (dispatcher actions buffer output), so include the current
		 * SID explicitly; the CGI validates it against ubus before streaming. */
		const sid = L.env.sessionid;
		const url = cgiRoot() + '/freenetic-events' + (sid ? '?sid=' + encodeURIComponent(sid) : '');
		const source = new window.EventSource(url, {
			withCredentials: true
		});
		streams.push(source);

		source.addEventListener('snapshot', ev => {
			try {
				onSnapshot(JSON.parse(ev.data));
			}
			catch (err) {
				if (onError)
					onError(err);
			}
		});

		if (onError)
			source.addEventListener('error', onError);

		return source;
	},

	/* Close all streams opened by Freenetic views. LuCI keeps modules as
	 * singletons, so a view replaced in-place must explicitly release its
	 * EventSource instead of leaving it connected to the old callbacks. */
	closeStreams: function() {
		while (streams.length) {
			const source = streams.pop();
			try { source.close(); } catch (e) {}
		}
	}
});
