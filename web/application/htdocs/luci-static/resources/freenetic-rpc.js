'use strict';
'require baseclass';

/*
 * LuCI's rpc module batches calls through requestAnimationFrame. Backgrounded
 * and headless tabs may never flush that batch, so custom Freenetic views use
 * the same ubus endpoint directly. Keep this workaround in one place.
 */
let requestId = 1;
const streams = [];

return baseclass.extend({
	call: function(object, method, params) {
		return fetch(L.url('admin/ubus'), {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			credentials: 'include',
			body: JSON.stringify({
				jsonrpc: '2.0',
				id: requestId++,
				method: 'call',
				params: [ L.env.sessionid, object, method, params || {} ]
			})
		}).then(r => r.json()).then(msg => {
			if (!msg || !Array.isArray(msg.result))
				throw new Error('Malformed ubus reply');

			const [rc, data] = msg.result;
			if (rc !== 0)
				throw new Error('ubus error (object=' + object + ' method=' + method + ', code ' + rc + ')');

			return data || {};
		});
	},

	/* Open the authenticated server-to-client state stream.  The endpoint is
	 * intentionally a plain CGI rather than a LuCI dispatcher action because
	 * dispatcher actions buffer their output and cannot stream SSE frames.
	 * Callers keep their existing polling fallback until the first snapshot is
	 * received, so an older image without the endpoint remains usable. */
	stream: function(onSnapshot, onError) {
		if (typeof window.EventSource !== 'function')
			return null;

		/* LuCI's auth cookie is scoped to /cgi-bin/luci.  The stream is a direct
		 * sibling CGI (dispatcher actions buffer output), so include the current
		 * SID explicitly; the CGI validates it against ubus before streaming. */
		const sid = L.env.sessionid;
		const url = '/cgi-bin/freenetic-events' + (sid ? '?sid=' + encodeURIComponent(sid) : '');
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

	/* Close all streams opened by Freenetic views.  LuCI keeps modules as
	 * singletons, so a view replaced in-place must explicitly release its
	 * EventSource instead of leaving it connected to the old callbacks. */
	closeStreams: function() {
		while (streams.length) {
			const source = streams.pop();
			try { source.close(); } catch (e) {}
		}
	}
});
