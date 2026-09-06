'use strict';
'require baseclass';

/*
 * LuCI's rpc module batches calls through requestAnimationFrame. Backgrounded
 * and headless tabs may never flush that batch, so custom Freenetic views use
 * the same ubus endpoint directly. Keep this workaround in one place.
 */
let requestId = 1;

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
	}
});
