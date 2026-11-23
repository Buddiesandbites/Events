// Events by Buddies & Bites - API on Cloudflare Workers + D1.
// Public routes expose only retail data. Bulk and purchase prices, other customers' data and
// all admin actions stay server-side and need the ADMIN_TOKEN secret.
const GS = /^\d{2}[A-Z]{5}\d{4}[A-Z][A-Z\d]Z[A-Z\d]$/;
const J = (d, s = 200) => new Response(JSON.stringify(d), { status: s, headers: { 'content-type': 'application/json' } });
const now = () => new Date().toISOString();
const day = () => new Date(Date.now() + 19800000).toISOString().slice(0, 10); // India time (UTC+5:30)
const id = p => p + '-' + crypto.randomUUID().slice(0, 6).toUpperCase();
const hx = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
const pbk = async (pw, salt) => {
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  return hx(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, k, 256));
};
const money = o => {
  let b = 0, t = 0;
  for (const x of JSON.parse(o.items)) { const v = x.qty * x.rate; b += v; t += v * x.gst / 100; }
  return { taxable: +b.toFixed(2), gst: +t.toFixed(2), total: +(b + t).toFixed(2) };
};

export default {
  async fetch(req, env) {
    const u = new URL(req.url);
    if (!u.pathname.startsWith('/api/')) return env.ASSETS.fetch(req);
    try { return await route(req, env, u); } catch (e) { return J({ error: 'Server error' }, 500); }
  }
};

async function route(req, env, u) {
  const p = u.pathname, m = req.method, D = env.DB;
  const q = (s, ...a) => D.prepare(s).bind(...a);
  const all = async (s, ...a) => (await q(s, ...a).all()).results;
  const one = (s, ...a) => q(s, ...a).first();
  const run = (s, ...a) => q(s, ...a).run();
  const b = m === 'GET' ? {} : await req.json().catch(() => ({}));
  const tok = (req.headers.get('authorization') || '').replace('Bearer ', '');
  let a = {};
  if (tok) {
    if (env.ADMIN_TOKEN && tok === env.ADMIN_TOKEN) a = { admin: true };
    else { const x = await one('SELECT u.* FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token=?', tok); if (x) a = { user: x }; }
  }
  const session = async uid => {
    const t = crypto.randomUUID() + crypto.randomUUID();
    await run('INSERT INTO sessions VALUES(?,?,?)', t, uid, now());
    return { token: t, user: await one('SELECT id,name,phone,gstin,ship,bill,bulk FROM users WHERE id=?', uid) };
  };

  // ---------- public ----------
  if (p === '/api/store') return J({
    products: await all('SELECT id,name,cat,emoji,retail,mrp,moq,stock,gst FROM products WHERE hidden=0'),
    offers: await all('SELECT id,title,code,pct FROM offers WHERE active=1'),
    posters: await all('SELECT id,title,src FROM posters'),
    visitors: (await one("SELECT n FROM visits WHERE day=? AND kind='f'", day()))?.n || 0
  });
  if (p === '/api/visit' && m === 'POST') {
    const k = a.admin && b.kind === 'b' ? 'b' : 'f';
    await run('INSERT INTO visits(day,kind,n) VALUES(?,?,1) ON CONFLICT(day,kind) DO UPDATE SET n=n+1', day(), k);
    return J({ ok: 1 });
  }
  if (p === '/api/signup' && m === 'POST') {
    const g = (b.gstin || '').toUpperCase();
    if (!b.name || !b.phone || !b.ship || (b.password || '').length < 6) return J({ error: 'Enter name, phone, address and a 6+ character password' }, 400);
    if (g && !GS.test(g)) return J({ error: 'Enter a valid 15-character GST number or leave it blank' }, 400);
    if (await one('SELECT 1 x FROM users WHERE phone=?', b.phone)) return J({ error: 'This phone number already has an account' }, 409);
    const salt = crypto.randomUUID(), uid = id('C');
    await run('INSERT INTO users(id,name,phone,salt,hash,gstin,ship,bill,bulk,created) VALUES(?,?,?,?,?,?,?,?,0,?)', uid, b.name, b.phone, salt, await pbk(b.password, salt), g, b.ship, b.bill || b.ship, now());
    return J(await session(uid));
  }
  if (p === '/api/login' && m === 'POST') {
    const r = await one('SELECT * FROM users WHERE phone=?', b.phone || '');
    if (!r || r.hash !== await pbk(b.password || '', r.salt)) return J({ error: 'Phone or password is incorrect' }, 401);
    return J(await session(r.id));
  }
  if (p === '/api/tickets' && m === 'POST') {
    if (!b.message) return J({ error: 'Describe your issue' }, 400);
    const t = id('TKT');
    await run('INSERT INTO tickets VALUES(?,?,?,?,?,?,?,?,?)', t, a.user?.id || null, b.name || a.user?.name || '', b.contact || a.user?.phone || '', b.topic || 'Other', b.orderId || '', 'Open', JSON.stringify([{ f: 'c', t: b.message, at: now() }]), now());
    return J({ id: t });
  }
  if (p === '/api/ticket' && m === 'GET') {
    const r = await one('SELECT id,topic,status,thread FROM tickets WHERE id=?', (u.searchParams.get('id') || '').toUpperCase());
    return r ? J({ ...r, thread: JSON.parse(r.thread) }) : J({ error: 'Not found' }, 404);
  }
  if (p === '/api/ticket-reply' && m === 'POST') {
    const r = await one('SELECT thread,status FROM tickets WHERE id=?', b.id);
    if (!r || !b.text) return J({ error: 'Not found' }, 404);
    const th = JSON.parse(r.thread); th.push({ f: 'c', t: b.text, at: now() });
    await run('UPDATE tickets SET thread=?,status=? WHERE id=?', JSON.stringify(th), r.status === 'Resolved' ? 'Open' : r.status, b.id);
    return J({ ok: 1 });
  }

  // ---------- signed-in customer ----------
  if (p === '/api/me') {
    const U = a.user; if (!U) return J({ error: 'Sign in' }, 401);
    if (m === 'PUT') {
      const g = (b.gstin || '').toUpperCase();
      if (g && !GS.test(g)) return J({ error: 'Enter a valid 15-character GST number or leave it blank' }, 400);
      await run('UPDATE users SET gstin=?,ship=?,bill=? WHERE id=?', g, b.ship || U.ship, b.bill || U.bill, U.id);
    }
    const pay = {}; for (const r of await all('SELECT order_id,SUM(amount) s FROM payments GROUP BY order_id')) pay[r.order_id] = r.s;
    const orders = (await all('SELECT * FROM orders WHERE user_id=? ORDER BY created DESC', U.id)).map(o => ({
      id: o.id, day: o.day, status: o.status, bulk: !!o.bulk, gstin: o.gstin, ship: o.ship, bill: o.bill,
      items: JSON.parse(o.items).map(x => ({ name: x.name, qty: x.qty, rate: x.rate })), ...money(o), paid: pay[o.id] || 0
    }));
    return J({
      user: await one('SELECT id,name,phone,gstin,ship,bill,bulk FROM users WHERE id=?', U.id), orders,
      tickets: (await all('SELECT id,topic,status,thread FROM tickets WHERE user_id=?', U.id)).map(t => ({ ...t, thread: JSON.parse(t.thread) })),
      enquiries: await all('SELECT id,message,status FROM enquiries WHERE user_id=?', U.id)
    });
  }
  if (p === '/api/orders' && m === 'POST') {
    const U = a.user; if (!U) return J({ error: 'Sign in to place an order' }, 401);
    const g = (b.gstin || '').toUpperCase();
    if (g && !GS.test(g)) return J({ error: 'Enter a valid 15-character GST number or leave it blank' }, 400);
    if (!b.ship || !b.bill) return J({ error: 'Shipping and billing addresses are required' }, 400);
    const items = [];
    for (const l of b.items || []) {
      const r = await one('SELECT * FROM products WHERE id=? AND hidden=0', l.id), n = Math.floor(+l.qty);
      if (!r || n < r.moq || n > r.stock) return J({ error: `Check the quantity for ${r ? r.name : 'an item'}` }, 400);
      // Bulk rate is applied here, on the server, only for customers approved as bulk buyers.
      items.push({ id: r.id, name: r.name, qty: n, rate: U.bulk && r.bulk > 0 ? r.bulk : r.retail, retail: r.retail, gst: r.gst });
    }
    if (!items.length) return J({ error: 'Your cart is empty' }, 400);
    const oid = id('ORD');
    await D.batch([
      q('INSERT INTO orders(id,user_id,name,phone,gstin,ship,bill,bulk,items,status,day,created) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', oid, U.id, U.name, U.phone, g, b.ship, b.bill, U.bulk ? 1 : 0, JSON.stringify(items), 'New', day(), now()),
      ...items.map(x => q('UPDATE products SET stock=stock-? WHERE id=?', x.qty, x.id)),
      q('UPDATE users SET gstin=?,ship=?,bill=? WHERE id=?', g, b.ship, b.bill, U.id)
    ]);
    return J({ id: oid });
  }
  if (p === '/api/enquiries' && m === 'POST') {
    if (!a.user) return J({ error: 'Sign in to send an enquiry' }, 401);
    if (!b.message) return J({ error: 'Tell us what you need' }, 400);
    const e = id('ENQ');
    await run('INSERT INTO enquiries VALUES(?,?,?,?,?,?,?)', e, a.user.id, a.user.name, a.user.phone, b.message, 'Pending', now());
    return J({ id: e });
  }

  // ---------- admin (needs ADMIN_TOKEN) ----------
  if (p.startsWith('/api/admin/')) {
    if (!a.admin) return J({ error: 'Not allowed' }, 403);
    if (p === '/api/admin/all') return J({
      products: await all('SELECT * FROM products'),
      orders: (await all('SELECT * FROM orders ORDER BY created DESC')).map(o => ({ ...o, items: JSON.parse(o.items), ...money(o) })),
      payments: await all('SELECT * FROM payments'),
      users: await all('SELECT id,name,phone,gstin,ship,bill,bulk,created FROM users'),
      tickets: (await all('SELECT * FROM tickets ORDER BY created DESC')).map(t => ({ ...t, thread: JSON.parse(t.thread) })),
      enquiries: await all('SELECT * FROM enquiries ORDER BY created DESC'),
      offers: await all('SELECT * FROM offers'), posters: await all('SELECT * FROM posters'),
      visits: await all('SELECT * FROM visits'), ledger: await all('SELECT * FROM ledger ORDER BY id DESC')
    });
    const k = p.slice(11);
    if (k === 'product') {
      const v = [b.name, b.cat, b.emoji || '🎁', +b.retail, +b.mrp || +b.retail, +b.bulk || 0, +b.purchase || 0, b.gst == null ? 18 : +b.gst, +b.moq || 1, +b.stock || 0, b.hidden ? 1 : 0];
      if (b.id) await run('UPDATE products SET name=?,cat=?,emoji=?,retail=?,mrp=?,bulk=?,purchase=?,gst=?,moq=?,stock=?,hidden=? WHERE id=?', ...v, b.id);
      else await run('INSERT INTO products(name,cat,emoji,retail,mrp,bulk,purchase,gst,moq,stock,hidden) VALUES(?,?,?,?,?,?,?,?,?,?,?)', ...v);
    } else if (k === 'status') {
      const o = await one('SELECT * FROM orders WHERE id=?', b.id);
      if (o) {
        const c = b.status === 'Cancelled', d = c && o.status !== 'Cancelled' ? 1 : !c && o.status === 'Cancelled' ? -1 : 0;
        const st = [q('UPDATE orders SET status=? WHERE id=?', b.status, b.id)];
        if (d) JSON.parse(o.items).forEach(x => st.push(q('UPDATE products SET stock=MAX(0,stock+?) WHERE id=?', d * x.qty, x.id)));
        await D.batch(st);
      }
    } else if (k === 'payment') await run('INSERT INTO payments(order_id,amount,created) VALUES(?,?,?)', b.id, +b.amount, now());
    else if (k === 'ticket') {
      const r = await one('SELECT thread,status FROM tickets WHERE id=?', b.id);
      if (r) {
        const th = JSON.parse(r.thread); let st = b.status || r.status;
        if (b.reply) { th.push({ f: 's', t: b.reply, at: now() }); if (st === 'Open') st = 'In progress'; }
        await run('UPDATE tickets SET thread=?,status=? WHERE id=?', JSON.stringify(th), st, b.id);
      }
    } else if (k === 'enquiry') {
      const e = await one('SELECT user_id FROM enquiries WHERE id=?', b.id);
      if (e) {
        await run('UPDATE enquiries SET status=? WHERE id=?', b.decision, b.id);
        if (b.decision === 'Approved') await run('UPDATE users SET bulk=1 WHERE id=?', e.user_id);
      }
    } else if (k === 'bulk') await run('UPDATE users SET bulk=? WHERE id=?', b.bulk ? 1 : 0, b.id);
    else if (k === 'offer') {
      if (b.op === 'add') await run('INSERT INTO offers VALUES(?,?,?,?,1)', id('OFR'), b.title, (b.code || '').toUpperCase(), +b.pct);
      else if (b.op === 'toggle') await run('UPDATE offers SET active=1-active WHERE id=?', b.id);
      else await run('DELETE FROM offers WHERE id=?', b.id);
    } else if (k === 'poster') {
      if (b.op === 'add') await run('INSERT INTO posters VALUES(?,?,?)', id('PST'), b.title || 'Poster', b.src);
      else await run('DELETE FROM posters WHERE id=?', b.id);
    } else if (k === 'ledger') await run('INSERT INTO ledger(kind,note,amount,created) VALUES(?,?,?,?)', b.kind, b.note, +b.amount, now());
    else if (k === 'receive') {
      await run('UPDATE products SET stock=stock+? WHERE id=?', +b.qty, b.id);
      if (+b.cost > 0) {
        const r = await one('SELECT name FROM products WHERE id=?', b.id);
        await run("INSERT INTO ledger(kind,note,amount,created) VALUES('Purchase',?,?,?)", `${r?.name} x ${b.qty}`, +b.qty * +b.cost, now());
      }
    } else return J({ error: 'Unknown action' }, 404);
    return J({ ok: 1 });
  }
  return J({ error: 'Not found' }, 404);
}
