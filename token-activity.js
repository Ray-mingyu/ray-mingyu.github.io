// Only aggregated numbers are read here. Never put a Codex credential or raw log on the site.
(() => {
  const grid = document.getElementById('token-grid');
  const status = document.getElementById('token-status');
  const detail = document.getElementById('token-detail');
  const buttons = [...document.querySelectorAll('[data-token-mode]')];
  let snapshot = null;
  let mode = 'daily';
  let failed = false;
  const chinese = () => document.documentElement.lang === 'zh-CN';
  const locale = () => chinese() ? 'zh-CN' : 'en-AU';
  const format = value => new Intl.NumberFormat(locale()).format(value);
  const dateKey = date => date.toISOString().slice(0, 10);
  const fromKey = key => new Date(`${key}T00:00:00Z`);
  const shift = (date, days) => new Date(date.getTime() + days * 86400000);
  const monday = date => shift(date, -(date.getUTCDay() + 6) % 7);
  const localToday = () => {
    const parts = new Intl.DateTimeFormat('en', {timeZone:'Australia/Melbourne',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date());
    const part = type => parts.find(p => p.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
  };
  const render = () => {
    const zh = chinese();
    if (!snapshot) {
      status.textContent = failed
        ? (zh ? '暂时无法加载用量快照，请稍后刷新。' : 'Usage snapshot unavailable. Please try refreshing later.')
        : (zh ? '正在读取用量快照…' : 'Loading usage snapshot…');
      return;
    }
    const records = snapshot.days;
    const daily = new Map(records.map(row => [row.date, row]));
    const today = localToday();
    const weekStart = dateKey(monday(fromKey(today)));
    const known = records.filter(row => row.date <= today);
    const sum = rows => rows.reduce((n,row) => n + row.total_tokens, 0);
    const week = known.filter(row => row.date >= weekStart);
    document.getElementById('token-today').textContent = daily.has(today) ? format(daily.get(today).total_tokens) : '—';
    document.getElementById('token-week').textContent = week.length ? format(sum(week)) : '—';
    document.getElementById('token-total').textContent = known.length ? format(sum(known)) : '—';
    const updated = new Intl.DateTimeFormat(locale(),{timeZone:'Australia/Melbourne',dateStyle:'medium',timeStyle:'short'}).format(new Date(snapshot.updated_at));
    status.textContent = zh ? `本机记录 · ${known.length} 个有记录日期 · 快照更新：${updated}` : `Local records · ${known.length} recorded days · Snapshot updated: ${updated}`;
    detail.textContent = zh ? '悬停、点击或聚焦蓝色方格查看 Token 明细；灰色不代表零用量。' : 'Hover, tap or focus a blue square for token details; gray does not mean zero usage.';
    const weekly = new Map();
    const cumulative = new Map();
    let running = 0;
    for (const row of known) {
      const key = dateKey(monday(fromKey(row.date)));
      weekly.set(key, (weekly.get(key) || 0) + row.total_tokens);
      running += row.total_tokens;
      cumulative.set(row.date,running);
    }
    const valueFor = key => mode === 'weekly' ? weekly.get(dateKey(monday(fromKey(key)))) : mode === 'cumulative' ? cumulative.get(key) : daily.get(key)?.total_tokens;
    const start = shift(monday(fromKey(today)), -52 * 7);
    const values = Array.from({length:371},(_,i) => {
      const key = dateKey(shift(start,i));
      return daily.has(key) && key <= today ? valueFor(key) : 0;
    });
    const maximum = Math.max(1,...values);
    grid.replaceChildren();
    document.getElementById('token-months').replaceChildren();
    let previousMonth = -1;
    for (let column = 0; column < 53; column++) {
      const date = shift(start,column * 7);
      const label = document.createElement('span');
      if (date.getUTCMonth() !== previousMonth) {
        if (column !== 0 || date.getUTCDate() <= 7) label.textContent = new Intl.DateTimeFormat(locale(),{month:'short',timeZone:'UTC'}).format(date);
        previousMonth = date.getUTCMonth();
      }
      document.getElementById('token-months').append(label);
    }
    for (let i = 0; i < 371; i++) {
      const key = dateKey(shift(start,i));
      const row = daily.get(key);
      const cell = document.createElement('div');
      cell.className = 'token-cell';
      cell.setAttribute('role','listitem');
      cell.dataset.future = String(key > today);
      const value = values[i];
      cell.dataset.level = String(value > 0 ? Math.min(4,Math.ceil(value / maximum * 4)) : 0);
      let description = `${key} · ${zh ? '未记录' : 'No record'}`;
      if (row && key <= today) {
        const kind = mode === 'weekly' ? (zh ? '当周已记录' : 'Recorded week') : mode === 'cumulative' ? (zh ? '截至当日累计' : 'Cumulative to date') : (zh ? '当日' : 'Daily');
        description = `${key} · ${kind}: ${format(value)} tokens · ${zh ? '当日输入' : 'Daily input'}: ${format(row.input_tokens)} · ${zh ? '其中缓存' : 'cached subset'}: ${format(row.cached_input_tokens)} · ${zh ? '当日输出' : 'Daily output'}: ${format(row.output_tokens)}`;
        cell.tabIndex = 0;
        for (const event of ['mouseenter','focus','click']) cell.addEventListener(event,() => { detail.textContent = description; });
      }
      cell.title = description;
      cell.setAttribute('aria-label',description);
      grid.append(cell);
    }
  };
  for (const button of buttons) button.addEventListener('click',() => {
    mode = button.dataset.tokenMode;
    buttons.forEach(item => item.setAttribute('aria-pressed',String(item === button)));
    render();
  });
  document.addEventListener('languagechange',render);
  render();
  fetch('data/token-usage.json', {cache:'no-cache'})
    .then(response => { if (!response.ok) throw new Error('Snapshot unavailable'); return response.json(); })
    .then(data => {
      if (data.version !== 1 || !Array.isArray(data.days) || !Number.isFinite(Date.parse(data.updated_at))) throw new Error('Invalid snapshot');
      const fields = ['input_tokens','cached_input_tokens','output_tokens','reasoning_output_tokens','total_tokens'];
      if (data.days.some(row => !/^\d{4}-\d{2}-\d{2}$/.test(row.date) || fields.some(key => !Number.isSafeInteger(row[key]) || row[key] < 0))) throw new Error('Invalid counts');
      snapshot = {...data, days:[...data.days].sort((a,b) => a.date.localeCompare(b.date))};
      render();
    }).catch(() => { failed = true; render(); });
})();
