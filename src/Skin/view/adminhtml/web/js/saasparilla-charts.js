/* Saasparilla charts, from raygun-theme/packages/core/js/charts.js, exposed as window.SaasparillaCharts for the Nebula admin. */
(function () {
/**
 * Dependency-free SVG charts shared by every variant.
 *
 * Each factory renders into a container element and returns
 * { update(data), destroy() }. Colours are CSS variables, so charts follow
 * light and dark mode without re-rendering. Every chart also writes a
 * visually hidden table, so no value is reachable only by hovering.
 *
 *   lineChart(el, { labels, series: [{ name, color, values, area }], format })
 *   barChart(el,  { labels, series: [{ name, color, values }], format })
 *   sticks(el,    { labels, values, format, highlight, caps })
 *   dumbbell(el,  { labels, series: [current, previous], format, axisFormat, min })
 *   meter(el,     { value, count })
 *   dotMatrix(el, { days: [{ label, value, state }], offset, format, states })
 *   sparkline(el, { values, color })
 *   dial(el,      { value, min, max, target, format, tickFormat, caption, ticks, minor })
 *   heatgrid(el,  { rows, cols, values, format, caption, highlight, tickFormat, totals, totalsLabel, columnBars })
 *   funnel(el,    { steps: [{ label, value }], format, caption, height })
 *   dotline(el,   { labels, series: [{ name, color, values }], format, caption, highlight })
 *   grille(el,    { value, rings, caption })
 *   waterfall(el, { start, steps: [{ label, value, short }], end, format, signedFormat, caption })
 *   cohort(el,    { rows: [{ label, title, size, values }], cols, format, caption, selected, onSelect })
 */

const NS = 'http://www.w3.org/2000/svg';

function svg(tag, attrs = {}, parent) {
  const node = document.createElementNS(NS, tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value !== undefined && value !== null) node.setAttribute(key, value);
  }
  if (parent) parent.appendChild(node);
  return node;
}

function html(tag, className, parent) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (parent) parent.appendChild(node);
  return node;
}

/** Rounds the axis maximum up to a clean step: 0 / 10K / 20K ... */
function niceScale(max, ticks = 4) {
  if (max <= 0) return { max: 1, step: 1 };
  const raw = max / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((s) => s >= raw);
  return { max: Math.ceil(max / step) * step, step };
}

function measureText(text, className, host) {
  const probe = svg('text', { class: className, x: -9999, y: -9999 }, host);
  probe.textContent = text;
  const width = probe.getBBox().width;
  probe.remove();
  return width;
}

function renderLegend(root, series, keys) {
  if (series.length < 2) return;
  const legend = html('div', 'chart-legend mb-4', root);
  series.forEach((s, i) => {
    const item = html('span', 'inline-flex items-center gap-1.5', legend);
    const shape = keys?.[i] || 'line';
    const key = html('span', shape === 'line' ? 'chart-key' : 'chart-key-dot', item);
    if (shape === 'ring') key.style.boxShadow = `inset 0 0 0 1.5px ${s.color}`;
    else key.style.background = s.color;
    item.append(s.name);
  });
}

function renderTable(root, labels, series, format, caption) {
  // The wrapper, not the table, is sr-only: a wide table would otherwise widen the page on phones
  const table = html('table', '', html('div', 'sr-only', root));
  if (caption) html('caption', '', table).textContent = caption;
  const head = html('tr', '', html('thead', '', table));
  html('th', '', head).textContent = 'Label';
  for (const s of series) html('th', '', head).textContent = s.name;
  const body = html('tbody', '', table);
  labels.forEach((label, i) => {
    const row = html('tr', '', body);
    html('th', '', row).textContent = label;
    for (const s of series) html('td', '', row).textContent = format(s.values[i]);
  });
}

function tooltipContent(tooltip, title, rows) {
  tooltip.replaceChildren();
  html('div', 'label mb-2 text-fg', tooltip).textContent = title;
  for (const row of rows) {
    const line = html('div', 'flex items-center gap-2 py-0.5', tooltip);
    if (row.color) {
      // The ring keeps an ink swatch visible when the tooltip itself is ink
      const key = html('span', 'size-2 shrink-0 ring-1 ring-fg-subtle/50', line);
      key.style.background = row.color;
    }
    html('span', 'text-fg-muted', line).textContent = row.name;
    html('span', 'ml-auto pl-4 font-medium tabular-nums text-fg', line).textContent = row.value;
  }
}

function placeTooltip(tooltip, frame, x, y) {
  const width = frame.clientWidth;
  const tipWidth = tooltip.offsetWidth;
  const left = x + 16 + tipWidth > width ? x - 16 - tipWidth : x + 16;
  tooltip.style.transform = `translate(${Math.max(0, left)}px, ${Math.max(0, y)}px)`;
}

/** Shared lifecycle: re-render on resize, clean up on destroy. */
function mount(el, draw) {
  let data;
  let frameId;
  const render = () => {
    cancelAnimationFrame(frameId);
    frameId = requestAnimationFrame(() => data && draw(data));
  };
  const observer = new ResizeObserver(render);
  observer.observe(el);
  return {
    update(next) {
      data = next;
      render();
    },
    destroy() {
      observer.disconnect();
      cancelAnimationFrame(frameId);
      el.replaceChildren();
    },
  };
}

/* ------------------------------------------------------------------ */

function lineChart(el, initial) {
  const chart = mount(el, (data) => {
    const { labels, series, format = String, axisFormat = format, height = 260, caption, min = 0 } = data;
    el.replaceChildren();
    const root = html('div', 'chart', el);
    renderLegend(root, series);
    const frame = html('div', 'relative', root);
    const width = el.clientWidth;
    const plot = svg('svg', {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      tabindex: 0,
      'aria-label': caption || series.map((s) => s.name).join(', '),
    }, frame);
    const tooltip = html('div', 'chart-tooltip', frame);

    // `min` lifts the axis off zero for measures that never approach it
    const { max: span, step } = niceScale(Math.max(...series.flatMap((s) => s.values)) - min);
    const max = min + span;
    const tickLabels = [];
    for (let v = min; v <= max; v += step) tickLabels.push(v);

    const lead = series[0];
    const endLabel = format(lead.values.at(-1));
    const padLeft = Math.max(...tickLabels.map((t) => measureText(axisFormat(t), 'chart-tick', plot))) + 12;
    const padRight = measureText(endLabel, 'chart-tick', plot) + 16;
    const pad = { top: 8, right: padRight, bottom: 28, left: padLeft };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const x = (i) => pad.left + (labels.length === 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);
    const y = (v) => pad.top + innerH - ((v - min) / span) * innerH;

    // Grid and y ticks
    for (const t of tickLabels) {
      svg('line', { class: t === min ? 'chart-baseline' : 'chart-grid', x1: pad.left, x2: width - pad.right, y1: y(t), y2: y(t) }, plot);
      const label = svg('text', { class: 'chart-tick', x: pad.left - 10, y: y(t), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, plot);
      label.textContent = axisFormat(t);
    }

    // X labels, thinned so they never collide
    const every = Math.ceil(labels.length / Math.max(1, Math.floor(innerW / 48)));
    labels.forEach((l, i) => {
      if (i % every) return;
      const label = svg('text', { class: 'chart-tick', x: x(i), y: height - 8, 'text-anchor': 'middle' }, plot);
      label.textContent = l.toUpperCase();
    });

    // Series, drawn back to front so the lead series sits on top
    for (const s of [...series].reverse()) {
      const points = s.values.map((v, i) => `${x(i)},${y(v)}`);
      if (s.area) {
        svg('path', {
          d: `M${x(0)},${y(min)}L${points.join('L')}L${x(s.values.length - 1)},${y(min)}Z`,
          fill: s.color,
          'fill-opacity': 0.1,
        }, plot);
      }
      svg('path', {
        d: `M${points.join('L')}`,
        fill: 'none',
        stroke: s.color,
        'stroke-width': 2,
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      }, plot);
    }

    // Direct label on the lead series only
    const last = lead.values.length - 1;
    svg('circle', { class: 'chart-dot', cx: x(last), cy: y(lead.values[last]), r: 4, fill: lead.color }, plot);
    const end = svg('text', { class: 'chart-tick', x: x(last) + 10, y: y(lead.values[last]), 'dominant-baseline': 'middle' }, plot);
    end.textContent = endLabel;
    end.style.fill = 'var(--sp-fg)';
    end.style.fontWeight = 600;

    // Hover layer: crosshair, dots and tooltip
    const hover = svg('g', { visibility: 'hidden' }, plot);
    const crosshair = svg('line', { class: 'chart-crosshair', y1: pad.top, y2: pad.top + innerH }, hover);
    const dots = series.map((s) => svg('circle', { class: 'chart-dot', r: 4, fill: s.color }, hover));
    let active = -1;

    const show = (i) => {
      active = i;
      hover.setAttribute('visibility', 'visible');
      crosshair.setAttribute('x1', x(i));
      crosshair.setAttribute('x2', x(i));
      series.forEach((s, n) => {
        dots[n].setAttribute('cx', x(i));
        dots[n].setAttribute('cy', y(s.values[i]));
      });
      tooltipContent(tooltip, labels[i], series.map((s) => ({ name: s.name, color: s.color, value: format(s.values[i]) })));
      tooltip.dataset.show = 'true';
      placeTooltip(tooltip, frame, x(i), pad.top);
    };
    const hide = () => {
      active = -1;
      hover.setAttribute('visibility', 'hidden');
      tooltip.dataset.show = 'false';
    };

    svg('rect', { x: pad.left, y: 0, width: innerW, height, fill: 'transparent' }, plot);
    plot.addEventListener('pointermove', (e) => {
      const px = e.clientX - plot.getBoundingClientRect().left;
      const i = Math.round(((px - pad.left) / innerW) * (labels.length - 1));
      show(Math.min(labels.length - 1, Math.max(0, i)));
    });
    plot.addEventListener('pointerleave', hide);
    plot.addEventListener('blur', hide);
    plot.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const next = active < 0 ? last : active + (e.key === 'ArrowRight' ? 1 : -1);
      show(Math.min(last, Math.max(0, next)));
    });

    renderTable(root, labels, series, format, caption);
  });
  chart.update(initial);
  return chart;
}

/* ------------------------------------------------------------------ */

/** Horizontal bars, ranked. Every bar carries its value at the tip. */
function barChart(el, initial) {
  const chart = mount(el, (data) => {
    const { labels, series, format = String, caption, barSize = 12, rowHeight = 44 } = data;
    const s = series[0];
    el.replaceChildren();
    const root = html('div', 'chart', el);
    const frame = html('div', 'relative', root);
    const width = el.clientWidth;
    const height = labels.length * rowHeight;
    const plot = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': caption || s.name }, frame);
    const tooltip = html('div', 'chart-tooltip', frame);

    const total = s.values.reduce((a, b) => a + b, 0);
    const max = Math.max(...s.values);
    const valueWidth = Math.max(...s.values.map((v) => measureText(format(v), 'chart-tick', plot))) + 12;
    const track = width - valueWidth;
    const size = Math.min(barSize, 24);
    const r = Math.min(4, size / 2);

    labels.forEach((label, i) => {
      const top = i * rowHeight;
      const row = svg('g', { tabindex: 0, role: 'listitem', 'aria-label': `${label}: ${format(s.values[i])}` }, plot);
      svg('rect', { x: 0, y: top, width, height: rowHeight, fill: 'transparent' }, row);

      const name = svg('text', { class: 'chart-tick', x: 0, y: top + 14 }, row);
      name.textContent = label;
      name.style.fill = 'var(--sp-fg-muted)';
      name.style.fontSize = '12px';

      const barY = top + 22;
      const w = Math.max(r * 2, (s.values[i] / max) * track);
      // Square at the baseline, 4px round at the data end
      svg('path', {
        d: `M0,${barY}H${w - r}a${r},${r} 0 0 1 ${r},${r}V${barY + size - r}a${r},${r} 0 0 1 -${r},${r}H0Z`,
        fill: s.color,
      }, row);

      const value = svg('text', { class: 'chart-tick', x: w + 8, y: barY + size / 2, 'dominant-baseline': 'middle' }, row);
      value.textContent = format(s.values[i]);
      value.style.fill = 'var(--sp-fg)';
      value.style.fontWeight = 500;

      const show = () => {
        tooltipContent(tooltip, label, [
          { name: s.name, color: s.color, value: format(s.values[i]) },
          { name: 'Share', value: `${((s.values[i] / total) * 100).toFixed(1)}%` },
        ]);
        tooltip.dataset.show = 'true';
        placeTooltip(tooltip, frame, Math.min(w, track * 0.6), top);
      };
      const hide = () => (tooltip.dataset.show = 'false');
      row.addEventListener('pointerenter', show);
      row.addEventListener('pointerleave', hide);
      row.addEventListener('focus', show);
      row.addEventListener('blur', hide);
    });
    plot.setAttribute('role', 'list');

    renderTable(root, labels, series, format, caption);
  });
  chart.update(initial);
  return chart;
}

/* ------------------------------------------------------------------ */

/**
 * Thin vertical columns, one per period. The highlighted period (the last
 * by default) takes the accent; the rest recede. Hover or arrow keys show
 * each value.
 */
function sticks(el, initial) {
  const chart = mount(el, (data) => {
    const { labels, values, format = String, highlight = values.length - 1, height = 120, stroke = 2, caption, caps = false } = data;
    el.replaceChildren();
    const root = html('div', 'chart', el);
    const frame = html('div', 'relative', root);
    const width = el.clientWidth;
    const plot = svg('svg', {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      tabindex: 0,
      'aria-label': caption || 'Trend',
    }, frame);
    const tooltip = html('div', 'chart-tooltip', frame);

    const labelBand = 18;
    const plotH = height - labelBand;
    const max = Math.max(...values);
    const step = width / values.length;
    const x = (i) => Math.round(step * i + step / 2) + 0.5;
    const capRoom = caps ? 7 : 0;
    const top = (v) => plotH - Math.max(2, (v / max) * (plotH - capRoom));

    svg('line', { class: 'chart-baseline', x1: 0, x2: width, y1: plotH + 0.5, y2: plotH + 0.5 }, plot);
    const marks = values.map((v, i) => {
      const colour = i === highlight ? 'var(--sp-accent)' : 'var(--sp-chart-ink)';
      const g = svg('g', {}, plot);
      svg('line', { x1: x(i), x2: x(i), y1: plotH, y2: top(v), stroke: colour, 'stroke-width': i === highlight && !caps ? stroke * 2 : stroke }, g);
      // Optional circle on top of each stick, like a dial marker
      if (caps) svg('circle', { class: 'chart-dot', cx: x(i), cy: top(v), r: i === highlight ? 5 : 4, fill: colour }, g);
      return g;
    });
    labels.forEach((l, i) => {
      const t = svg('text', { class: 'chart-tick', x: x(i), y: height - 2, 'text-anchor': 'middle' }, plot);
      t.textContent = l.slice(0, 1).toUpperCase();
      if (i === highlight) t.style.fill = 'var(--sp-fg)';
    });

    let active = -1;
    const show = (i) => {
      active = i;
      marks.forEach((m, n) => m.setAttribute('opacity', n === i || i < 0 ? 1 : 0.35));
      tooltipContent(tooltip, labels[i], [{ name: caption || 'Value', value: format(values[i]) }]);
      tooltip.dataset.show = 'true';
      placeTooltip(tooltip, frame, x(i), 0);
    };
    const hide = () => {
      active = -1;
      marks.forEach((m) => m.setAttribute('opacity', 1));
      tooltip.dataset.show = 'false';
    };
    plot.addEventListener('pointermove', (e) => {
      const px = e.clientX - plot.getBoundingClientRect().left;
      show(Math.min(values.length - 1, Math.max(0, Math.floor(px / step))));
    });
    plot.addEventListener('pointerleave', hide);
    plot.addEventListener('blur', hide);
    plot.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const next = active < 0 ? highlight : active + (e.key === 'ArrowRight' ? 1 : -1);
      show(Math.min(values.length - 1, Math.max(0, next)));
    });

    renderTable(root, labels, [{ name: caption || 'Value', values }], format, caption);
  });
  chart.update(initial);
  return chart;
}

/* ------------------------------------------------------------------ */

/**
 * Two periods compared per label: a pipe from the previous value (ring)
 * to the current one (dot). The highlighted label, the last by default,
 * takes the accent. Reads the gap directly instead of two parallel lines.
 */
function dumbbell(el, initial) {
  const chart = mount(el, (data) => {
    const { labels, series, format = String, axisFormat = format, height = 260, caption, min = 0, highlight = labels.length - 1 } = data;
    const [now, before] = series;
    el.replaceChildren();
    const root = html('div', 'chart', el);
    renderLegend(root, series, ['dot', 'ring']);
    const frame = html('div', 'relative', root);
    const width = el.clientWidth;
    const plot = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', tabindex: 0, 'aria-label': caption || now.name }, frame);
    const tooltip = html('div', 'chart-tooltip', frame);

    const { max: span, step } = niceScale(Math.max(...series.flatMap((s) => s.values)) - min);
    const max = min + span;
    const ticks = [];
    for (let v = min; v <= max; v += step) ticks.push(v);
    const padLeft = Math.max(...ticks.map((t) => measureText(axisFormat(t), 'chart-tick', plot))) + 12;
    const pad = { top: 10, right: 10, bottom: 28, left: padLeft };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const band = innerW / labels.length;
    const x = (i) => Math.round(pad.left + band * i + band / 2) + 0.5;
    const y = (v) => pad.top + innerH - ((v - min) / span) * innerH;

    for (const t of ticks) {
      svg('line', { class: t === min ? 'chart-baseline' : 'chart-grid', x1: pad.left, x2: width - pad.right, y1: y(t), y2: y(t) }, plot);
      svg('text', { class: 'chart-tick', x: pad.left - 10, y: y(t), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, plot).textContent = axisFormat(t);
    }
    const every = Math.ceil(labels.length / Math.max(1, Math.floor(innerW / 40)));

    const groups = labels.map((label, i) => {
      const g = svg('g', {}, plot);
      const accent = i === highlight;
      const a = y(before.values[i]);
      const b = y(now.values[i]);
      svg('line', { x1: x(i), x2: x(i), y1: a, y2: b, stroke: 'var(--sp-chart-ink)', 'stroke-width': 2 }, g);
      svg('circle', { cx: x(i), cy: a, r: 4, fill: 'var(--sp-bg)', stroke: before.color, 'stroke-width': 1.5 }, g);
      svg('circle', { class: 'chart-dot', cx: x(i), cy: b, r: accent ? 6 : 5, fill: accent ? 'var(--sp-accent)' : now.color }, g);
      if (accent || (i % every === 0 && Math.abs(i - highlight) >= every)) {
        const t = svg('text', { class: 'chart-tick', x: x(i), y: height - 8, 'text-anchor': 'middle' }, plot);
        t.textContent = label.toUpperCase();
        if (accent) t.style.fill = 'var(--sp-fg)';
      }
      return g;
    });

    let active = -1;
    const show = (i) => {
      active = i;
      groups.forEach((g, n) => g.setAttribute('opacity', n === i ? 1 : 0.3));
      const diff = now.values[i] - before.values[i];
      tooltipContent(tooltip, labels[i], [
        { name: now.name, color: now.color, value: format(now.values[i]) },
        { name: before.name, color: 'var(--sp-bg)', value: format(before.values[i]) },
        { name: 'Change', value: `${diff >= 0 ? '+' : '-'}${format(Math.abs(diff))}` },
      ]);
      tooltip.dataset.show = 'true';
      placeTooltip(tooltip, frame, x(i), pad.top);
    };
    const hide = () => {
      active = -1;
      groups.forEach((g) => g.setAttribute('opacity', 1));
      tooltip.dataset.show = 'false';
    };
    plot.addEventListener('pointermove', (e) => {
      const px = e.clientX - plot.getBoundingClientRect().left;
      show(Math.min(labels.length - 1, Math.max(0, Math.floor((px - pad.left) / band))));
    });
    plot.addEventListener('pointerleave', hide);
    plot.addEventListener('blur', hide);
    plot.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const next = active < 0 ? highlight : active + (e.key === 'ArrowRight' ? 1 : -1);
      show(Math.min(labels.length - 1, Math.max(0, next)));
    });

    renderTable(root, labels, series, format, caption);
  });
  chart.update(initial);
  return chart;
}

/* ------------------------------------------------------------------ */

/**
 * A strip of fine vertical pipes, filled in ink up to `value` (0 to 1),
 * like a level meter or a speaker grille. Decorative: pair it with the
 * figure it illustrates.
 */
function meter(el, initial) {
  const chart = mount(el, (data) => {
    const { value, height = 14, pitch = 5, stroke = 2 } = data;
    el.replaceChildren();
    const width = el.clientWidth;
    const count = Math.max(1, Math.floor((width + pitch - stroke) / pitch));
    const filled = Math.round(Math.min(1, Math.max(0, value)) * count);
    const plot = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true', class: 'block' }, el);
    for (let i = 0; i < count; i++) {
      const x = i * pitch + stroke / 2;
      svg('line', { x1: x, x2: x, y1: 0, y2: height, stroke: i < filled ? 'var(--sp-chart-ink)' : 'var(--sp-chart-empty)', 'stroke-width': stroke }, plot);
    }
  });
  chart.update(initial);
  return chart;
}

/* ------------------------------------------------------------------ */

const DOT_STATES = {
  hit: { label: 'Target hit', fill: 'var(--sp-chart-ink)' },
  miss: { label: 'Missed', fill: 'var(--sp-chart-empty)' },
  today: { label: 'Today', fill: 'var(--sp-accent)' },
  future: { label: 'To come', ring: 'var(--sp-chart-empty)' },
};

/**
 * Calendar of dots, Monday first. `offset` is the weekday index (0 = Mon)
 * of the first day. Each day has a state from DOT_STATES (override with
 * `states`) and a value shown on hover or focus.
 */
function dotMatrix(el, initial) {
  const chart = mount(el, (data) => {
    const { days, offset = 0, format = String, caption, states = DOT_STATES, weekdays = 'MTWTFSS' } = data;
    el.replaceChildren();
    const root = html('div', 'chart', el);
    const frame = html('div', 'relative', root);
    const grid = html('div', 'grid grid-cols-7 gap-x-2 gap-y-2', frame);
    grid.setAttribute('role', 'list');
    if (caption) grid.setAttribute('aria-label', caption);
    const tooltip = html('div', 'chart-tooltip', frame);

    for (const d of weekdays) {
      const head = html('span', 'chart-tick label pb-1 text-center text-fg-subtle', grid);
      head.textContent = d;
      head.setAttribute('aria-hidden', 'true');
    }
    for (let i = 0; i < offset; i++) html('span', '', grid).setAttribute('aria-hidden', 'true');

    for (const day of days) {
      const state = states[day.state];
      const dot = html('span', 'mx-auto aspect-square w-full max-w-8 rounded-full outline-offset-2', grid);
      dot.style.background = state.fill || 'transparent';
      if (state.ring) dot.style.boxShadow = `inset 0 0 0 1.5px ${state.ring}`;
      dot.tabIndex = 0;
      dot.setAttribute('role', 'listitem');
      const valueText = day.value == null ? state.label : `${format(day.value)}, ${state.label.toLowerCase()}`;
      dot.setAttribute('aria-label', `${day.label}: ${valueText}`);

      const show = () => {
        tooltipContent(tooltip, day.label, [
          { name: 'Status', value: state.label },
          ...(day.value == null ? [] : [{ name: 'Orders', value: format(day.value) }]),
        ]);
        tooltip.dataset.show = 'true';
        placeTooltip(tooltip, frame, dot.offsetLeft + dot.offsetWidth / 2, dot.offsetTop + dot.offsetHeight + 4);
      };
      const hide = () => (tooltip.dataset.show = 'false');
      dot.addEventListener('pointerenter', show);
      dot.addEventListener('pointerleave', hide);
      dot.addEventListener('focus', show);
      dot.addEventListener('blur', hide);
    }

    const used = new Set(days.map((d) => d.state));
    const legend = html('div', 'chart-legend mt-5', root);
    for (const [key, state] of Object.entries(states)) {
      if (!used.has(key)) continue;
      const item = html('span', 'inline-flex items-center gap-2', legend);
      const swatch = html('span', 'chart-key-dot', item);
      swatch.style.background = state.fill || 'transparent';
      if (state.ring) swatch.style.boxShadow = `inset 0 0 0 1.5px ${state.ring}`;
      item.append(state.label);
    }
  });
  chart.update(initial);
  return chart;
}

/* ------------------------------------------------------------------ */

/** Twelve-point trend for stat tiles: muted line, current value in the accent. */
function sparkline(el, initial) {
  const chart = mount(el, (data) => {
    const { values, color = 'var(--sp-chart-ink)', height = 36, target } = data;
    el.replaceChildren();
    const width = el.clientWidth;
    const plot = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, 'aria-hidden': 'true', class: 'block overflow-visible' }, el);
    // A target, if given, is part of the scale so its rule always shows
    const domain = target == null ? values : [...values, target];
    const min = Math.min(...domain);
    const range = Math.max(...domain) - min || 1;
    const x = (i) => 4 + (i / (values.length - 1)) * (width - 8);
    const y = (v) => 4 + (1 - (v - min) / range) * (height - 8);
    if (target != null) svg('line', { x1: 0, x2: width, y1: y(target), y2: y(target), stroke: 'var(--sp-chart-grid)', 'stroke-width': 1, 'stroke-dasharray': '3 3' }, plot);
    svg('path', {
      d: `M${values.map((v, i) => `${x(i)},${y(v)}`).join('L')}`,
      fill: 'none',
      stroke: 'var(--sp-chart-muted)',
      'stroke-width': 2,
      'stroke-linejoin': 'round',
      'stroke-linecap': 'round',
    }, plot);
    const last = values.length - 1;
    svg('circle', { class: 'chart-dot', cx: x(last), cy: y(values[last]), r: 4, fill: color }, plot);
  });
  chart.update(initial);
  return chart;
}

/* ------------------------------------------------------------------ */
/* Instruments: dial, heat grid, funnel, dotted line, grille            */
/* ------------------------------------------------------------------ */

/** Point on a circle: 0 degrees is straight up, angles run clockwise */
function polar(cx, cy, r, deg) {
  const a = ((deg - 90) * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
}

const reducedMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

/** "2.6%" gives ["2", ".6%"], so decimals and units can be set dimmer */
function splitNumber(text) {
  const match = String(text).match(/^(.*?\d)((?:\.\d+)?[^\d]*)$/);
  return match ? [match[1], match[2]] : [String(text), ''];
}

/**
 * Tuner dial, after the Braun radio scale: a 240 degree arc with numbered
 * major ticks, a pointer on a small knob, and the target as an ink notch
 * outside the arc. Ticks up to the value are ink and the rest recede. The
 * pointer is the only accent, and it sweeps from its last reading when the
 * value changes. `ticks` is the number of numbered divisions, `minor` the
 * steps within each.
 */
function dial(el, initial) {
  let lastAngle;
  const chart = mount(el, (data) => {
    const {
      value,
      min = 0,
      max = 100,
      target,
      format = String,
      tickFormat = format,
      gapFormat = (d) => `${d >= 0 ? '+' : '-'}${format(Math.abs(d))}`,
      caption,
      label = 'Value',
      ticks = 10,
      minor = 5,
      size: maxSize = 300,
    } = data;
    el.replaceChildren();
    const root = html('div', 'chart', el);
    const frame = html('div', 'relative mx-auto', root);
    const size = Math.max(180, Math.min(el.clientWidth, maxSize));
    frame.style.maxWidth = `${size}px`;
    const R = size / 2 - 14;
    const cx = size / 2;
    const cy = R + 14;
    const height = Math.ceil(cy + R * 0.8);
    const summary = `${caption || label}: ${format(value)}${target == null ? '' : `, target ${format(target)}`}`;
    const plot = svg('svg', { width: size, height, viewBox: `0 0 ${size} ${height}`, role: 'img', tabindex: 0, 'aria-label': summary }, frame);
    const tooltip = html('div', 'chart-tooltip', frame);

    const sweep = 240;
    const clamp = (v) => Math.min(max, Math.max(min, v));
    const angle = (v) => -sweep / 2 + ((clamp(v) - min) / (max - min)) * sweep;

    // The scale: one ink arc, then ticks inside it
    const [ax, ay] = polar(cx, cy, R, -sweep / 2);
    const [bx, by] = polar(cx, cy, R, sweep / 2);
    svg('path', { d: `M${ax},${ay}A${R},${R} 0 1 1 ${bx},${by}`, fill: 'none', stroke: 'var(--sp-rule)', 'stroke-width': 1 }, plot);

    const total = ticks * minor;
    const labelSize = Math.max(9, Math.min(11, size / 26));
    for (let i = 0; i <= total; i++) {
      const v = min + ((max - min) * i) / total;
      const major = i % minor === 0;
      const a = angle(v);
      const [x1, y1] = polar(cx, cy, R - 4, a);
      const [x2, y2] = polar(cx, cy, R - (major ? 15 : 9), a);
      const lit = v <= value + (max - min) * 1e-9;
      svg('line', { x1, y1, x2, y2, stroke: lit ? 'var(--sp-chart-ink)' : 'var(--sp-chart-muted)', 'stroke-width': major ? 1.5 : 1 }, plot);
      if (major) {
        const [tx, ty] = polar(cx, cy, R - 28, a);
        const t = svg('text', { class: 'chart-tick', x: tx, y: ty, 'text-anchor': 'middle', 'dominant-baseline': 'central' }, plot);
        t.textContent = tickFormat(v);
        t.style.fontSize = `${labelSize}px`;
      }
    }

    // Target: an ink notch pointing in at the arc
    if (target != null) {
      const a = angle(target);
      const tip = polar(cx, cy, R + 2, a);
      const left = polar(cx, cy, R + 12, a - 3.4);
      const right = polar(cx, cy, R + 12, a + 3.4);
      svg('path', { d: `M${tip}L${left}L${right}Z`, fill: 'var(--sp-chart-ink)' }, plot);
    }

    // Pointer, drawn upright and rotated, so it can sweep to a new reading
    const knob = Math.max(9, R * 0.1);
    const pointer = svg('g', {}, plot);
    svg('line', { x1: cx, y1: cy + knob * 1.8, x2: cx, y2: cy - R + 7, stroke: 'var(--sp-accent)', 'stroke-width': 2 }, pointer);
    const to = angle(value);
    pointer.style.transformOrigin = `${cx}px ${cy}px`;
    pointer.style.transform = `rotate(${lastAngle ?? to}deg)`;
    if (lastAngle !== undefined && lastAngle !== to && !reducedMotion()) {
      pointer.getBoundingClientRect();
      pointer.style.transition = 'transform 700ms cubic-bezier(0.3, 0.7, 0.2, 1)';
    }
    pointer.style.transform = `rotate(${to}deg)`;
    lastAngle = to;

    svg('circle', { cx, cy, r: knob, fill: 'var(--sp-bg)', stroke: 'var(--sp-rule)', 'stroke-width': 1.5 }, plot);
    svg('circle', { cx, cy, r: 2.5, fill: 'var(--sp-chart-ink)' }, plot);

    // The reading, in the gap at the foot of the arc
    const [whole, rest] = splitNumber(format(value));
    const figure = svg('text', { x: cx, y: cy + R * 0.72, 'text-anchor': 'middle', 'aria-hidden': 'true' }, plot);
    Object.assign(figure.style, { fill: 'var(--sp-fg)', fontSize: `${Math.round(size * 0.15)}px`, fontWeight: 500, letterSpacing: '-0.035em' });
    figure.textContent = whole;
    if (rest) svg('tspan', { fill: 'var(--sp-dim)' }, figure).textContent = rest;

    const show = () => {
      const rows = [{ name: 'Reading', value: format(value) }];
      if (target != null) rows.push({ name: 'Target', value: format(target) }, { name: 'Against target', value: gapFormat(value - target) });
      tooltipContent(tooltip, label, rows);
      tooltip.dataset.show = 'true';
      // Sit below the knob, clear of the pointer and the scale
      placeTooltip(tooltip, frame, to > 0 ? cx - 40 : cx - 16, cy + knob + 8);
    };
    const hide = () => (tooltip.dataset.show = 'false');
    plot.addEventListener('pointerenter', show);
    plot.addEventListener('pointerleave', hide);
    plot.addEventListener('focus', show);
    plot.addEventListener('blur', hide);

    const tableSeries = [{ name: label, values: [value] }];
    if (target != null) tableSeries.push({ name: 'Target', values: [target] });
    renderTable(root, [caption || label], tableSeries, format, caption);
  });
  chart.update(initial);
  return chart;
}

/* ------------------------------------------------------------------ */

/**
 * A grille of dots, one per row and column (weekday by hour, say). Dot
 * area follows the value, so the busy hours read as the dense part of a
 * speaker grille; empty cells keep a faint dot. `highlight` is a
 * [row, col] pair drawn in the accent, such as this hour. Row totals sit
 * at the right (`totals`), and thin sticks above the grille give each
 * column's total (`columnBars`). Hover or arrow keys read each cell.
 */
function heatgrid(el, initial) {
  const chart = mount(el, (data) => {
    const {
      rows,
      cols,
      values,
      format = String,
      tickFormat = (c) => c,
      caption,
      name = 'Value',
      highlight,
      highlightLabel = 'Now',
      emptyLabel = 'None',
      maxCell = 32,
      totals = true,
      totalsLabel,
      columnBars = true,
      columnLabel = (c) => `${cols[c]} total`,
      title = (r, c) => `${rows[r]} ${cols[c]}`,
    } = data;
    el.replaceChildren();
    const root = html('div', 'chart', el);
    const frame = html('div', 'relative', root);
    const width = el.clientWidth;
    const plot = svg('svg', { role: 'img', tabindex: 0, 'aria-label': caption || name }, frame);
    const tooltip = html('div', 'chart-tooltip', frame);

    const rowTotals = values.map((row) => row.reduce((a, v) => a + (v || 0), 0));
    const colTotals = cols.map((_, c) => values.reduce((a, row) => a + (row[c] || 0), 0));
    const padLeft = Math.max(...rows.map((r) => measureText(r.toUpperCase(), 'chart-tick', plot))) + 12;
    const widest = [...rowTotals.map((t) => format(t)), totalsLabel ? totalsLabel.toUpperCase() : ''];
    const padRight = totals ? Math.max(...widest.map((t) => measureText(t, 'chart-tick', plot))) + 14 : 0;
    const cell = Math.min(maxCell, (width - padLeft - padRight) / cols.length);
    const gridW = cell * cols.length;
    const labelBand = 22;
    // Optional histogram of column totals above the grille, aligned to its columns
    const band = columnBars ? Math.round(Math.max(36, cell * 2.25)) + 10 : 0;
    const height = Math.ceil(band + cell * rows.length + labelBand);
    plot.setAttribute('width', width);
    plot.setAttribute('height', height);
    plot.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const top = Math.max(1, ...values.flat().filter((v) => v != null));
    const maxR = cell * 0.42;
    const emptyR = Math.max(1.25, cell * 0.08);
    const radius = (v) => (!v ? emptyR : Math.max(emptyR + 0.75, maxR * Math.sqrt(v / top)));
    const cx = (c) => padLeft + c * cell + cell / 2;
    const cy = (r) => band + r * cell + cell / 2;
    const isHighlight = (r, c) => highlight && highlight[0] === r && highlight[1] === c;

    if (columnBars) {
      const topTotal = Math.max(1, ...colTotals);
      const base = band - 10;
      svg('line', { class: 'chart-baseline', x1: padLeft, x2: padLeft + gridW, y1: base + 0.5, y2: base + 0.5 }, plot);
      colTotals.forEach((t, c) => {
        if (!t) return;
        const x = Math.round(cx(c)) + 0.5;
        svg('line', { x1: x, x2: x, y1: base, y2: base - Math.max(1, (t / topTotal) * (base - 2)), stroke: 'var(--sp-chart-ink)', 'stroke-width': 2 }, plot);
      });
      const t = svg('text', { class: 'chart-tick', x: 0, y: base, 'dominant-baseline': 'text-after-edge' }, plot);
      t.textContent = 'ALL';
    }
    // Heading over the row totals, level with the ALL label
    if (totals && totalsLabel) {
      const h = svg('text', { class: 'chart-tick', x: width, y: columnBars ? band - 10 : band, 'text-anchor': 'end', 'dominant-baseline': 'text-after-edge' }, plot);
      h.textContent = totalsLabel.toUpperCase();
    }

    rows.forEach((row, r) => {
      const t = svg('text', { class: 'chart-tick', x: 0, y: cy(r), 'dominant-baseline': 'middle' }, plot);
      t.textContent = row.toUpperCase();
      if (highlight && highlight[0] === r) t.style.fill = 'var(--sp-fg)';
      values[r].forEach((v, c) => {
        const fill = isHighlight(r, c) ? 'var(--sp-accent)' : v ? 'var(--sp-chart-ink)' : 'var(--sp-chart-empty)';
        svg('circle', { cx: cx(c), cy: cy(r), r: isHighlight(r, c) ? Math.max(radius(v), emptyR + 2) : radius(v), fill }, plot);
      });
      if (totals) {
        const total = svg('text', { class: 'chart-tick', x: width, y: cy(r), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, plot);
        total.textContent = format(rowTotals[r]);
        total.style.fill = 'var(--sp-fg-muted)';
      }
    });

    const every = Math.ceil(cols.length / Math.max(1, Math.floor(gridW / 30)));
    cols.forEach((col, c) => {
      if (c % every) return;
      const t = svg('text', { class: 'chart-tick', x: cx(c), y: height - 4, 'text-anchor': 'middle' }, plot);
      t.textContent = tickFormat(col);
    });

    const ring = svg('circle', { r: maxR + 3, fill: 'none', stroke: 'var(--sp-fg)', 'stroke-width': 1, visibility: 'hidden' }, plot);
    let active = null;
    const show = (r, c) => {
      active = [r, c];
      ring.setAttribute('cx', cx(c));
      ring.setAttribute('cy', cy(r));
      ring.setAttribute('visibility', 'visible');
      const v = values[r][c];
      const rowsOut = [{ name, value: v ? format(v) : emptyLabel }];
      if (totals) rowsOut.push({ name: `${rows[r]} total`, value: format(rowTotals[r]) });
      if (columnBars) rowsOut.push({ name: columnLabel(c), value: format(colTotals[c]) });
      if (isHighlight(r, c)) rowsOut.push({ name: highlightLabel, value: '' });
      tooltipContent(tooltip, title(r, c), rowsOut);
      tooltip.dataset.show = 'true';
      placeTooltip(tooltip, frame, cx(c), cy(r) + maxR + 6);
    };
    const hide = () => {
      active = null;
      ring.setAttribute('visibility', 'hidden');
      tooltip.dataset.show = 'false';
    };
    plot.addEventListener('pointermove', (e) => {
      const box = plot.getBoundingClientRect();
      const c = Math.floor((e.clientX - box.left - padLeft) / cell);
      const r = Math.floor((e.clientY - box.top - band) / cell);
      if (c < 0 || c >= cols.length || r < 0 || r >= rows.length) return hide();
      show(r, c);
    });
    plot.addEventListener('pointerleave', hide);
    plot.addEventListener('blur', hide);
    plot.addEventListener('keydown', (e) => {
      const moves = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
      if (!moves[e.key]) return;
      e.preventDefault();
      const [r, c] = active || highlight || [0, 0];
      const [dr, dc] = active ? moves[e.key] : [0, 0];
      show(Math.min(rows.length - 1, Math.max(0, r + dr)), Math.min(cols.length - 1, Math.max(0, c + dc)));
    });

    // Legend: the size scale, the empty dot and the highlight
    const legend = html('div', 'chart-legend mt-4', root);
    const scale = html('span', 'inline-flex items-center gap-2', legend);
    scale.append('Fewer');
    const keys = svg('svg', { width: 60, height: 12, 'aria-hidden': 'true' }, scale);
    keys.style.width = '60px';
    [0.08, 0.3, 0.62, 1].forEach((f, i) => svg('circle', { cx: 6 + i * 16, cy: 6, r: Math.max(1.5, 5.5 * Math.sqrt(f)), fill: 'var(--sp-chart-ink)' }, keys));
    scale.append('More');
    const none = html('span', 'inline-flex items-center gap-2', legend);
    html('span', 'inline-block size-1.5 rounded-full bg-(--sp-chart-empty)', none);
    none.append(emptyLabel);
    if (highlight) {
      const now = html('span', 'inline-flex items-center gap-2', legend);
      html('span', 'chart-key-dot bg-accent', now);
      now.append(highlightLabel);
    }

    renderTable(root, rows, cols.map((col, c) => ({ name: col, values: values.map((row) => row[c]) })), (v) => (v == null ? '' : format(v)), caption);
  });
  chart.update(initial);
  return chart;
}

/* ------------------------------------------------------------------ */

/**
 * A stepped funnel drawn in pipes. Each step is a column of fine vertical
 * pipes: ink up to the count that reached it, faint above that up to the
 * step before, so the faint part is exactly what dropped away. Figures
 * sit above each column, labels and the carry-on rate below.
 */
function funnel(el, initial) {
  const chart = mount(el, (data) => {
    const {
      steps,
      format = String,
      tooltipFormat = format,
      caption,
      name = 'Count',
      height = 160,
      pitch = 4,
      stroke = 2,
      keys = ['Reached the step', 'Dropped before it'],
    } = data;
    el.replaceChildren();
    const root = html('div', 'chart', el);
    const legend = html('div', 'chart-legend mb-6', root);
    [['var(--sp-chart-ink)', keys[0]], ['var(--sp-chart-empty)', keys[1]]].forEach(([colour, text]) => {
      const item = html('span', 'inline-flex items-center gap-2', legend);
      const key = html('span', 'inline-block h-3 w-3.5', item);
      key.style.background = `repeating-linear-gradient(90deg, ${colour} 0 2px, transparent 2px 4px)`;
      item.append(text);
    });
    const frame = html('div', 'relative', root);
    const grid = html('div', 'grid gap-x-2 sm:gap-x-4', frame);
    grid.style.gridTemplateColumns = `repeat(${steps.length}, minmax(0, 1fr))`;
    grid.setAttribute('role', 'list');
    if (caption) grid.setAttribute('aria-label', caption);
    const tooltip = html('div', 'chart-tooltip', frame);

    const first = steps[0].value;
    const pct = (v) => `${(v * 100).toFixed(v < 0.1 ? 1 : 0)}%`;
    const cols = steps.map((step, i) => {
      const prev = i ? steps[i - 1].value : step.value;
      const col = html('div', 'min-w-0 outline-offset-4', grid);
      col.tabIndex = 0;
      col.setAttribute('role', 'listitem');
      col.setAttribute('aria-label', `${step.label}: ${tooltipFormat(step.value)}${i ? `, ${pct(step.value / prev)} of the step before` : ''}`);
      html('p', 'figure text-lg min-[480px]:text-2xl sm:text-3xl', col).textContent = format(step.value);

      const box = html('div', 'mt-4', col);
      const w = box.clientWidth;
      const plot = svg('svg', { width: w, height, viewBox: `0 0 ${w} ${height}`, 'aria-hidden': 'true' }, box);
      const count = Math.max(1, Math.floor((w + pitch - stroke) / pitch));
      const reach = Math.max(2, (step.value / first) * height);
      const was = Math.max(reach, (prev / first) * height);
      for (let n = 0; n < count; n++) {
        const x = n * pitch + stroke / 2;
        if (was > reach) svg('line', { x1: x, x2: x, y1: height - was, y2: height - reach, stroke: 'var(--sp-chart-empty)', 'stroke-width': stroke }, plot);
        svg('line', { x1: x, x2: x, y1: height - reach, y2: height, stroke: 'var(--sp-chart-ink)', 'stroke-width': stroke }, plot);
      }

      html('p', 'mt-3 text-xs leading-snug text-fg', col).textContent = step.label;
      const rate = html('p', 'mt-1 text-xs tabular-nums text-fg-muted', col);
      rate.textContent = i ? `${pct(step.value / prev)} of previous` : ' ';
      if (i) rate.title = 'Share of the step before';
      return { col, box, prev };
    });

    const show = (i) => {
      const { col, box, prev } = cols[i];
      const step = steps[i];
      const rows = [{ name, value: tooltipFormat(step.value) }];
      if (i) {
        rows.push(
          { name: 'Of the step before', value: pct(step.value / prev) },
          { name: `Of ${steps[0].label.toLowerCase()}`, value: pct(step.value / first) },
          { name: 'Dropped', value: tooltipFormat(prev - step.value) },
        );
      }
      tooltipContent(tooltip, step.label, rows);
      tooltip.dataset.show = 'true';
      placeTooltip(tooltip, frame, col.offsetLeft + col.offsetWidth / 2, box.offsetTop);
    };
    const hide = () => (tooltip.dataset.show = 'false');
    cols.forEach(({ col }, i) => {
      col.addEventListener('pointerenter', () => show(i));
      col.addEventListener('pointerleave', hide);
      col.addEventListener('focus', () => show(i));
      col.addEventListener('blur', hide);
    });

    renderTable(root, steps.map((s) => s.label), [{ name, values: steps.map((s) => s.value) }], tooltipFormat, caption);
  });
  chart.update(initial);
  return chart;
}

/* ------------------------------------------------------------------ */

/**
 * A line drawn as evenly spaced dots, like a row of grille holes. The
 * lead series is ink, the comparison muted; when points are far enough
 * apart the lead also gets a bead at each value. The highlighted point
 * (the last by default) takes the accent, and the last value is labelled
 * directly. Hover or arrow keys read every series at a point.
 */
function dotline(el, initial) {
  const chart = mount(el, (data) => {
    const { labels, series, format = String, axisFormat = format, height = 260, caption, min = 0, highlight = labels.length - 1, pitch = 6 } = data;
    el.replaceChildren();
    const root = html('div', 'chart', el);
    renderLegend(root, series, series.map(() => 'dot'));
    const frame = html('div', 'relative', root);
    const width = el.clientWidth;
    const plot = svg('svg', {
      width,
      height,
      viewBox: `0 0 ${width} ${height}`,
      role: 'img',
      tabindex: 0,
      'aria-label': caption || series.map((s) => s.name).join(', '),
    }, frame);
    const tooltip = html('div', 'chart-tooltip', frame);

    const { max: span, step } = niceScale(Math.max(...series.flatMap((s) => s.values)) - min);
    const max = min + span;
    const ticks = [];
    for (let v = min; v <= max; v += step) ticks.push(v);

    const lead = series[0];
    const last = lead.values.length - 1;
    const endLabel = format(lead.values[last]);
    const padLeft = Math.max(...ticks.map((t) => measureText(axisFormat(t), 'chart-tick', plot))) + 12;
    const padRight = measureText(endLabel, 'chart-tick', plot) + 16;
    const pad = { top: 10, right: padRight, bottom: 28, left: padLeft };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const x = (i) => pad.left + (labels.length === 1 ? innerW / 2 : (i / (labels.length - 1)) * innerW);
    const y = (v) => pad.top + innerH - ((v - min) / span) * innerH;

    for (const t of ticks) {
      svg('line', { class: t === min ? 'chart-baseline' : 'chart-grid', x1: pad.left, x2: width - pad.right, y1: y(t), y2: y(t) }, plot);
      const label = svg('text', { class: 'chart-tick', x: pad.left - 10, y: y(t), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, plot);
      label.textContent = axisFormat(t);
    }
    const every = Math.ceil(labels.length / Math.max(1, Math.floor(innerW / 56)));
    labels.forEach((l, i) => {
      if (i % every && i !== highlight) return;
      if (i !== highlight && Math.abs(i - highlight) < every) return;
      const t = svg('text', { class: 'chart-tick', x: x(i), y: height - 8, 'text-anchor': 'middle' }, plot);
      t.textContent = l.toUpperCase();
      if (i === highlight) t.style.fill = 'var(--sp-fg)';
    });

    // A zero-length dash with round caps leaves one dot every `pitch` pixels
    for (const [n, s] of [...series.entries()].reverse()) {
      svg('path', {
        d: `M${s.values.map((v, i) => `${x(i)},${y(v)}`).join('L')}`,
        fill: 'none',
        stroke: s.color,
        'stroke-width': n === 0 ? 3 : 2.5,
        'stroke-linecap': 'round',
        'stroke-linejoin': 'round',
        'stroke-dasharray': `0 ${pitch}`,
      }, plot);
    }
    if (labels.length > 1 && innerW / (labels.length - 1) >= 36) {
      lead.values.forEach((v, i) => i !== highlight && svg('circle', { class: 'chart-dot', cx: x(i), cy: y(v), r: 3, fill: lead.color }, plot));
    }
    svg('circle', { class: 'chart-dot', cx: x(highlight), cy: y(lead.values[highlight]), r: 5, fill: 'var(--sp-accent)' }, plot);
    const end = svg('text', { class: 'chart-tick', x: x(last) + 10, y: y(lead.values[last]), 'dominant-baseline': 'middle' }, plot);
    end.textContent = endLabel;
    end.style.fill = 'var(--sp-fg)';
    end.style.fontWeight = 600;

    const hover = svg('g', { visibility: 'hidden' }, plot);
    const crosshair = svg('line', { class: 'chart-crosshair', y1: pad.top, y2: pad.top + innerH }, hover);
    const rings = series.map((s) => svg('circle', { r: 5, fill: 'var(--sp-bg)', stroke: s.color, 'stroke-width': 2 }, hover));
    let active = -1;
    const show = (i) => {
      active = i;
      hover.setAttribute('visibility', 'visible');
      crosshair.setAttribute('x1', x(i));
      crosshair.setAttribute('x2', x(i));
      series.forEach((s, n) => {
        rings[n].setAttribute('cx', x(i));
        rings[n].setAttribute('cy', y(s.values[i]));
      });
      tooltipContent(tooltip, labels[i], series.map((s) => ({ name: s.name, color: s.color, value: format(s.values[i]) })));
      tooltip.dataset.show = 'true';
      placeTooltip(tooltip, frame, x(i), pad.top);
    };
    const hide = () => {
      active = -1;
      hover.setAttribute('visibility', 'hidden');
      tooltip.dataset.show = 'false';
    };
    svg('rect', { x: pad.left, y: 0, width: innerW, height, fill: 'transparent' }, plot);
    plot.addEventListener('pointermove', (e) => {
      const px = e.clientX - plot.getBoundingClientRect().left;
      const i = Math.round(((px - pad.left) / innerW) * (labels.length - 1));
      show(Math.min(last, Math.max(0, i)));
    });
    plot.addEventListener('pointerleave', hide);
    plot.addEventListener('blur', hide);
    plot.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const next = active < 0 ? highlight : active + (e.key === 'ArrowRight' ? 1 : -1);
      show(Math.min(last, Math.max(0, next)));
    });

    renderTable(root, labels, series, format, caption);
  });
  chart.update(initial);
  return chart;
}

/* ------------------------------------------------------------------ */

/**
 * Round speaker grille: dots in concentric rings (1, 6, 12, 18 ...) lit
 * in ink from the centre outwards, one dot per unit of `value`. A live
 * count reads as a level at a glance. Pair it with its figure; the value
 * is also written to a hidden table.
 */
function grille(el, initial) {
  const chart = mount(el, (data) => {
    const { value, rings = 5, caption = 'Value', format = String, size: maxSize = 176 } = data;
    el.replaceChildren();
    const root = html('div', 'chart', el);
    const size = Math.min(el.clientWidth || maxSize, maxSize);
    const plot = svg('svg', { width: size, height: size, viewBox: `0 0 ${size} ${size}`, 'aria-hidden': 'true' }, root);
    plot.style.width = `${size}px`;
    const c = size / 2;
    const gap = (size / 2 - 3) / (rings + 0.35);
    const r = gap * 0.3;
    let n = 0;
    for (let k = 0; k <= rings; k++) {
      const count = k === 0 ? 1 : 6 * k;
      for (let j = 0; j < count; j++) {
        const [cx, cy] = k === 0 ? [c, c] : polar(c, c, k * gap, (j / count) * 360);
        svg('circle', { cx, cy, r, fill: n < value ? 'var(--sp-chart-ink)' : 'var(--sp-chart-empty)' }, plot);
        n++;
      }
    }
    renderTable(root, [caption], [{ name: 'Value', values: [value] }], format, caption);
  });
  chart.update(initial);
  return chart;
}

/* ------------------------------------------------------------------ */

/**
 * A bridge from one balance to the next, such as a month's revenue
 * movements. The start and end are solid ink columns and each step
 * floats from the running total: rises are filled with fine pipes, falls
 * are outlined, and every step carries a signed label, so direction never
 * rests on colour alone. The end value alone takes the accent, as a cap
 * on its column. When the steps are small beside the balance the axis
 * starts above zero, and the balance columns show a break to say so.
 * Hover or arrow keys read each column.
 */
function waterfall(el, initial) {
  const chart = mount(el, (data) => {
    const {
      start,
      steps,
      format = String,
      signedFormat = (v) => `${v >= 0 ? '+' : '-'}${format(Math.abs(v))}`,
      axisFormat = format,
      shortFormat,
      caption,
      name = 'Value',
      startLabel = 'Start',
      endLabel = 'End',
      height = 260,
      pitch = 4,
      stroke = 2,
      keys = ['Rise', 'Fall', 'Balance'],
    } = data;
    const end = data.end ?? steps.reduce((t, s) => t + s.value, start);
    el.replaceChildren();
    const root = html('div', 'chart', el);

    // The opening balance, each step from the running total, then the closing balance
    let running = start;
    const cols = [{ kind: 'balance', label: startLabel, short: data.startShort, to: start, value: start }];
    for (const s of steps) {
      cols.push({ kind: s.value >= 0 ? 'rise' : 'fall', label: s.label, short: s.short, from: running, to: running + s.value, value: s.value });
      running += s.value;
    }
    cols.push({ kind: 'balance', label: endLabel, short: data.endShort, to: end, value: end, last: true });

    // The axis lifts off zero when the steps would otherwise be slivers
    const levels = cols.flatMap((c) => [c.to, c.from ?? c.to]);
    const lo = Math.min(...levels);
    const hi = Math.max(...levels);
    const { step } = niceScale(Math.max(hi - lo, hi * 0.02), 4);
    let floor = data.min ?? Math.max(0, Math.floor(lo / step) * step - step);
    if (data.min == null && floor < hi * 0.4) floor = 0;
    const top = Math.ceil(hi / step) * step;
    const broken = floor > 0;

    // Legend: pipes rise, outlines fall, solid ink for the balances
    const legend = html('div', 'chart-legend mb-6', root);
    const keyShapes = [
      (k) => (k.style.background = 'repeating-linear-gradient(90deg, var(--sp-chart-ink) 0 2px, transparent 2px 4px)'),
      (k) => (k.style.boxShadow = 'inset 0 0 0 1.5px var(--sp-chart-ink)'),
      (k) => (k.style.background = 'var(--sp-chart-ink)'),
    ];
    keys.forEach((text, i) => {
      const item = html('span', 'inline-flex items-center gap-2', legend);
      keyShapes[i](html('span', 'inline-block h-3 w-3.5', item));
      item.append(text);
    });
    if (broken) {
      const item = html('span', 'inline-flex items-center gap-2 normal-case tracking-normal text-fg-subtle', legend);
      item.textContent = `Axis starts at ${axisFormat(floor)}`;
    }

    const frame = html('div', 'relative', root);
    const width = el.clientWidth;
    const plot = svg('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', tabindex: 0, 'aria-label': caption || name }, frame);
    const tooltip = html('div', 'chart-tooltip', frame);

    const ticks = [];
    for (let v = floor; v <= top + step * 1e-9; v += step) ticks.push(v);
    const padLeft = Math.max(...ticks.map((t) => measureText(axisFormat(t), 'chart-tick', plot))) + 12;
    const pad = { top: 22, right: 0, bottom: 26, left: padLeft };
    const innerW = width - pad.left - pad.right;
    const innerH = height - pad.top - pad.bottom;
    const band = innerW / cols.length;
    const colW = Math.max(8, Math.min(64, band * 0.58));
    const cx = (i) => pad.left + band * i + band / 2;
    const y = (v) => pad.top + innerH - ((v - floor) / (top - floor)) * innerH;
    const base = y(floor);

    for (const t of ticks) {
      svg('line', { class: t === floor ? 'chart-baseline' : 'chart-grid', x1: pad.left, x2: width, y1: y(t), y2: y(t) }, plot);
      svg('text', { class: 'chart-tick', x: pad.left - 10, y: y(t), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, plot).textContent = axisFormat(t);
    }

    // Dotted connectors carry the running total from one column to the next
    cols.forEach((c, i) => {
      if (i === cols.length - 1) return;
      const level = Math.round(y(c.to)) + 0.5;
      svg('line', { x1: cx(i) + colW / 2, x2: cx(i + 1) - colW / 2, y1: level, y2: level, stroke: 'var(--sp-chart-muted)', 'stroke-width': 1, 'stroke-dasharray': '1 3' }, plot);
    });

    const fits = (text) => measureText(text, 'chart-tick', plot) <= band - 4;
    const marks = cols.map((c, i) => {
      const g = svg('g', {}, plot);
      const x0 = cx(i) - colW / 2;
      let upper;
      if (c.kind === 'balance') {
        upper = y(c.to);
        svg('rect', { x: x0, y: upper, width: colW, height: Math.max(1, base - upper), fill: 'var(--sp-chart-ink)' }, g);
        // A slanted gap near the foot says the column is cut short
        if (broken) {
          const b = base - 10;
          svg('path', { d: `M${x0 - 2},${b}L${x0 + colW + 2},${b - 5}V${b - 1}L${x0 - 2},${b + 4}Z`, fill: 'var(--sp-bg)' }, g);
        }
        if (c.last) svg('rect', { x: x0, y: upper, width: colW, height: 3, fill: 'var(--sp-accent)' }, g);
      } else {
        upper = Math.min(y(c.from), y(c.to));
        const lower = Math.max(y(c.from), y(c.to));
        if (c.kind === 'rise') {
          const count = Math.max(1, Math.floor((colW + pitch - stroke) / pitch));
          const offset = x0 + (colW - ((count - 1) * pitch + stroke)) / 2 + stroke / 2;
          for (let n = 0; n < count; n++) {
            const x = offset + n * pitch;
            svg('line', { x1: x, x2: x, y1: upper, y2: Math.max(lower, upper + 1), stroke: 'var(--sp-chart-ink)', 'stroke-width': stroke }, g);
          }
        } else {
          svg('rect', { x: x0 + 0.75, y: upper + 0.75, width: colW - 1.5, height: Math.max(1, lower - upper - 1.5), fill: 'none', stroke: 'var(--sp-chart-ink)', 'stroke-width': 1.5 }, g);
        }
      }

      // Value on top: signed for steps, plain for balances
      let text = c.kind === 'balance' ? format(c.value) : signedFormat(c.value);
      if (!fits(text) && shortFormat) text = c.kind === 'balance' ? shortFormat(c.value) : `${c.value >= 0 ? '+' : '-'}${shortFormat(Math.abs(c.value))}`;
      const value = svg('text', { class: 'chart-tick', x: cx(i), y: upper - 8, 'text-anchor': 'middle' }, g);
      value.textContent = text;
      value.style.fill = 'var(--sp-fg)';
      value.style.fontWeight = c.last ? 600 : 500;

      const name = c.label.toUpperCase();
      const label = svg('text', { class: 'chart-tick', x: cx(i), y: height - 6, 'text-anchor': 'middle' }, plot);
      label.textContent = fits(name) ? name : (c.short || c.label.slice(0, 3)).toUpperCase();
      if (c.last) label.style.fill = 'var(--sp-fg)';
      return g;
    });

    let active = -1;
    const show = (i) => {
      active = i;
      const c = cols[i];
      marks.forEach((m, n) => m.setAttribute('opacity', n === i ? 1 : 0.35));
      const rows = c.kind === 'balance'
        ? [{ name, value: format(c.value) }]
        : [
            { name: 'Change', value: signedFormat(c.value) },
            { name: 'Running total', value: format(c.to) },
            { name: `Against ${startLabel.toLowerCase()}`, value: `${((c.value / start) * 100).toFixed(1)}%` },
          ];
      tooltipContent(tooltip, c.label, rows);
      tooltip.dataset.show = 'true';
      placeTooltip(tooltip, frame, cx(i), pad.top);
    };
    const hide = () => {
      active = -1;
      marks.forEach((m) => m.setAttribute('opacity', 1));
      tooltip.dataset.show = 'false';
    };
    plot.addEventListener('pointermove', (e) => {
      const px = e.clientX - plot.getBoundingClientRect().left;
      show(Math.min(cols.length - 1, Math.max(0, Math.floor((px - pad.left) / band))));
    });
    plot.addEventListener('pointerleave', hide);
    plot.addEventListener('blur', hide);
    plot.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
      e.preventDefault();
      const next = active < 0 ? 0 : active + (e.key === 'ArrowRight' ? 1 : -1);
      show(Math.min(cols.length - 1, Math.max(0, next)));
    });

    const values = cols.map((c) => (c.kind === 'balance' ? format(c.value) : signedFormat(c.value)));
    renderTable(root, cols.map((c) => c.label), [{ name, values }], String, caption);
  });
  chart.update(initial);
  return chart;
}

/* ------------------------------------------------------------------ */

/**
 * A disc filled from the bottom like a tank, so that the filled area is
 * `fraction` of the disc. The empty cap above is what was lost.
 */
function tank(parent, cx, cy, r, fraction) {
  const f = Math.min(1, Math.max(0, fraction));
  svg('circle', { cx, cy, r, fill: 'var(--sp-chart-empty)' }, parent);
  if (f >= 0.999) return svg('circle', { cx, cy, r, fill: 'var(--sp-chart-ink)' }, parent);
  if (f <= 0) return null;
  // Central angle of the segment whose area is f of the disc: (t - sin t) / 2pi = f
  let lo = 0;
  let hi = 2 * Math.PI;
  for (let n = 0; n < 30; n++) {
    const mid = (lo + hi) / 2;
    if ((mid - Math.sin(mid)) / (2 * Math.PI) < f) lo = mid;
    else hi = mid;
  }
  const half = lo / 2;
  const dx = r * Math.sin(half);
  const y = cy + r * Math.cos(half);
  return svg('path', { d: `M${cx - dx},${y}A${r},${r} 0 ${lo > Math.PI ? 1 : 0} 0 ${cx + dx},${y}Z`, fill: 'var(--sp-chart-ink)' }, parent);
}

/**
 * Cohort retention as a triangular dot grille: one row per signup month,
 * one column per month since. Each cell is a disc filled with ink from
 * the bottom, like a tank, so the filled area is the share still paying
 * and the pale cap above it is what was lost. The selected row carries the accent marker; click a
 * cell, or press Enter, to select its row (`onSelect(rowIndex)`). Arrow
 * keys, Home and End read every cell, and each reading is announced.
 */
function cohort(el, initial) {
  let chosen;
  let active = null;
  const chart = mount(el, (data) => {
    const {
      rows,
      cols,
      format = (v) => `${v}%`,
      caption,
      name = 'Still paying',
      countLabel = 'Accounts',
      maxCell = 44,
      averages,
      averageLabel = 'Avg',
      onSelect,
      title = (r, c) => `${rows[r].title}, ${c ? `month ${c}` : 'signup month'}`,
    } = data;
    const selected = chosen ?? data.selected;
    // A re-render replaces the focused SVG, so carry the reading across
    const keep = el.contains(document.activeElement) ? active : null;
    el.replaceChildren();
    const root = html('div', 'chart', el);
    const frame = html('div', 'relative', root);
    const width = el.clientWidth;
    const plot = svg('svg', {
      role: 'img',
      tabindex: 0,
      'aria-label': `${caption || name}. Arrow keys read each cell${onSelect ? ', Enter selects its row' : ''}.`,
    }, frame);
    const tooltip = html('div', 'chart-tooltip', frame);
    const live = html('div', 'sr-only', root);
    live.setAttribute('aria-live', 'polite');

    const mark = 12;
    const labelW = Math.max(...rows.map((r) => measureText(r.label.toUpperCase(), 'chart-tick', plot)));
    const sizeW = Math.max(...rows.map((r) => measureText(String(r.size), 'chart-tick', plot)));
    // On narrow screens the cohort sizes leave the grid (they stay in the tooltip)
    const showSize = (width - (mark + labelW + 10 + sizeW + 12)) / cols.length >= 24;
    const padLeft = Math.ceil(mark + labelW + 10 + (showSize ? sizeW + 12 : 0));
    const cell = Math.min(maxCell, (width - padLeft) / cols.length);
    const head = 22;
    const foot = averages ? 30 : 4;
    const height = Math.ceil(head + cell * rows.length + foot);
    plot.setAttribute('width', width);
    plot.setAttribute('height', height);
    plot.setAttribute('viewBox', `0 0 ${width} ${height}`);

    const R = cell * 0.42;
    const cx = (c) => padLeft + c * cell + cell / 2;
    const cy = (r) => head + r * cell + cell / 2;

    cols.forEach((col, c) => {
      svg('text', { class: 'chart-tick', x: cx(c), y: 10, 'text-anchor': 'middle' }, plot).textContent = col;
    });

    const marker = svg('circle', { r: 3.5, cx: 4, fill: 'var(--sp-accent)', visibility: 'hidden' }, plot);
    const labels = rows.map((row, r) => {
      const label = svg('text', { class: 'chart-tick', x: mark, y: cy(r), 'dominant-baseline': 'middle' }, plot);
      label.textContent = row.label.toUpperCase();
      if (showSize) {
        const size = svg('text', { class: 'chart-tick', x: padLeft - 12, y: cy(r), 'text-anchor': 'end', 'dominant-baseline': 'middle' }, plot);
        size.textContent = row.size;
        size.style.fill = 'var(--sp-fg-subtle)';
      }
      row.values.forEach((v, c) => tank(plot, cx(c), cy(r), R, v / 100));
      return label;
    });

    if (averages) {
      const y = head + cell * rows.length + 18;
      svg('line', { class: 'chart-baseline', x1: padLeft, x2: padLeft + cell * cols.length, y1: y - 12.5, y2: y - 12.5 }, plot);
      svg('text', { class: 'chart-tick', x: mark, y, 'dominant-baseline': 'middle' }, plot).textContent = averageLabel.toUpperCase();
      averages.forEach((v, c) => {
        const t = svg('text', { class: 'chart-tick', x: cx(c), y, 'text-anchor': 'middle', 'dominant-baseline': 'middle' }, plot);
        t.textContent = Math.round(v);
        t.style.fill = 'var(--sp-fg-muted)';
        if (cell < 26) Object.assign(t.style, { fontSize: '9px', letterSpacing: '0' });
      });
    }

    const paint = () => {
      labels.forEach((l, r) => {
        l.style.fill = r === selected ? 'var(--sp-fg)' : '';
        l.style.fontWeight = r === selected ? 600 : '';
      });
      if (selected == null) return marker.setAttribute('visibility', 'hidden');
      marker.setAttribute('cy', cy(selected));
      marker.setAttribute('visibility', 'visible');
    };
    paint();

    const ring = svg('circle', { r: R + 3, fill: 'none', stroke: 'var(--sp-fg)', 'stroke-width': 1, visibility: 'hidden' }, plot);
    const show = (r, c) => {
      active = [r, c];
      const row = rows[r];
      const v = row.values[c];
      ring.setAttribute('cx', cx(c));
      ring.setAttribute('cy', cy(r));
      ring.setAttribute('visibility', 'visible');
      const out = [
        { name, value: format(v) },
        { name: countLabel, value: `${Math.round((row.size * v) / 100)} of ${row.size}` },
      ];
      if (averages && c) {
        const d = Math.round((v - averages[c]) * 10) / 10;
        out.push({ name: 'Against average', value: `${d >= 0 ? '+' : '-'}${Math.abs(d)} pts` });
      }
      tooltipContent(tooltip, title(r, c), out);
      tooltip.dataset.show = 'true';
      placeTooltip(tooltip, frame, cx(c), cy(r) + R + 6);
      live.textContent = `${title(r, c)}: ${out.map((o) => `${o.name} ${o.value}`).join(', ')}`;
    };
    const hide = () => {
      active = null;
      ring.setAttribute('visibility', 'hidden');
      tooltip.dataset.show = 'false';
    };
    const select = (r) => {
      chosen = r;
      labels.forEach((l, n) => {
        l.style.fill = n === r ? 'var(--sp-fg)' : '';
        l.style.fontWeight = n === r ? 600 : '';
      });
      marker.setAttribute('cy', cy(r));
      marker.setAttribute('visibility', 'visible');
      onSelect?.(r);
    };
    const cellAt = (e) => {
      const box = plot.getBoundingClientRect();
      const c = Math.floor((e.clientX - box.left - padLeft) / cell);
      const r = Math.floor((e.clientY - box.top - head) / cell);
      return r >= 0 && r < rows.length && c >= 0 && c < rows[r].values.length ? [r, c] : null;
    };
    plot.addEventListener('pointermove', (e) => {
      const at = cellAt(e);
      if (at) show(...at);
      else hide();
    });
    plot.addEventListener('click', (e) => {
      const at = cellAt(e);
      if (at && onSelect) select(at[0]);
    });
    if (onSelect) plot.style.cursor = 'pointer';
    plot.addEventListener('pointerleave', hide);
    plot.addEventListener('blur', hide);
    plot.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && onSelect) {
        e.preventDefault();
        select(active ? active[0] : selected ?? 0);
        return;
      }
      const moves = { ArrowLeft: [0, -1], ArrowRight: [0, 1], ArrowUp: [-1, 0], ArrowDown: [1, 0] };
      if (!moves[e.key] && e.key !== 'Home' && e.key !== 'End') return;
      e.preventDefault();
      if (!active) return show(selected ?? 0, 0);
      let [r, c] = active;
      if (e.key === 'Home') c = 0;
      else if (e.key === 'End') c = rows[r].values.length - 1;
      else {
        r = Math.min(rows.length - 1, Math.max(0, r + moves[e.key][0]));
        c = Math.max(0, c + moves[e.key][1]);
      }
      show(r, Math.min(rows[r].values.length - 1, c));
    });

    if (keep) {
      plot.focus({ preventScroll: true });
      show(...keep);
    }

    // Legend: the dot scale, then the selected row
    const legend = html('div', 'chart-legend mt-4', root);
    const scale = html('span', 'inline-flex items-center gap-2', legend);
    const keys = svg('svg', { width: 76, height: 14, 'aria-hidden': 'true' }, scale);
    keys.style.width = '76px';
    [100, 80, 60, 40].forEach((v, i) => tank(keys, 7 + i * 20, 7, 6, v / 100));
    scale.append('100% to 40% still paying');
    if (onSelect || selected != null) {
      const now = html('span', 'inline-flex items-center gap-2', legend);
      html('span', 'chart-key-dot bg-accent', now);
      now.append('Selected cohort');
    }

    renderTable(root, rows.map((r) => r.title), cols.map((col, c) => ({ name: col, values: rows.map((r) => r.values[c]) })), (v) => (v == null ? '' : format(v)), caption);
  });
  chart.update(initial);
  return chart;
}
window.SaasparillaCharts = { lineChart, barChart, sticks, dumbbell, meter, dotMatrix, sparkline, dial, heatgrid, funnel, dotline, grille, waterfall, cohort };
})();
