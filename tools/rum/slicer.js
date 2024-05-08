// eslint-disable-next-line import/no-relative-packages
import { fetchPlaceholders } from '../../scripts/lib-franklin.js';
import { filterBundle, DataChunks } from './cruncher.js';
import CWVTimeLineChart from './cwvtimeline.js';
import DataLoader from './loader.js';
import { toHumanReadable, UA_KEY, scoreCWV } from './utils.js';

/* globals */
let DOMAIN_KEY = '';
let DOMAIN = 'www.thinktanked.org';
let chart;
const BUNDLER_ENDPOINT = 'https://rum.fastly-aem.page/bundles';
// const BUNDLER_ENDPOINT = 'http://localhost:3000';
const API_ENDPOINT = BUNDLER_ENDPOINT;
// const API_ENDPOINT = 'https://rum-bundles-2.david8603.workers.dev/rum-bundles';
// const UA_KEY = 'user_agent';

const elems = {};

const dataChunks = new DataChunks();

const loader = new DataLoader();
loader.apiEndpoint = API_ENDPOINT;

const timelinechart = new CWVTimeLineChart();

// set up metrics for dataChunks
dataChunks.addSeries('pageViews', (bundle) => bundle.weight);
dataChunks.addSeries('visits', (bundle) => (bundle.visit ? bundle.weight : 0));
dataChunks.addSeries('conversions', (bundle) => (bundle.conversion ? bundle.weight : 0));
dataChunks.addSeries('lcp', (bundle) => bundle.cwvLCP);
dataChunks.addSeries('cls', (bundle) => bundle.cwvCLS);
dataChunks.addSeries('inp', (bundle) => bundle.cwvINP);
dataChunks.addSeries('ttfb', (bundle) => bundle.cwvTTFB);

function setDomain(domain, key) {
  DOMAIN = domain;
  DOMAIN_KEY = key;
  loader.domain = domain;
  loader.domainKey = key;
}

/* update UX */

function updateKeyMetrics(keyMetrics) {
  document.querySelector('#pageviews p').textContent = toHumanReadable(keyMetrics.pageViews);
  document.querySelector('#visits p').textContent = toHumanReadable(keyMetrics.visits);
  document.querySelector('#conversions p').textContent = toHumanReadable(keyMetrics.conversions);

  const lcpElem = document.querySelector('#lcp p');
  lcpElem.textContent = `${toHumanReadable(keyMetrics.lcp / 1000)} s`;
  lcpElem.closest('li').className = `score-${scoreCWV(keyMetrics.lcp, 'lcp')}`;

  const clsElem = document.querySelector('#cls p');
  clsElem.textContent = `${toHumanReadable(keyMetrics.cls)}`;
  clsElem.closest('li').className = `score-${scoreCWV(keyMetrics.cls, 'cls')}`;

  const inpElem = document.querySelector('#inp p');
  inpElem.textContent = `${toHumanReadable(keyMetrics.inp / 1000)} s`;
  inpElem.closest('li').className = `score-${scoreCWV(keyMetrics.inp, 'inp')}`;

  const ttfbElem = document.querySelector('#ttfb p');
  ttfbElem.textContent = `${toHumanReadable(keyMetrics.ttfb / 1000)} s`;
  ttfbElem.closest('li').className = `score-${scoreCWV(keyMetrics.ttfb, 'ttfb')}`;
}

function updateFacets(focus, mode, placeholders, show = {}) {
  const createLabelHTML = (labelText, usePlaceholders) => {
    if (labelText.startsWith('https://') && labelText.includes('media_')) {
      return `<img src="${labelText}?width=750&format=webply&optimize=medium"">`;
    }

    if (labelText.startsWith('https://')) {
      return `<a href="${labelText}" target="_new">${labelText}</a>`;
    }

    if (usePlaceholders && placeholders[labelText]) {
      return (`${placeholders[labelText]} [${labelText}]`);
    }
    return (labelText);
  };

  const numOptions = mode === 'all' ? 20 : 10;
  const filterTags = document.querySelector('.filter-tags');
  filterTags.textContent = '';
  const addFilterTag = (name, value) => {
    const tag = document.createElement('span');
    if (value) tag.textContent = `${name}: ${value}`;
    else tag.textContent = `${name}`;
    tag.classList.add(`filter-tag-${name}`);
    filterTags.append(tag);
  };

  if (elems.filterInput.value) addFilterTag('text', elems.filterInput.value);
  if (focus) addFilterTag(focus);

  const url = new URL(window.location);

  elems.facetsElement.textContent = '';
  const keys = Object.keys(dataChunks.facets);
  keys.forEach((facetName) => {
    const facetEntries = dataChunks.facets[facetName];
    const optionKeys = facetEntries.map((f) => f.value);
    if (optionKeys.length) {
      let tsv = '';
      const fieldSet = document.createElement('fieldset');
      fieldSet.classList.add(`facet-${facetName}`);
      const legend = document.createElement('legend');
      legend.textContent = facetName;
      const clipboard = document.createElement('span');
      clipboard.className = 'clipboard';
      legend.append(clipboard);
      fieldSet.append(legend);
      tsv += `${facetName}\tcount\tlcp\tcls\tinp\r\n`;
      const filterKeys = facetName === 'checkpoint' && mode !== 'all';
      const filteredKeys = filterKeys ? optionKeys.filter((a) => !!(placeholders[a])) : optionKeys;
      const nbToShow = show[facetName] || numOptions;
      facetEntries
        .filter((entry) => !filterKeys || filteredKeys.includes(entry.value))
        .slice(0, nbToShow)
        .forEach((entry) => {
          const div = document.createElement('div');
          const input = document.createElement('input');
          input.type = 'checkbox';
          input.value = entry.value;
          input.checked = url.searchParams.getAll(facetName).includes(entry.value);
          if (input.checked) {
            addFilterTag(facetName, entry.value);
            div.ariaSelected = true;
          }
          input.id = `${facetName}=${entry.value}`;
          div.addEventListener('click', (evt) => {
            if (evt.target !== input) input.checked = !input.checked;
            evt.stopPropagation();
            // eslint-disable-next-line no-use-before-define
            updateState();
            // eslint-disable-next-line no-use-before-define
            draw();
          });

          const label = document.createElement('label');
          label.setAttribute('for', `${facetName}-${entry.value}`);
          label.innerHTML = `${createLabelHTML(entry.value, facetName === 'checkpoint')} (${toHumanReadable(entry.metrics.pageViews.sum)})`;

          const ul = document.createElement('ul');
          ul.classList.add('cwv');

          // display core web vital to facets
          // add lcp
          let lcp = '-';
          let lcpScore = '';
          if (entry.metrics.lcp) {
            const lcpValue = entry.metrics.lcp.percentile(75);
            lcp = `${toHumanReadable(lcpValue / 1000)} s`;
            lcpScore = scoreCWV(lcpValue, 'lcp');
          }
          const lcpLI = document.createElement('li');
          lcpLI.classList.add(`score-${lcpScore}`);
          lcpLI.textContent = lcp;
          ul.append(lcpLI);

          // add cls
          let cls = '-';
          let clsScore = '';
          if (entry.metrics.cls) {
            const clsValue = entry.metrics.cls.percentile(75);
            cls = `${toHumanReadable(clsValue)}`;
            clsScore = scoreCWV(clsValue, 'cls');
          }
          const clsLI = document.createElement('li');
          clsLI.classList.add(`score-${clsScore}`);
          clsLI.textContent = cls;
          ul.append(clsLI);

          // add inp
          let inp = '-';
          let inpScore = '';
          if (entry.metrics.inp) {
            const inpValue = entry.metrics.inp.percentile(75);
            inp = `${toHumanReadable(inpValue / 1000)} s`;
            inpScore = scoreCWV(inpValue, 'inp');
          }
          const inpLI = document.createElement('li');
          inpLI.classList.add(`score-${inpScore}`);
          inpLI.textContent = inp;
          ul.append(inpLI);
          tsv += `${entry.name}\t${entry.value}\t${lcp}\t${cls}\t${inp}\r\n`;

          div.append(input, label, ul);
          fieldSet.append(div);
        });
      // populate pastebuffer with overflow data
      // ideally, this would be populated only when
      // the user clicks the copy button, so that we
      // don't waste cycles on rendering p75s that
      // the user never sees.
      tsv = facetEntries
        .filter((entry) => !filterKeys || filteredKeys.includes(entry.value))
        .slice(0, nbToShow)
        .reduce((acc, entry) => `${acc}${entry.value}\t${entry.metrics.pageViews.sum}\t${entry.metrics.lcp.percentile(75)}\t${entry.metrics.cls.percentile(75)}\t${entry.metrics.inp.percentile(75)}\r\n`, tsv);

      if (filteredKeys.length > nbToShow) {
        // add "more" link
        const div = document.createElement('div');
        div.className = 'load-more';
        const more = document.createElement('label');
        more.textContent = 'more...';
        more.addEventListener('click', (evt) => {
          evt.preventDefault();
          // increase number of keys shown
          updateFacets(
            focus,
            mode,
            placeholders,
            { [facetName]: (show[facetName] || numOptions) + numOptions },
          );
        });

        div.append(more);

        const all = document.createElement('label');
        all.textContent = `all (${filteredKeys.length})`;
        all.addEventListener('click', (evt) => {
          evt.preventDefault();
          // increase number of keys shown
          updateFacets(
            focus,
            mode,
            placeholders,
            { [facetName]: filteredKeys.length },
          );
        });
        div.append(all);
        const container = document.createElement('div');
        container.classList.add('more-container');
        container.append(div);
        fieldSet.append(container);
      }

      legend.addEventListener('click', () => {
        navigator.clipboard.writeText(tsv);
        const toast = document.getElementById('copied-toast');
        toast.ariaHidden = false;
        setTimeout(() => { toast.ariaHidden = true; }, 3000);
      });

      elems.facetsElement.append(fieldSet);
    }
  });
}

async function fetchDomainKey(domain) {
  try {
    const auth = localStorage.getItem('rum-bundler-token');
    const resp = await fetch(`https://rum.fastly-aem.page/domainkey/${domain}`, {
      headers: {
        authorization: `Bearer ${auth}`,
      },
    });
    const json = await resp.json();
    return (json.domainkey);
  } catch {
    return '';
  }
}

async function draw() {
  const ph = await fetchPlaceholders('/tools/rum');
  const params = new URL(window.location).searchParams;
  const checkpoint = params.getAll('checkpoint');
  const target = params.getAll('target');
  const url = params.getAll('url');
  const mode = params.get('metrics');

  const userAgent = params.getAll(UA_KEY);
  const view = params.get('view') || 'week';
  // TODO re-add. I think this should be a filter
  // eslint-disable-next-line no-unused-vars
  const endDate = params.get('endDate') ? `${params.get('endDate')}T00:00:00` : null;
  const focus = params.get('focus');

  const filterText = params.get('filter') || '';
  const filter = {
    text: filterText,
    checkpoint,
    target,
    url,
    [UA_KEY]: userAgent,
  };

  filter.fn = (bundle) => {
    // include all by default
    let matched = true;
    // new filter function, without side effects
    // poor man's full text search
    if (
      matched
      && filter.text
      && JSON.stringify(bundle).indexOf(filter.text) > -1
    ) matched = true;
    if (
      matched
      && filter.checkpoint.length
      && filter.checkpoint.find((fcp) => (bundle.events.find((evt) => evt.checkpoint === fcp)))
    ) matched = true;
    if (
      matched
      && filter.url.length
      && filter.url.find((furl) => bundle.url === furl)
    ) matched = true;
    if (
      matched
      && filter.userAgent.length
      // fuzzy user agent matching
      && filter.userAgent.find((fua) => bundle.userAgent && bundle.userAgent.startsWith(fua))
    ) matched = true;
    // TODO: filter by checkpoint.source and checkpoint.target
    // return the result
    return matched;
  };

  checkpoint.forEach((cp) => {
    const props = ['target', 'source', 'value'];
    props.forEach((prop) => {
      const values = params.getAll(`${cp}.${prop}`);
      if (values.length) {
        filter[`${cp}.${prop}`] = values;
      }
    });
  });

  const facets = {
    [UA_KEY]: {},
    url: {},
    checkpoint: {},
  };

  const startTime = new Date();
  const cwv = structuredClone(facets);

  const filtered = dataChunks.filter((bundle) => filterBundle(bundle, filter, facets, cwv));

  dataChunks.addFacet('userAgent', (bundle) => {
    const parts = bundle.userAgent.split(':');
    return parts.reduce((acc, _, i) => {
      acc.push(parts.slice(0, i + 1).join(':'));
      return acc;
    }, []);
  });
  dataChunks.addFacet('url', (bundle) => bundle.url);
  dataChunks.addFacet('checkpoint', (bundle) => Array.from(bundle.events.reduce((acc, evt) => {
    acc.add(evt.checkpoint);
    return acc;
  }, new Set())));

  if (filtered.length < 1000) {
    elems.lowDataWarning.ariaHidden = 'false';
  } else {
    elems.lowDataWarning.ariaHidden = 'true';
  }

  const configs = {
    month: {
      view,
      unit: 'day',
      units: 30,
      focus,
      endDate,
    },
    week: {
      view,
      unit: 'hour',
      units: 24 * 7,
      focus,
      endDate,
    },
    year: {
      view,
      unit: 'week',
      units: 52,
      focus,
      endDate,
    },
  };

  const config = configs[view];

  timelinechart.config = config;
  timelinechart.useData(dataChunks);
  timelinechart.defineSeries();

  // group by date, according to the chart config
  const group = dataChunks.group(timelinechart.groupBy);
  const chartLabels = Object.keys(group).sort();

  const iGoodCWVs = Object.entries(dataChunks.aggregates)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, totals]) => totals.iGoodCWV.weight);

  const iNiCWVs = Object.entries(dataChunks.aggregates)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, totals]) => totals.iNiCWV.weight);

  const iPoorCWVs = Object.entries(dataChunks.aggregates)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, totals]) => totals.iPoorCWV.weight);

  const iNoCWVs = Object.entries(dataChunks.aggregates)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, totals]) => totals.iNoCWV.weight);

  chart.data.datasets[1].data = iGoodCWVs;
  chart.data.datasets[2].data = iNiCWVs;
  chart.data.datasets[3].data = iPoorCWVs;
  chart.data.datasets[0].data = iNoCWVs;

  chart.data.labels = chartLabels;
  chart.options.scales.x.time.unit = config.unit;
  chart.update();

  // eslint-disable-next-line no-console
  console.log(`filtered to ${filtered.length} bundles in ${new Date() - startTime}ms`);
  updateFacets(focus, mode, ph);
  const keyMetrics = {
    pageViews: dataChunks.totals.pageViews.sum,
    lcp: dataChunks.totals.lcp.percentile(75),
    cls: dataChunks.totals.cls.percentile(75),
    inp: dataChunks.totals.inp.percentile(75),
    ttfb: dataChunks.totals.ttfb.percentile(75),
    conversions: dataChunks.totals.conversions.sum,
    visits: dataChunks.totals.visits.sum,
  };

  updateKeyMetrics(keyMetrics);
}

async function loadData(scope) {
  const params = new URL(window.location.href).searchParams;
  const endDate = params.get('endDate') ? `${params.get('endDate')}T00:00:00` : null;

  if (scope === 'week') {
    dataChunks.load(await loader.fetchLastWeek(endDate));
  }
  if (scope === 'month') {
    dataChunks.load(await loader.fetchPrevious31Days(endDate));
  }
  if (scope === 'year') {
    dataChunks.load(await loader.fetchPrevious12Months(endDate));
  }

  draw();
}

function updateState() {
  const url = new URL(window.location.href.split('?')[0]);
  const { searchParams } = new URL(window.location.href);
  url.searchParams.set('domain', DOMAIN);
  url.searchParams.set('filter', elems.filterInput.value);
  url.searchParams.set('view', elems.viewSelect.value);
  if (searchParams.get('endDate')) url.searchParams.set('endDate', searchParams.get('endDate'));
  if (searchParams.get('metrics')) url.searchParams.set('metrics', searchParams.get('metrics'));
  const selectedMetric = document.querySelector('.key-metrics li[aria-selected="true"]');
  if (selectedMetric) url.searchParams.set('focus', selectedMetric.id);

  elems.facetsElement.querySelectorAll('input').forEach((e) => {
    if (e.checked) {
      url.searchParams.append(e.id.split('=')[0], e.value);
    }
  });
  url.searchParams.set('domainkey', DOMAIN_KEY);
  window.history.replaceState({}, '', url);
}

const section = document.querySelector('main > div');
const io = new IntersectionObserver((entries) => {
  // wait for decoration to have happened
  if (entries[0].isIntersecting) {
    const mainInnerHTML = `<div class="output">
<div class="title">
  <h1><img src="https://www.aem.live/favicon.ico"> www.aem.live</h1>
  <div>
    <select id="view">
      <option value="week">Week</option>
      <option value="month">Month</option>
      <option value="year">Year</option>
    </select>
  </div>
</div>
<div class="key-metrics">
  <ul>
    <li id="pageviews">
      <h2>Pageviews</h2>
      <p>0</p>
    </li>
    <li id="visits">
      <h2>Visits</h2>
      <p>0</p>
    </li>
    <li id="conversions">
      <h2>Conversions</h2>
      <p>0</p>
    </li>
    <li id="lcp">
      <h2>LCP</h2>
      <p>0</p>
    </li>
    <li id="cls">
      <h2>CLS</h2>
      <p>0</p>
    </li>
    <li id="inp">
      <h2>INP</h2>
      <p>0</p>
    </li>
  </ul>
  <div class="key-metrics-more" aria-hidden="true">
    <ul>
      <li id="ttfb">
        <h2>TTFB</h2>
        <p>0</p>
      </li>  
    </ul>
  </div>
</div>

<figure>
  <div class="chart-container">
    <canvas id="time-series"></canvas>
  </div>
  <div class="filter-tags"></div>
  <figcaption>
    <span aria-hidden="true" id="low-data-warning"><span class="danger-icon"></span> small sample size, accuracy reduced.</span>
    <span id="timezone"></span>
  </figcaption>
</figure>
</div>

<div class="filters">
  <div class="quick-filter">
  <input type="text" id="filter" placeholder="Type to filter...">
  </div>
  <aside id="facets">
  </aside>
</div>
`;

    const main = document.querySelector('main');
    main.innerHTML = mainInnerHTML;

    elems.viewSelect = document.getElementById('view');
    elems.filterInput = document.getElementById('filter');
    elems.facetsElement = document.getElementById('facets');
    elems.canvas = document.getElementById('time-series');
    elems.timezoneElement = document.getElementById('timezone');
    elems.lowDataWarning = document.getElementById('low-data-warning');

    // eslint-disable-next-line no-undef, no-new
    chart = new Chart(elems.canvas, {
      type: 'bar',
      data: {
        labels: [],
        datasets: [{
          label: 'No CVW',
          backgroundColor: '#888',
          data: [],
        },
        {
          label: 'Good',
          backgroundColor: '#49cc93',
          data: [],
        },
        {
          label: 'Needs Improvement',
          backgroundColor: '#ffa037',
          data: [],
        },
        {
          label: 'Poor',
          backgroundColor: '#ff7c65',
          data: [],
        }],
      },
      plugins: [
        {
          id: 'customCanvasBackgroundColor',
          beforeDraw: (ch, args, options) => {
            const { ctx } = ch;
            ctx.save();
            ctx.globalCompositeOperation = 'destination-over';
            ctx.fillStyle = options.color || '#99ffff';
            ctx.fillRect(0, 0, ch.width, ch.height);
            ctx.restore();
          },
        },
      ],
      options: {
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: false,
          },
          customCanvasBackgroundColor: {
            color: 'white',
          },
          tooltip: {
            callbacks: {
              label: (context) => {
                const { datasets } = context.chart.data;
                const value = context.parsed.y;
                const i = context.dataIndex;
                const total = datasets.reduce((pv, cv) => pv + cv.data[i], 0);

                return (`${context.dataset.label}: ${Math.round((value / total) * 1000) / 10}%`);
              },
            },
          },
        },
        interaction: {
          mode: 'x',
        },
        animation: {
          duration: 300,
        },
        datasets: {
          bar: {
            barPercentage: 1,
            categoryPercentage: 0.9,
            borderSkipped: false,
            borderRadius: {
              topLeft: 3,
              topRight: 3,
              bottomLeft: 3,
              bottomRight: 3,
            },
          },
        },
        responsive: true,
        scales: {
          x: {
            type: 'time',
            display: true,
            offset: true,
            time: {
              displayFormats: {
                day: 'EEE, MMM d',
              },
              unit: 'day',
            },
            stacked: true,
            ticks: {
              minRotation: 90,
              maxRotation: 90,
              autoSkip: false,
            },
          },
          y: {
            stacked: true,
            ticks: {
              callback: (value) => toHumanReadable(value),
            },
          },
        },
      },
    });

    const params = new URL(window.location).searchParams;
    elems.filterInput.value = params.get('filter');
    const view = params.get('view') || 'week';
    elems.viewSelect.value = view;
    setDomain(params.get('domain') || 'www.thinktanked.org', params.get('domainkey') || '');
    const h1 = document.querySelector('h1');
    h1.textContent = ` ${DOMAIN}`;
    const img = document.createElement('img');
    img.src = `https://${DOMAIN}/favicon.ico`;
    img.addEventListener('error', () => {
      img.src = './website.svg';
    });
    h1.prepend(img);
    h1.addEventListener('click', async () => {
      // eslint-disable-next-line no-alert
      let domain = window.prompt('enter domain or URL');
      if (domain) {
        try {
          const url = new URL(domain);
          domain = url.host;
        } catch {
          // nothing
        }
        const domainkey = await fetchDomainKey(domain);
        window.location = `${window.location.pathname}?domain=${domain}&view=month&domainkey=${domainkey}`;
      }
    });

    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    elems.timezoneElement.textContent = timezone;

    loadData(view);

    elems.filterInput.addEventListener('input', () => {
      updateState();
      draw();
    });

    elems.viewSelect.addEventListener('input', () => {
      updateState();
      window.location.reload();
    });

    const metrics = [...document.querySelectorAll('.key-metrics li')];
    metrics.forEach((e) => {
      e.addEventListener('click', (evt) => {
        const metric = evt.currentTarget.id;
        const selected = evt.currentTarget.ariaSelected === 'true';
        metrics.forEach((m) => { m.ariaSelected = false; });
        if (metric !== 'pageviews') e.ariaSelected = !selected;
        updateState();
        draw();
      });
    });

    if (params.get('metrics') === 'all') {
      document.querySelector('.key-metrics-more').ariaHidden = false;
    }
  }
});

io.observe(section);
