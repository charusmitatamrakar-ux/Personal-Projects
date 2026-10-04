// Pantry app – main logic.
// Talks to Supabase (database + login + live sync) and draws the screens.
(function () {
  'use strict';

  const NO_LOCATION = 'none';
  const cfg = window.PANTRY_CONFIG || {};
  const $ = (id) => document.getElementById(id);

  const state = {
    ready: false,         // true once we know whether someone is logged in
    user: null,
    items: [],
    locations: [],
    memory: [],           // remembered names with their usual unit + location
    view: 'pantry',       // which tab is showing: 'pantry' or 'buy'
    filter: 'all',        // 'all', NO_LOCATION, or a location id
    search: '',
    editingId: null,      // id of the item open in the dialog (null = adding)
    touched: {},          // which form fields the person changed by hand
    restockId: null,      // id of the item open in the "Bought" dialog
    importRows: [],       // rows in the import preview (editable)
    channel: null,
  };

  let sb = null;          // Supabase client

  // ------------------------------------------------------------------
  // Start-up
  // ------------------------------------------------------------------
  function start() {
    const configured = cfg.supabaseUrl && cfg.supabaseKey &&
      !cfg.supabaseUrl.startsWith('PASTE_') && !cfg.supabaseKey.startsWith('PASTE_');
    if (!configured || !window.supabase) {
      showScreen('setup-screen');
      return;
    }

    sb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
    bindEvents();

    // Fires once on load (with the saved session, if any) and on every login/logout.
    // Work is deferred with setTimeout, as Supabase recommends, so it never
    // blocks the login library.
    sb.auth.onAuthStateChange((_event, session) => {
      setTimeout(() => handleSession(session), 0);
    });
  }

  async function handleSession(session) {
    const user = session ? session.user : null;
    // Token refreshes re-send the same user; nothing to do then.
    if (state.ready && (user ? user.id : null) === (state.user ? state.user.id : null)) return;
    state.ready = true;
    state.user = user;

    if (!user) {
      stopLiveSync();
      clearSnapshot();
      state.items = [];
      state.locations = [];
      showScreen('login-screen');
      return;
    }

    const { data: isMember, error } = await sb.rpc('is_household_member');
    // A network error (no signal) is not a "no": carry on and show the saved list.
    if (!error && !isMember) {
      showScreen('login-screen');
      showLoginError('This account is not on the household list (see README, Step 2).');
      state.user = null;
      await sb.auth.signOut();
      return;
    }

    showScreen('main-screen');
    await loadAll();
    startLiveSync();
  }

  // ------------------------------------------------------------------
  // Loading data and live sync
  // ------------------------------------------------------------------
  async function loadAll() {
    const [locRes, itemRes, memRes] = await Promise.all([
      sb.from('locations').select('*').order('sort_order').order('name'),
      sb.from('items').select('*').order('name'),
      sb.from('item_memory').select('*').order('name'),
    ]);
    const failed = locRes.error || itemRes.error || memRes.error;
    if (failed) {
      const snapshot = readSnapshot();
      if (snapshot && isNetworkError(failed)) {
        state.locations = snapshot.locations;
        state.items = snapshot.items;
        state.memory = snapshot.memory;
        showOfflineBanner(snapshot.savedAt);
        render();
      } else {
        toast('Could not load: ' + errorText(failed));
      }
      return;
    }
    state.locations = locRes.data;
    state.items = itemRes.data;
    state.memory = memRes.data;
    saveSnapshot();
    $('offline-banner').hidden = true;
    if (state.filter !== 'all' && state.filter !== NO_LOCATION &&
        !state.locations.some((l) => l.id === state.filter)) {
      state.filter = 'all';
    }
    render();
    if ($('locations-dialog').open) renderLocationList();
    if ($('import-dialog').open && state.importRows.length) updateImportResults();
  }

  let reloadTimer = null;
  function scheduleReload() {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(loadAll, 300);
  }

  function startLiveSync() {
    stopLiveSync();
    state.channel = sb.channel('pantry-changes')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'items' }, scheduleReload)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'locations' }, scheduleReload)
      .subscribe();
  }

  function stopLiveSync() {
    if (state.channel) {
      sb.removeChannel(state.channel);
      state.channel = null;
    }
  }

  // ------------------------------------------------------------------
  // Drawing the main screen
  // ------------------------------------------------------------------
  function render() {
    renderFilters();
    renderItems();
    renderBuyList();
    renderTabs();
  }

  function setView(view) {
    state.view = view;
    $('pantry-view').hidden = view !== 'pantry';
    $('buy-view').hidden = view !== 'buy';
    window.scrollTo(0, 0);
    renderTabs();
  }

  function renderTabs() {
    const count = buyItems().length;
    $('tab-buy').innerHTML = 'To buy' + (count ? `<span class="badge">${count}</span>` : '');
    for (const tab of document.querySelectorAll('.tabs [data-view]')) {
      tab.setAttribute('aria-selected', String(tab.dataset.view === state.view));
    }
  }

  function renderFilters() {
    const chips = [{ id: 'all', name: 'All' }].concat(state.locations);
    if (state.items.some((i) => !i.location_id)) chips.push({ id: NO_LOCATION, name: 'No location' });

    $('filters').innerHTML = chips.map((c) =>
      `<button type="button" class="chip" data-filter="${esc(c.id)}"
         aria-pressed="${c.id === state.filter}">${esc(c.name)}</button>`
    ).join('');
  }

  function renderItems() {
    const term = state.search.trim().toLowerCase();
    const visible = state.items.filter((item) => {
      if (term && !item.name.toLowerCase().includes(term)) return false;
      if (state.filter === 'all') return true;
      if (state.filter === NO_LOCATION) return !item.location_id;
      return item.location_id === state.filter;
    });

    // Group by location, in the same order as the location list.
    const groups = state.locations.map((loc) => ({
      name: loc.name,
      items: visible.filter((i) => i.location_id === loc.id),
    }));
    groups.push({ name: 'No location', items: visible.filter((i) => !locationName(i.location_id)) });

    const showHeadings = state.filter === 'all';
    $('item-list').innerHTML = groups
      .filter((g) => g.items.length)
      .map((g) =>
        (showHeadings ? `<h3 class="group-title">${esc(g.name)}</h3>` : '') +
        g.items.map(itemHtml).join('')
      ).join('');

    const total = state.items.length;
    $('summary').textContent = total
      ? (visible.length === total ? `${total} item${total === 1 ? '' : 's'}`
                                  : `Showing ${visible.length} of ${total} items`)
      : '';

    const empty = $('empty');
    empty.hidden = visible.length > 0;
    empty.textContent = total === 0
      ? 'Your pantry is empty. Tap ＋ to add your first item.'
      : 'No items match.';
  }

  function itemHtml(item) {
    const usedUp = Number(item.quantity) === 0;
    return `
      <div class="item${usedUp ? ' used-up' : ''}" data-id="${esc(item.id)}">
        <button type="button" class="item-open" aria-label="Edit ${esc(item.name)}">
          <span class="item-name">${esc(item.name)}</span>
          <span class="item-sub">Added ${esc(formatDate(item.date_added))}${item.need_to_buy
            ? ' · <span class="on-list">on To buy list</span>' : ''}</span>
        </button>
        <span class="item-qty">${usedUp ? 'Used up' : esc(formatQty(item))}</span>
        <span class="item-actions">${usedUp ? '' : `
          <button type="button" data-action="minus" aria-label="Use 1 ${esc(item.unit)}">−1</button>
          <button type="button" data-action="used-up">Used up</button>`}
        </span>
      </div>`;
  }

  // ------------------------------------------------------------------
  // "To buy" list
  // ------------------------------------------------------------------

  // An item needs buying when it has run out, or dropped to its low level.
  function needsBuying(quantity, lowLevel) {
    return Number(quantity) === 0 ||
      (lowLevel !== null && lowLevel !== undefined && lowLevel !== '' &&
       Number(quantity) <= Number(lowLevel));
  }

  function buyItems() {
    return state.items.filter((i) => i.need_to_buy);
  }

  function renderBuyList() {
    const items = buyItems();
    $('buy-list').innerHTML = items.map((item) => {
      const usedUp = Number(item.quantity) === 0;
      const details = [usedUp ? 'Used up' : `${formatQty(item)} left`, locationName(item.location_id)]
        .filter(Boolean).join(' · ');
      return `
        <div class="item buy-item${usedUp ? ' used-up' : ''}" data-id="${esc(item.id)}">
          <button type="button" class="item-open" aria-label="Edit ${esc(item.name)}">
            <span class="item-name">${esc(item.name)}</span>
            <span class="item-sub">${esc(details)}</span>
          </button>
          <span class="item-actions">
            <button type="button" data-action="bought">✓ Bought</button>
            <button type="button" data-action="remove" aria-label="Take ${esc(item.name)} off the list">✕</button>
          </span>
        </div>`;
    }).join('');
    $('buy-summary').textContent = items.length
      ? `${items.length} item${items.length === 1 ? '' : 's'} to buy` : '';
    $('copy-buy-list').hidden = !items.length;
    $('buy-empty').hidden = items.length > 0;
  }

  function openRestockDialog(item) {
    state.restockId = item.id;
    $('restock-title').textContent = `Bought ${item.name}`;
    $('restock-current').textContent = Number(item.quantity) === 0
      ? 'You had run out.' : `You have ${formatQty(item)} now. What you bought is added to that.`;
    $('restock-unit').textContent = item.unit;
    $('restock-amount').value = 1;
    $('restock-dialog').showModal();
    $('restock-amount').focus();
    $('restock-amount').select();
  }

  async function saveRestock(event) {
    event.preventDefault();
    const id = state.restockId;
    const item = state.items.find((i) => i.id === id);
    const amount = Number($('restock-amount').value);
    if (!item) return $('restock-dialog').close();
    if (!(amount >= 0)) return toast('Please enter how much you bought.');

    const before = { quantity: item.quantity, need_to_buy: item.need_to_buy, date_added: item.date_added };
    const quantity = Number(item.quantity) + amount;
    $('restock-dialog').close();
    const ok = await changeItem(id, { quantity, need_to_buy: false, date_added: todayIso() });
    if (ok) {
      toast(`${item.name}: now ${formatQty({ quantity, unit: item.unit })}`,
        { label: 'Undo', run: () => changeItem(id, before) });
    }
  }

  async function removeFromList(id) {
    const item = state.items.find((i) => i.id === id);
    if (!item) return;
    const ok = await changeItem(id, { need_to_buy: false });
    if (ok) {
      toast(`${item.name}: taken off the list`,
        { label: 'Undo', run: () => changeItem(id, { need_to_buy: true }) });
    }
  }

  function copyBuyList() {
    const lines = buyItems().map((item) =>
      `- ${item.name}` + (Number(item.quantity) > 0 ? ` (have ${formatQty(item)})` : ''));
    copyText('To buy:\n' + lines.join('\n'), 'List copied – paste it into a message.');
  }

  // ------------------------------------------------------------------
  // Meal planning: copy the inventory with a ready-made request for Claude
  // ------------------------------------------------------------------
  const NOTES_KEY = 'pantry-meal-notes';

  function openMealDialog() {
    $('meal-notes').value = storageGet(NOTES_KEY) || '';
    $('meal-preview').textContent = mealPlanText();
    $('meal-dialog').showModal();
  }

  function mealPlanText() {
    const today = new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' });
    const inStock = state.items.filter((i) => Number(i.quantity) > 0);

    // Inventory grouped by storage location.
    const groups = state.locations.map((loc) => ({ name: loc.name, items: inStock.filter((i) => i.location_id === loc.id) }));
    groups.push({ name: 'Other', items: inStock.filter((i) => !locationName(i.location_id)) });
    const inventory = groups.filter((g) => g.items.length).map((g) =>
      `${g.name.toUpperCase()}\n` +
      g.items.map((i) => `- ${i.name}: ${formatQty(i)} (added ${formatDate(i.date_added)})`).join('\n')
    ).join('\n\n');

    const toBuy = buyItems().map((i) => i.name);
    const notes = $('meal-notes').value.trim();

    return [
      `Here is what I currently have at home (as of ${today}):`,
      '',
      inventory || '(Nothing in stock right now.)',
      '',
      'Please create a 7-day meal plan (breakfast, lunch and dinner) for 2 people that mainly uses these ingredients.',
      '- Use up fresh and perishable items first, especially things added a while ago, so nothing goes to waste.',
      '- Keep the recipes practical for everyday home cooking.',
      '- For each day, list the meals and which of my ingredients each one uses.',
      '- After the plan, give me a shopping list of anything extra I need, grouped by store section, with rough quantities.',
      toBuy.length ? `\nThese are already on my shopping list, so include them only if the plan uses them: ${toBuy.join(', ')}.` : '',
      notes ? `\nPlease also keep this in mind: ${notes}` : '',
    ].filter((line, i, all) => line !== '' || all[i - 1] !== '').join('\n').trim();
  }

  function copyMealPlan() {
    storageSet(NOTES_KEY, $('meal-notes').value.trim());
    copyText(mealPlanText(), 'Copied! Now tap "Open Claude" and paste.');
  }

  // ------------------------------------------------------------------
  // Import / export as CSV text: action,item,quantity,unit,location
  // ------------------------------------------------------------------
  const CSV_FIELDS = ['action', 'item', 'quantity', 'unit', 'location'];

  function openImportDialog() {
    $('location-options').innerHTML = state.locations.map((l) => `<option value="${esc(l.name)}">`).join('');
    renderImportTable();
    $('import-dialog').showModal();
  }

  // Export: one "add" line per item in stock, so it can be imported again.
  function exportCsv() {
    const lines = state.items
      .filter((i) => Number(i.quantity) > 0)
      .map((i) => ['add', i.name, roundQty(i.quantity), i.unit, locationName(i.location_id)].map(csvField).join(','));
    if (!lines.length) return toast('Nothing in stock to export.');
    copyText([CSV_FIELDS.join(',')].concat(lines).join('\n'),
      `Copied ${lines.length} item${lines.length === 1 ? '' : 's'} as CSV.`);
  }

  function csvField(value) {
    const text = String(value == null ? '' : value);
    return /[",\n\t]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }

  // Split one line into fields. Handles "quoted, values" and "" inside quotes.
  // Lines copied from a spreadsheet use tabs instead of commas; both work.
  function splitCsvLine(line) {
    const delimiter = line.includes('\t') && !line.includes(',') ? '\t' : ',';
    const fields = [];
    let field = '';
    let quoted = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (quoted) {
        if (c === '"' && line[i + 1] === '"') { field += '"'; i++; }
        else if (c === '"') quoted = false;
        else field += c;
      } else if (c === '"' && field.trim() === '') { quoted = true; field = ''; }
      else if (c === delimiter) { fields.push(field); field = ''; }
      else field += c;
    }
    fields.push(field);
    return { fields: fields.map((f) => f.trim()), unclosedQuote: quoted };
  }

  // Turn the pasted text into editable rows (bad lines included, with a note).
  function parseImportText(text) {
    const rows = [];
    text.split(/\r?\n/).forEach((line, index) => {
      if (!line.trim()) return;
      const { fields, unclosedQuote } = splitCsvLine(line);
      if (fields.every((f) => f === '')) return;
      const isHeader = !rows.length && fields[0].toLowerCase() === 'action' &&
                       (fields[1] || '').toLowerCase() === 'item';
      if (isHeader) return;

      const row = { line: index + 1, formatError: '' };
      CSV_FIELDS.forEach((name, i) => { row[name] = fields[i] || ''; });
      if (unclosedQuote) {
        row.formatError = 'A quote mark (") is opened but never closed.';
      } else if (fields.length !== CSV_FIELDS.length) {
        row.formatError = `Needs 5 values (action,item,quantity,unit,location) but has ${fields.length}.` +
          (fields.length > 5 ? ' If a name contains a comma, put it in "quotes".' : '');
      }
      rows.push(row);
    });
    return rows;
  }

  // Problems with a single row, before looking at the pantry. '' = fine.
  function rowFormatProblem(row) {
    if (row.formatError) return row.formatError;
    const action = row.action.trim().toLowerCase();
    if (action !== 'add' && action !== 'remove') {
      return row.action.trim() ? `Action must be "add" or "remove", not "${row.action.trim()}".`
                               : 'Action is missing (use "add" or "remove").';
    }
    if (!row.item.trim()) return 'Item name is missing.';
    if (row.item.trim().length > 80) return 'Item name is too long (80 characters at most).';
    const quantity = row.quantity.trim();
    if (!/^\d*\.?\d+$/.test(quantity) || !(Number(quantity) > 0)) {
      return quantity ? `Quantity must be a number above 0, not "${quantity}".` : 'Quantity is missing.';
    }
    if (row.unit.trim().length > 20) return 'Unit is too long (20 characters at most).';
    if (row.location.trim().length > 40) return 'Location is too long (40 characters at most).';
    return '';
  }

  // Work out what every row will do, in order, as if it had already been
  // applied: two "add rice" lines add up. Nothing is saved here.
  function planImport(rows) {
    const items = state.items.map((i) => ({ ...i }));
    const created = [];                 // new items, not saved yet
    const changed = new Map();          // existing item id -> working copy
    const newLocations = new Map();     // lower-case name -> name as typed
    const placeName = (id) => (String(id).startsWith('new:') ? newLocations.get(id.slice(4)) : locationName(id)) || 'No location';
    const amount = (qty, unit) => formatQty({ quantity: roundQty(qty), unit });

    const results = rows.map((row) => {
      const problem = rowFormatProblem(row);
      if (problem) return { error: problem };

      const action = row.action.trim().toLowerCase();
      const name = row.item.trim();
      const quantity = Number(row.quantity);
      const unit = row.unit.trim();
      const locText = row.location.trim();

      // Location: an existing one (any capitalisation), or a new one to create.
      let locationId;
      if (locText) {
        const known = state.locations.find((l) => l.name.toLowerCase() === locText.toLowerCase());
        locationId = known ? known.id : 'new:' + locText.toLowerCase();
      }

      // Same name (any capitalisation), and the same location if one was given.
      const matches = items.concat(created).filter((i) => nameKey(i.name) === nameKey(name) &&
        (!locText || (i.location_id || null) === locationId));
      if (!locText && matches.length > 1) {
        return { error: `You have ${name} in more than one place (${matches.map((m) => placeName(m.location_id)).join(', ')}). Add the location.` };
      }
      const target = matches[0];
      if (target && unit && target.unit && unit.toLowerCase() !== target.unit.toLowerCase()) {
        return { error: `Unit doesn't match: you keep ${target.name} in "${target.unit}", not "${unit}".` };
      }

      if (action === 'add' && !target) {
        if (locationId && locationId.startsWith('new:') && !newLocations.has(locationId.slice(4))) {
          newLocations.set(locationId.slice(4), locText);
        }
        // No location given: use where it usually goes.
        const memory = state.memory.find((m) => m.name_key === nameKey(name));
        const item = {
          id: 'new-item-' + created.length, name, quantity, low_level: null, need_to_buy: false,
          unit: unit || (memory ? memory.unit : ''),
          location_id: locText ? locationId : (memory && locationName(memory.location_id) ? memory.location_id : null),
        };
        created.push(item);
        return { ok: true, message: `New item · ${placeName(item.location_id)}` +
          (locationId && locationId.startsWith('new:') ? ' (new location)' : '') + ` · ${amount(quantity, item.unit)}` };
      }

      if (!target) {
        return { error: `${name} isn't in your pantry${locText ? ' in ' + locText : ''}, so there's nothing to remove.` };
      }

      if (!String(target.id).startsWith('new-item-')) changed.set(target.id, target);
      if (!target.unit && unit) target.unit = unit;
      const before = Number(target.quantity);
      const where = placeName(target.location_id);

      if (action === 'add') {
        target.quantity = roundQty(before + quantity);
        target.restocked = true;
        if (target.need_to_buy && !needsBuying(target.quantity, target.low_level)) target.need_to_buy = false;
        return { ok: true, message: `Add to ${target.name} · ${where} · ${amount(before, target.unit)} → ${amount(target.quantity, target.unit)}` };
      }

      target.quantity = roundQty(Math.max(0, before - quantity));
      const nowOnList = !target.need_to_buy && needsBuying(target.quantity, target.low_level);
      if (nowOnList) target.need_to_buy = true;
      return { ok: true, message: `Remove from ${target.name} · ${where} · ${amount(before, target.unit)} → ` +
        (target.quantity === 0 ? 'used up' : amount(target.quantity, target.unit)) +
        (quantity > before ? ` (you only had ${amount(before, target.unit)})` : '') +
        (nowOnList ? ' · goes on To buy' : '') };
    });

    return { results, created, changed: [...changed.values()], newLocations: [...newLocations.values()] };
  }

  function roundQty(value) {
    return Math.round(Number(value) * 1000) / 1000;
  }

  function showImportPreview() {
    state.importRows = parseImportText($('import-text').value);
    if (!state.importRows.length) return toast('Paste some lines first.');
    renderImportTable();
    $('import-review').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function renderImportTable() {
    const rows = state.importRows;
    $('import-review').hidden = !rows.length;
    $('import-table').tBodies[0].innerHTML = rows.map((row, index) => {
      const action = row.action.trim().toLowerCase();
      const odd = action !== 'add' && action !== 'remove';
      return `
        <tr data-index="${index}">
          <td class="c-action"><select data-field="action" aria-label="Action">
            ${odd ? `<option value="${esc(row.action)}" selected>${esc(row.action || '(missing)')}</option>` : ''}
            <option value="add"${action === 'add' ? ' selected' : ''}>add</option>
            <option value="remove"${action === 'remove' ? ' selected' : ''}>remove</option>
          </select></td>
          <td class="c-item"><input data-field="item" value="${esc(row.item)}" placeholder="item" aria-label="Item"></td>
          <td class="c-qty"><input data-field="quantity" value="${esc(row.quantity)}" placeholder="qty" inputmode="decimal" aria-label="Quantity"></td>
          <td class="c-unit"><input data-field="unit" value="${esc(row.unit)}" placeholder="unit" list="unit-options" aria-label="Unit"></td>
          <td class="c-loc"><input data-field="location" value="${esc(row.location)}" placeholder="location" list="location-options" aria-label="Location"></td>
          <td class="c-result"></td>
          <td class="c-del"><button type="button" data-delete aria-label="Remove this row">✕</button></td>
        </tr>`;
    }).join('');
    updateImportResults();
  }

  // Refresh the "what will happen" text without redrawing the inputs.
  function updateImportResults() {
    const { results } = planImport(state.importRows);
    const rowsEls = $('import-table').tBodies[0].rows;
    results.forEach((result, i) => {
      const tr = rowsEls[i];
      tr.classList.toggle('has-error', !!result.error);
      tr.querySelector('.c-result').textContent =
        `Line ${state.importRows[i].line}: ` + (result.error ? '⚠ ' + result.error : result.message);
    });
    const good = results.filter((r) => r.ok).length;
    const bad = results.length - good;
    $('import-summary').innerHTML = `${good} row${good === 1 ? '' : 's'} ready` +
      (bad ? ` · <span class="bad">${bad} need${bad === 1 ? 's' : ''} fixing</span>` : '');
    $('import-confirm').textContent = `Import ${good} row${good === 1 ? '' : 's'}`;
    $('import-confirm').disabled = good === 0;
  }

  function editImportRow(event) {
    const field = event.target.dataset.field;
    const tr = event.target.closest('tr');
    if (!field || !tr) return;
    const row = state.importRows[Number(tr.dataset.index)];
    row[field] = event.target.value;
    row.formatError = '';   // once edited in the table, the columns are what you see
    updateImportResults();
  }

  async function confirmImport() {
    const button = $('import-confirm');
    button.disabled = true;
    try {
      await loadAll();                       // plan against the latest list
      let plan = planImport(state.importRows);
      const good = plan.results.filter((r) => r.ok).length;
      if (!good) return updateImportResults();

      // 1. New locations first, so new items can be put in them.
      if (plan.newLocations.length) {
        const start = state.locations.reduce((max, l) => Math.max(max, l.sort_order), 0) + 1;
        const { error } = await sb.from('locations')
          .insert(plan.newLocations.map((name, i) => ({ name, sort_order: start + i })));
        if (error) return toast('Could not create locations: ' + errorText(error));
        await loadAll();
        plan = planImport(state.importRows);   // now the locations exist
      }

      // 2. New items, and 3. changes to existing ones.
      const today = todayIso();
      const saves = [];
      if (plan.created.length) {
        saves.push(sb.from('items').insert(plan.created.map((i) => ({
          name: i.name, quantity: i.quantity, unit: i.unit, location_id: i.location_id,
          date_added: today, need_to_buy: i.need_to_buy,
        }))));
      }
      for (const item of plan.changed) {
        const changes = { quantity: item.quantity, unit: item.unit, need_to_buy: item.need_to_buy };
        if (item.restocked) changes.date_added = today;
        saves.push(sb.from('items').update(changes).eq('id', item.id));
      }
      const failed = (await Promise.all(saves)).find((r) => r.error);
      await loadAll();
      if (failed) return toast('Some rows could not be saved: ' + errorText(failed.error));

      // Keep only the rows that still need fixing.
      const imported = plan.results.filter((r) => r.ok).length;
      state.importRows = state.importRows.filter((_, i) => plan.results[i].error);
      renderImportTable();
      $('import-text').value = '';
      toast(`Imported ${imported} row${imported === 1 ? '' : 's'}.` +
        (state.importRows.length ? ` ${state.importRows.length} still need fixing.` : ''));
    } finally {
      button.disabled = !planImport(state.importRows).results.some((r) => r.ok);
    }
  }

  // ------------------------------------------------------------------
  // Offline: keep the last-loaded list on this phone so it can be viewed
  // without signal. Changes still need a connection.
  // ------------------------------------------------------------------
  const SNAPSHOT_KEY = 'pantry-snapshot-v1';

  function saveSnapshot() {
    storageSet(SNAPSHOT_KEY, JSON.stringify({
      savedAt: new Date().toISOString(),
      items: state.items, locations: state.locations, memory: state.memory,
    }));
  }

  function readSnapshot() {
    try { return JSON.parse(storageGet(SNAPSHOT_KEY)); } catch (_) { return null; }
  }

  function clearSnapshot() {
    try { localStorage.removeItem(SNAPSHOT_KEY); } catch (_) { /* ignore */ }
  }

  function showOfflineBanner(savedAt) {
    $('offline-banner').textContent =
      `You're offline. Showing the list from ${formatDateTime(savedAt)}. Changes need a connection.`;
    $('offline-banner').hidden = false;
  }

  function isNetworkError(error) {
    return /fetch|network|load failed|offline/i.test(String(error && error.message));
  }

  function errorText(error) {
    return isNetworkError(error) ? "you're offline. Try again when you have signal." : error.message;
  }

  function storageGet(key) {
    try { return localStorage.getItem(key); } catch (_) { return null; }
  }

  function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch (_) { /* storage full or blocked */ }
  }

  // ------------------------------------------------------------------
  // Quick actions: −1 and "Used up" (both can be undone from the message)
  // ------------------------------------------------------------------
  async function quickAction(id, action) {
    const item = state.items.find((i) => i.id === id);
    if (!item) return;
    const before = { quantity: item.quantity, need_to_buy: item.need_to_buy };
    const quantity = action === 'used-up' ? 0 : Math.max(0, Number(item.quantity) - 1);
    // Anything that runs out or drops to its low level goes on the "To buy" list.
    const addToList = !item.need_to_buy && needsBuying(quantity, item.low_level);
    const after = { quantity, need_to_buy: item.need_to_buy || addToList };

    const ok = await changeItem(id, after);
    if (!ok) return;
    const message = (quantity === 0 ? `${item.name}: used up`
                                    : `${item.name}: ${formatQty({ quantity, unit: item.unit })} left`) +
                    (addToList ? ' · added to To buy' : '');
    toast(message, { label: 'Undo', run: () => changeItem(id, before) });
  }

  // Updates the screen straight away, then saves. Returns true if it saved.
  async function changeItem(id, changes) {
    // Look the item up each time: live sync may have reloaded the list.
    const item = state.items.find((i) => i.id === id);
    if (!item) return false;
    const previous = { ...item };
    Object.assign(item, changes);
    render();
    const { error } = await sb.from('items').update(changes).eq('id', item.id);
    if (error) {
      Object.assign(item, previous);
      render();
      toast('Could not save: ' + errorText(error));
      return false;
    }
    saveSnapshot();
    return true;
  }

  // ------------------------------------------------------------------
  // Add / edit / delete an item
  // ------------------------------------------------------------------
  function openItemDialog(item) {
    state.editingId = item ? item.id : null;
    $('item-dialog-title').textContent = item ? 'Edit item' : 'Add item';
    $('item-delete').hidden = !item;
    $('item-save-next').hidden = !!item;
    state.touched = {};
    hideSuggestions();
    $('name-hint').hidden = true;

    // New items go in the location being viewed, otherwise the first location.
    const firstLocation = state.locations[0] ? state.locations[0].id : '';
    fillLocationSelect(item ? item.location_id
      : state.filter === 'all' ? firstLocation
      : state.filter === NO_LOCATION ? '' : state.filter);

    $('item-name').value = item ? item.name : '';
    $('item-quantity').value = item ? item.quantity : 1;
    $('item-unit').value = item ? item.unit : '';
    $('item-date').value = item ? item.date_added : todayIso();
    $('item-low').value = item && item.low_level !== null ? item.low_level : '';
    $('item-buy').checked = item ? !!item.need_to_buy : false;

    const meta = $('item-meta');
    meta.hidden = !item;
    if (item) {
      let text = item.added_by ? `Added by ${shortEmail(item.added_by)}` : '';
      if (item.updated_by && item.updated_at) {
        text += `${text ? ' · ' : ''}Last changed by ${shortEmail(item.updated_by)}, ${formatDateTime(item.updated_at)}`;
      }
      meta.textContent = text;
      meta.hidden = !text;
    }

    if (!$('item-dialog').open) $('item-dialog').showModal();
    // When editing, don't pop up the phone keyboard straight away.
    if (item) document.activeElement.blur();
    else $('item-name').focus();
  }

  function fillLocationSelect(selectedId) {
    $('item-location').innerHTML =
      state.locations.map((l) => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join('') +
      '<option value="">No location</option>';
    $('item-location').value = selectedId || '';
  }

  // Tick or untick "On the To buy list" as the amounts are typed, unless
  // the person has set the tick themselves.
  function syncBuyCheckbox() {
    if (state.touched.buy) return;
    const original = state.items.find((i) => i.id === state.editingId);
    const quantity = Number($('item-quantity').value);
    let onList = original ? !!original.need_to_buy : false;
    if (needsBuying(quantity, $('item-low').value)) onList = true;
    else if (original && quantity > Number(original.quantity)) onList = false;   // restocked
    $('item-buy').checked = onList;
  }

  async function saveItem(event) {
    event.preventDefault();
    const lowText = $('item-low').value.trim();
    const row = {
      name: $('item-name').value.trim(),
      quantity: Number($('item-quantity').value),
      unit: $('item-unit').value.trim(),
      location_id: $('item-location').value || null,
      date_added: $('item-date').value,
      low_level: lowText === '' ? null : Number(lowText),
      need_to_buy: $('item-buy').checked,
    };
    if (!row.name) return toast('Please enter a name.');
    if (!(row.quantity >= 0)) return toast('Quantity must be 0 or more.');
    if (row.low_level !== null && !(row.low_level >= 0)) return toast('Low level must be 0 or more.');

    const saveButton = event.submitter;
    const addAnother = !state.editingId && saveButton && saveButton.value === 'next';
    if (saveButton) saveButton.disabled = true;
    const { error } = state.editingId
      ? await sb.from('items').update(row).eq('id', state.editingId)
      : await sb.from('items').insert(row);
    if (saveButton) saveButton.disabled = false;

    if (error) return toast('Could not save: ' + errorText(error));
    await loadAll();
    if (addAnother) {
      // Keep the dialog open for the next item, in the same location.
      openItemDialog(null);
      $('item-location').value = row.location_id || '';
      $('item-date').value = row.date_added;
      toast(`Added ${row.name}`);
      return;
    }
    $('item-dialog').close();
    toast(state.editingId ? 'Saved' : `Added ${row.name}`);
  }

  // ------------------------------------------------------------------
  // Fast entry: suggest names typed before, and fill in their usual
  // unit and location
  // ------------------------------------------------------------------
  const nameKey = (name) => name.trim().toLowerCase();

  function updateSuggestions() {
    updateNameHint();
    const term = nameKey($('item-name').value);
    if (state.editingId || !term) return hideSuggestions();

    const matches = state.memory
      .filter((m) => m.name_key.includes(term) && m.name_key !== term)
      .sort((a, b) => (b.name_key.startsWith(term) - a.name_key.startsWith(term)) ||
                      a.name_key.localeCompare(b.name_key))
      .slice(0, 6);
    if (!matches.length) return hideSuggestions();

    $('name-suggestions').innerHTML = matches.map((m) => {
      const details = [m.unit, locationName(m.location_id)].filter(Boolean).join(' · ');
      return `<li><button type="button" data-key="${esc(m.name_key)}">${esc(m.name)}
        ${details ? `<span class="sub">${esc(details)}</span>` : ''}</button></li>`;
    }).join('');
    $('name-suggestions').hidden = false;
  }

  function hideSuggestions() {
    $('name-suggestions').hidden = true;
    $('name-suggestions').innerHTML = '';
  }

  // Fill in the remembered unit and location (unless already changed by hand).
  function applyMemory(memory) {
    if (!memory || state.editingId) return;
    if (!state.touched.unit) $('item-unit').value = memory.unit;
    if (!state.touched.location && locationName(memory.location_id)) {
      $('item-location').value = memory.location_id;
    }
  }

  function pickSuggestion(key) {
    const memory = state.memory.find((m) => m.name_key === key);
    if (!memory) return;
    $('item-name').value = memory.name;
    hideSuggestions();
    applyMemory(memory);
    updateNameHint();
    $('item-quantity').focus();
    $('item-quantity').select();
  }

  // When adding something you already have, point to the existing entry.
  function updateNameHint() {
    const hint = $('name-hint');
    const key = nameKey($('item-name').value);
    const existing = key && state.items.find((i) => i.id !== state.editingId && nameKey(i.name) === key);
    hint.hidden = !existing;
    if (!existing) return;
    const where = locationName(existing.location_id);
    const amount = Number(existing.quantity) === 0 ? 'used up' : formatQty(existing);
    hint.innerHTML = `Already in your pantry: ${esc(amount)}${where ? ' in ' + esc(where) : ''}.
      <button type="button" data-id="${esc(existing.id)}">Open it</button>`;
  }

  async function deleteItem() {
    const item = state.items.find((i) => i.id === state.editingId);
    if (!item || !confirm(`Delete "${item.name}"?`)) return;
    const { error } = await sb.from('items').delete().eq('id', item.id);
    if (error) return toast('Could not delete: ' + errorText(error));
    $('item-dialog').close();
    toast(`Deleted ${item.name}`);
    await loadAll();
  }

  // ------------------------------------------------------------------
  // Manage storage locations
  // ------------------------------------------------------------------
  function openLocationsDialog() {
    renderLocationList();
    $('locations-dialog').showModal();
  }

  function renderLocationList() {
    $('location-list').innerHTML = state.locations.map((loc) => {
      const count = state.items.filter((i) => i.location_id === loc.id).length;
      return `
        <li data-id="${esc(loc.id)}">
          <input class="grow loc-name" value="${esc(loc.name)}" maxlength="40" aria-label="Location name">
          <span class="count">${count} item${count === 1 ? '' : 's'}</span>
          <button type="button" class="danger loc-delete" aria-label="Delete ${esc(loc.name)}">✕</button>
        </li>`;
    }).join('');
  }

  async function addLocation(event) {
    event.preventDefault();
    const name = $('location-new').value.trim();
    if (!name) return;
    const nextOrder = state.locations.reduce((max, l) => Math.max(max, l.sort_order), 0) + 1;
    const { error } = await sb.from('locations').insert({ name, sort_order: nextOrder });
    if (error) return toast(friendlyLocationError(error));
    $('location-new').value = '';
    await loadAll();
  }

  async function renameLocation(input) {
    const id = input.closest('li').dataset.id;
    const loc = state.locations.find((l) => l.id === id);
    const name = input.value.trim();
    if (!loc || name === loc.name) return;
    if (!name) { input.value = loc.name; return; }
    const { error } = await sb.from('locations').update({ name }).eq('id', id);
    if (error) { input.value = loc.name; return toast(friendlyLocationError(error)); }
    toast('Renamed');
    await loadAll();
  }

  async function deleteLocation(id) {
    const loc = state.locations.find((l) => l.id === id);
    if (!loc) return;
    const count = state.items.filter((i) => i.location_id === id).length;
    const question = count
      ? `Delete "${loc.name}"? Its ${count} item${count === 1 ? '' : 's'} will be kept as "No location".`
      : `Delete "${loc.name}"?`;
    if (!confirm(question)) return;
    const { error } = await sb.from('locations').delete().eq('id', id);
    if (error) return toast('Could not delete: ' + errorText(error));
    await loadAll();
  }

  function friendlyLocationError(error) {
    return error.code === '23505' ? 'A location with that name already exists.'
                                  : 'Could not save: ' + errorText(error);
  }

  // ------------------------------------------------------------------
  // Login / logout
  // ------------------------------------------------------------------
  async function logIn(event) {
    event.preventDefault();
    showLoginError('');
    const button = event.submitter;
    if (button) button.disabled = true;
    const { error } = await sb.auth.signInWithPassword({
      email: $('login-email').value.trim(),
      password: $('login-password').value,
    });
    if (button) button.disabled = false;
    if (error) {
      showLoginError(error.message === 'Invalid login credentials' ? 'Wrong email or password.'
        : isNetworkError(error) ? "You're offline. Logging in needs a connection."
        : error.message);
    } else {
      $('login-password').value = '';
    }
  }

  function showLoginError(message) {
    $('login-error').textContent = message;
    $('login-error').hidden = !message;
  }

  // ------------------------------------------------------------------
  // Wiring up buttons
  // ------------------------------------------------------------------
  function bindEvents() {
    $('login-form').addEventListener('submit', logIn);
    $('sign-out').addEventListener('click', () => sb.auth.signOut());

    $('search').addEventListener('input', (e) => { state.search = e.target.value; renderItems(); });
    $('filters').addEventListener('click', (e) => {
      const chip = e.target.closest('[data-filter]');
      if (!chip) return;
      state.filter = chip.dataset.filter;
      render();
    });

    for (const tab of document.querySelectorAll('.tabs [data-view]')) {
      tab.addEventListener('click', () => setView(tab.dataset.view));
    }

    $('buy-list').addEventListener('click', (e) => {
      const card = e.target.closest('.item');
      if (!card) return;
      const item = state.items.find((i) => i.id === card.dataset.id);
      const actionButton = e.target.closest('[data-action]');
      if (!item) return;
      if (!actionButton) { if (e.target.closest('.item-open')) openItemDialog(item); }
      else if (actionButton.dataset.action === 'bought') openRestockDialog(item);
      else if (actionButton.dataset.action === 'remove') removeFromList(item.id);
    });
    $('copy-buy-list').addEventListener('click', copyBuyList);

    $('open-meal-plan').addEventListener('click', openMealDialog);
    $('meal-notes').addEventListener('input', () => { $('meal-preview').textContent = mealPlanText(); });
    $('meal-copy').addEventListener('click', copyMealPlan);
    $('meal-close').addEventListener('click', () => $('meal-dialog').close());
    window.addEventListener('online', () => { if (state.user) loadAll(); });
    $('restock-form').addEventListener('submit', saveRestock);
    $('restock-cancel').addEventListener('click', () => $('restock-dialog').close());

    $('item-quantity').addEventListener('input', syncBuyCheckbox);
    $('item-low').addEventListener('input', syncBuyCheckbox);
    $('item-buy').addEventListener('change', () => { state.touched.buy = true; });

    $('item-list').addEventListener('click', (e) => {
      const card = e.target.closest('.item');
      if (!card) return;
      const actionButton = e.target.closest('[data-action]');
      if (actionButton) quickAction(card.dataset.id, actionButton.dataset.action);
      else if (e.target.closest('.item-open')) {
        openItemDialog(state.items.find((i) => i.id === card.dataset.id));
      }
    });
    $('add-item').addEventListener('click', () => openItemDialog(null));
    $('item-form').addEventListener('submit', saveItem);
    $('item-cancel').addEventListener('click', () => $('item-dialog').close());
    $('item-delete').addEventListener('click', deleteItem);

    $('item-name').addEventListener('input', updateSuggestions);
    $('item-name').addEventListener('change', () => {
      const memory = state.memory.find((m) => m.name_key === nameKey($('item-name').value));
      // Typed a known name in full: use its usual spelling, unit and location.
      if (memory && !state.editingId) $('item-name').value = memory.name;
      applyMemory(memory);
    });
    $('item-name').addEventListener('blur', hideSuggestions);
    $('item-name').addEventListener('keydown', (e) => { if (e.key === 'Escape') hideSuggestions(); });
    // Stop the name box losing focus (and the list closing) before a tap registers.
    $('name-suggestions').addEventListener('mousedown', (e) => e.preventDefault());
    $('name-suggestions').addEventListener('click', (e) => {
      const button = e.target.closest('[data-key]');
      if (button) pickSuggestion(button.dataset.key);
    });
    $('name-hint').addEventListener('click', (e) => {
      const button = e.target.closest('[data-id]');
      if (button) openItemDialog(state.items.find((i) => i.id === button.dataset.id));
    });
    $('item-unit').addEventListener('input', () => { state.touched.unit = true; });
    $('item-location').addEventListener('change', () => { state.touched.location = true; });

    // Menu (top right)
    const closeMenu = () => {
      $('menu-list').hidden = true;
      $('menu-button').setAttribute('aria-expanded', 'false');
    };
    $('menu-button').addEventListener('click', (e) => {
      e.stopPropagation();
      const open = $('menu-list').hidden;
      $('menu-list').hidden = !open;
      $('menu-button').setAttribute('aria-expanded', String(open));
    });
    $('menu-list').addEventListener('click', closeMenu);
    document.addEventListener('click', (e) => { if (!e.target.closest('.menu')) closeMenu(); });

    $('open-import').addEventListener('click', openImportDialog);
    $('import-close').addEventListener('click', () => $('import-dialog').close());
    $('export-csv').addEventListener('click', exportCsv);
    $('import-preview').addEventListener('click', showImportPreview);
    $('import-clear').addEventListener('click', () => {
      $('import-text').value = '';
      state.importRows = [];
      renderImportTable();
    });
    $('import-table').addEventListener('input', editImportRow);
    $('import-table').addEventListener('change', editImportRow);
    $('import-table').addEventListener('click', (e) => {
      const button = e.target.closest('[data-delete]');
      if (!button) return;
      state.importRows.splice(Number(button.closest('tr').dataset.index), 1);
      renderImportTable();
    });
    $('import-confirm').addEventListener('click', confirmImport);

    $('open-locations').addEventListener('click', openLocationsDialog);
    $('locations-close').addEventListener('click', () => $('locations-dialog').close());
    $('location-add-form').addEventListener('submit', addLocation);
    $('location-list').addEventListener('change', (e) => {
      if (e.target.classList.contains('loc-name')) renameLocation(e.target);
    });
    $('location-list').addEventListener('click', (e) => {
      const button = e.target.closest('.loc-delete');
      if (button) deleteLocation(button.closest('li').dataset.id);
    });

    // Phones pause pages in the background; catch up when the app is reopened.
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && state.user) loadAll();
    });
  }

  // ------------------------------------------------------------------
  // Small helpers
  // ------------------------------------------------------------------
  function showScreen(id) {
    for (const screen of document.querySelectorAll('.screen')) screen.hidden = screen.id !== id;
  }

  // Short message at the bottom of the screen, optionally with a button
  // such as { label: 'Undo', run: () => ... }.
  let toastTimer = null;
  function toast(message, action) {
    const el = $('toast');
    // Put the message inside an open dialog so it isn't hidden behind it.
    const host = document.querySelector('dialog[open]') || document.body;
    if (el.parentElement !== host) host.appendChild(el);
    el.innerHTML = `<span>${esc(message)}</span>` +
      (action ? `<button type="button">${esc(action.label)}</button>` : '');
    if (action) {
      el.querySelector('button').addEventListener('click', () => {
        el.hidden = true;
        action.run();
      });
    }
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, action ? 6000 : 2500);
  }

  async function copyText(text, doneMessage) {
    try {
      await navigator.clipboard.writeText(text);
    } catch (_) {
      // Older phones: fall back to a hidden text box.
      const box = document.createElement('textarea');
      box.value = text;
      box.setAttribute('readonly', '');
      box.style.position = 'fixed';
      box.style.opacity = '0';
      document.body.appendChild(box);
      box.select();
      const copied = document.execCommand('copy');
      box.remove();
      if (!copied) return toast('Could not copy on this phone.');
    }
    toast(doneMessage);
  }

  function locationName(id) {
    const loc = state.locations.find((l) => l.id === id);
    return loc ? loc.name : '';
  }

  function formatQty(item) {
    const qty = Number(item.quantity);
    const shown = Number.isInteger(qty) ? String(qty) : String(Math.round(qty * 100) / 100);
    return item.unit ? `${shown} ${item.unit}` : shown;
  }

  function todayIso() {
    const d = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }

  function formatDate(iso) {
    if (!iso) return '';
    const [y, m, d] = iso.split('-').map(Number);
    const date = new Date(y, m - 1, d);
    const sameYear = y === new Date().getFullYear();
    return date.toLocaleDateString(undefined,
      sameYear ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  }

  function formatDateTime(iso) {
    return new Date(iso).toLocaleString(undefined,
      { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
  }

  function shortEmail(email) {
    return String(email).split('@')[0];
  }

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  start();
})();
