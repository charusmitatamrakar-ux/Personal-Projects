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
    filter: 'all',        // 'all', NO_LOCATION, or a location id
    search: '',
    editingId: null,      // id of the item open in the dialog (null = adding)
    touched: {},          // which form fields the person changed by hand
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
      state.items = [];
      state.locations = [];
      showScreen('login-screen');
      return;
    }

    const { data: isMember, error } = await sb.rpc('is_household_member');
    if (error || !isMember) {
      showScreen('login-screen');
      showLoginError(error
        ? 'Could not check your account: ' + error.message
        : 'This account is not on the household list (see README, Step 2).');
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
      toast('Could not load: ' + failed.message);
      return;
    }
    state.locations = locRes.data;
    state.items = itemRes.data;
    state.memory = memRes.data;
    if (state.filter !== 'all' && state.filter !== NO_LOCATION &&
        !state.locations.some((l) => l.id === state.filter)) {
      state.filter = 'all';
    }
    render();
    if ($('locations-dialog').open) renderLocationList();
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
          <span class="item-sub">Added ${esc(formatDate(item.date_added))}</span>
        </button>
        <span class="item-qty">${usedUp ? 'Used up' : esc(formatQty(item))}</span>
        <span class="item-actions">${usedUp ? '' : `
          <button type="button" data-action="minus" aria-label="Use 1 ${esc(item.unit)}">−1</button>
          <button type="button" data-action="used-up">Used up</button>`}
        </span>
      </div>`;
  }

  // ------------------------------------------------------------------
  // Quick actions: −1 and "Used up" (both can be undone from the message)
  // ------------------------------------------------------------------
  async function quickAction(id, action) {
    const item = state.items.find((i) => i.id === id);
    if (!item) return;
    const before = { quantity: item.quantity, need_to_buy: item.need_to_buy };
    const quantity = action === 'used-up' ? 0 : Math.max(0, Number(item.quantity) - 1);
    // Anything that runs out goes on the "need to buy" list.
    const after = { quantity, need_to_buy: quantity === 0 ? true : item.need_to_buy };

    const ok = await changeItem(id, after);
    if (!ok) return;
    const message = quantity === 0 ? `${item.name}: used up`
                                   : `${item.name}: ${formatQty({ quantity, unit: item.unit })} left`;
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
      toast('Could not save: ' + error.message);
      return false;
    }
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

  async function saveItem(event) {
    event.preventDefault();
    const row = {
      name: $('item-name').value.trim(),
      quantity: Number($('item-quantity').value),
      unit: $('item-unit').value.trim(),
      location_id: $('item-location').value || null,
      date_added: $('item-date').value,
    };
    if (!row.name) return toast('Please enter a name.');
    if (!(row.quantity >= 0)) return toast('Quantity must be 0 or more.');

    const saveButton = event.submitter;
    const addAnother = !state.editingId && saveButton && saveButton.value === 'next';
    if (saveButton) saveButton.disabled = true;
    const { error } = state.editingId
      ? await sb.from('items').update(row).eq('id', state.editingId)
      : await sb.from('items').insert(row);
    if (saveButton) saveButton.disabled = false;

    if (error) return toast('Could not save: ' + error.message);
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
    if (error) return toast('Could not delete: ' + error.message);
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
    if (error) return toast('Could not delete: ' + error.message);
    await loadAll();
  }

  function friendlyLocationError(error) {
    return error.code === '23505' ? 'A location with that name already exists.'
                                  : 'Could not save: ' + error.message;
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
      showLoginError(error.message === 'Invalid login credentials'
        ? 'Wrong email or password.' : error.message);
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
      applyMemory(state.memory.find((m) => m.name_key === nameKey($('item-name').value)));
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
