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
    filter: 'all',        // 'all', NO_LOCATION, or a location id
    search: '',
    editingId: null,      // id of the item open in the dialog (null = adding)
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
    const [locRes, itemRes] = await Promise.all([
      sb.from('locations').select('*').order('sort_order').order('name'),
      sb.from('items').select('*').order('name'),
    ]);
    if (locRes.error || itemRes.error) {
      toast('Could not load: ' + (locRes.error || itemRes.error).message);
      return;
    }
    state.locations = locRes.data;
    state.items = itemRes.data;
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
    return `
      <button type="button" class="item" data-id="${esc(item.id)}">
        <span class="item-main">
          <span class="item-name">${esc(item.name)}</span><br>
          <span class="item-sub">Added ${esc(formatDate(item.date_added))}</span>
        </span>
        <span class="item-qty${Number(item.quantity) === 0 ? ' zero' : ''}">
          ${esc(formatQty(item))}
        </span>
      </button>`;
  }

  // ------------------------------------------------------------------
  // Add / edit / delete an item
  // ------------------------------------------------------------------
  function openItemDialog(item) {
    state.editingId = item ? item.id : null;
    $('item-dialog-title').textContent = item ? 'Edit item' : 'Add item';
    $('item-delete').hidden = !item;

    fillLocationSelect(item ? item.location_id
      : (state.filter !== 'all' && state.filter !== NO_LOCATION ? state.filter : ''));

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

    $('item-dialog').showModal();
    // When editing, don't pop up the phone keyboard straight away.
    if (item) document.activeElement.blur();
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
    if (saveButton) saveButton.disabled = true;
    const { error } = state.editingId
      ? await sb.from('items').update(row).eq('id', state.editingId)
      : await sb.from('items').insert(row);
    if (saveButton) saveButton.disabled = false;

    if (error) return toast('Could not save: ' + error.message);
    $('item-dialog').close();
    toast(state.editingId ? 'Saved' : `Added ${row.name}`);
    await loadAll();
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
      if (card) openItemDialog(state.items.find((i) => i.id === card.dataset.id));
    });
    $('add-item').addEventListener('click', () => openItemDialog(null));
    $('item-form').addEventListener('submit', saveItem);
    $('item-cancel').addEventListener('click', () => $('item-dialog').close());
    $('item-delete').addEventListener('click', deleteItem);

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

  let toastTimer = null;
  function toast(message) {
    const el = $('toast');
    // Put the message inside an open dialog so it isn't hidden behind it.
    const host = document.querySelector('dialog[open]') || document.body;
    if (el.parentElement !== host) host.appendChild(el);
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2500);
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
