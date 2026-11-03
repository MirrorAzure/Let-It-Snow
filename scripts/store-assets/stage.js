/*
 * Store screenshot stage. Driven by build-store-assets.js through window.__stage:
 *   await __stage.setup(config)      — theme, overlay URL, popup seed/tab, texts
 *   await __stage.setLanguage('ru')  — captions + popup language, then opens the popup tab
 *   __stage.makeImages()             — PNG data URLs used as "GIF" flakes
 */
(() => {
  const SITES = {
    market: {
      url: 'winter-market.example',
      en: { logo: '❄ Winter Market', nav: ['Gifts', 'Decor', 'Sale', 'Contacts'], title: 'Cozy winter gifts', lead: 'Handmade decorations, warm sweaters and hot cocoa for the whole family.', cta: 'Shop now', ghost: 'Catalog' },
      ru: { logo: '❄ Зимняя ярмарка', nav: ['Подарки', 'Декор', 'Скидки', 'Контакты'], title: 'Уютные зимние подарки', lead: 'Игрушки ручной работы, тёплые свитера и горячее какао для всей семьи.', cta: 'В магазин', ghost: 'Каталог' }
    },
    aurora: {
      url: 'northern-lights.example',
      en: { logo: '✦ Aurora', nav: ['Tours', 'Gallery', 'Forecast'], title: 'Northern lights tonight', lead: 'Clear skies and strong activity — the best night of the season.', cta: 'Book a tour', ghost: 'Forecast' },
      ru: { logo: '✦ Аврора', nav: ['Туры', 'Галерея', 'Прогноз'], title: 'Северное сияние сегодня', lead: 'Ясное небо и высокая активность — лучшая ночь сезона.', cta: 'Забронировать', ghost: 'Прогноз' }
    },
    sale: {
      url: 'holiday-sale.example',
      en: { logo: '🎁 Holiday', nav: ['Deals', 'Gift cards', 'Help'], title: 'Holiday sale −40%', lead: 'Only this week: discounts on everything for the holidays.', cta: 'Get deals', ghost: 'Gift cards' },
      ru: { logo: '🎁 Праздник', nav: ['Акции', 'Сертификаты', 'Помощь'], title: 'Праздничная распродажа −40%', lead: 'Только на этой неделе: скидки на всё к праздникам.', cta: 'Смотреть', ghost: 'Сертификаты' }
    },
    blog: {
      url: 'cozy-notes.example',
      en: { logo: 'Cozy Notes', nav: ['Articles', 'Recipes', 'About'], title: 'Ten ideas for a snowy weekend', lead: 'From gingerbread houses to night walks: how to spend the first snowy days.', cta: 'Read more', ghost: '' },
      ru: { logo: 'Уютные заметки', nav: ['Статьи', 'Рецепты', 'О блоге'], title: 'Десять идей для снежных выходных', lead: 'От пряничных домиков до ночных прогулок: как провести первые снежные дни.', cta: 'Читать', ghost: '' }
    },
    stream: {
      url: 'stream.example/winter-live',
      en: { logo: '● StreamHub', nav: ['Browse', 'Following'], title: 'Winter chill stream', lead: 'Snow from the chat: viewers trigger effects through the API.', cta: 'Follow', ghost: '' },
      ru: { logo: '● StreamHub', nav: ['Обзор', 'Подписки'], title: 'Зимний чилл-стрим', lead: 'Снег из чата: зрители запускают эффекты через API.', cta: 'Подписаться', ghost: '' }
    }
  };

  const THEME_CLASS = { market: 'theme-market', aurora: 'theme-aurora', sale: 'theme-sale', blog: 'theme-blog', stream: 'theme-stream' };

  const el = (tag, className, text) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  };

  let config = null;

  const renderSite = (lang) => {
    const site = document.getElementById('site');
    site.className = `site ${THEME_CLASS[config.theme] || ''}`;
    site.replaceChildren();
    if (config.promo) return;
    const data = SITES[config.theme] || SITES.market;
    const texts = data[lang] || data.en;
    document.getElementById('address').textContent = `https://${data.url}`;

    const hero = el('div', 'hero');
    const nav = el('nav', 'site-nav');
    nav.append(el('span', 'logo', texts.logo), ...texts.nav.map((item) => el('span', null, item)));
    hero.append(nav);

    if (config.theme === 'stream') {
      const player = el('div', 'player');
      player.append(el('span', 'live', 'LIVE'));
      hero.append(player);
      hero.style.paddingTop = '28px';
      nav.style.marginBottom = '22px';
      return site.append(hero);
    }

    hero.append(el('h2', null, texts.title), el('p', 'lead', texts.lead));
    const actions = el('div');
    actions.append(el('span', 'btn', texts.cta));
    if (texts.ghost) actions.append(el('span', 'btn ghost', texts.ghost));
    hero.append(actions);
    if (config.theme === 'blog') {
      for (let i = 0; i < 4; i += 1) {
        const line = el('div', 'line');
        line.style.width = `${92 - i * 9}%`;
        hero.append(line);
      }
    }
    site.append(hero);
  };

  const waitForLoad = (frame, src) => new Promise((resolve) => {
    frame.addEventListener('load', () => resolve(), { once: true });
    frame.src = src;
  });

  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const openPopupTab = async (doc) => {
    if (!config.popupTab) return;
    const [kind, name] = config.popupTab.split(':');
    const selector = kind === 'tab' ? `[data-tab="${name}"]` : `[data-subtab="${name}"]`;
    for (let i = 0; i < 40; i += 1) {
      const button = doc.querySelector(selector);
      if (button) {
        button.click();
        return;
      }
      await sleep(100);
    }
  };

  // Font Awesome comes from a CDN stylesheet: wait until its @font-face exists and the font is loaded.
  const waitForIconFont = async (doc) => {
    for (let i = 0; i < 100; i += 1) {
      const face = [...doc.fonts].find((font) => font.family.includes('Font Awesome') && font.weight === '900');
      if (face) {
        try {
          await Promise.race([face.load(), sleep(5000)]);
        } catch {
          // A failed font load only means icons are missing; screenshots still proceed.
        }
        await doc.fonts.ready;
        return;
      }
      await sleep(100);
    }
  };

  window.__stage = {
    ready: false,

    async setup(nextConfig) {
      config = nextConfig;
      window.__storeSeed = config.seed || {};
      document.body.classList.toggle('is-promo', Boolean(config.promo));
      document.getElementById('badge').textContent = `v${config.version}`;
      await waitForLoad(document.getElementById('overlay'), config.overlayUrl);
      this.ready = true;
      return true;
    },

    async setLanguage(lang) {
      document.documentElement.lang = lang;
      renderSite(lang);
      const texts = (config.texts && (config.texts[lang] || config.texts.en)) || {};
      document.getElementById('caption-title').textContent = texts.title || '';
      document.getElementById('caption-text').textContent = texts.text || '';
      document.getElementById('promo-name').textContent = texts.name || '';
      document.getElementById('promo-tagline').textContent = texts.tagline || '';
      if (config.promo) return true;

      const frame = document.getElementById('popup');
      await waitForLoad(frame, `/ext/src/popup/popup.html?lang=${lang}&t=${Date.now()}`);
      await sleep(700);
      const bodyWidth = Math.round(frame.contentDocument.body.getBoundingClientRect().width);
      if (bodyWidth >= 300 && bodyWidth <= 480) document.getElementById('popup-card').style.width = `${bodyWidth}px`;
      await openPopupTab(frame.contentDocument);
      await waitForIconFont(frame.contentDocument);
      if (config.popupHelpSection) {
        const section = frame.contentDocument.querySelector(`[data-help-section="${config.popupHelpSection}"]`);
        if (section) {
          section.open = true;
          section.previousElementSibling?.scrollIntoView({ block: 'start' });
        }
      }
      await sleep(500);
      if (config.popupScroll) {
        const scroller = frame.contentDocument.scrollingElement;
        scroller.scrollTop = config.popupScroll;
        frame.contentDocument.querySelectorAll('.tab-content, .sub-tab-content, main').forEach((node) => {
          if (node.scrollHeight > node.clientHeight) node.scrollTop = config.popupScroll;
        });
      }
      await sleep(200);
      return true;
    },

    makeImages() {
      const draw = (paint) => {
        const canvas = document.createElement('canvas');
        canvas.width = 96;
        canvas.height = 96;
        paint(canvas.getContext('2d'));
        return canvas.toDataURL('image/png');
      };
      const emoji = (symbol) => draw((ctx) => {
        ctx.font = '76px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(symbol, 48, 54);
      });
      const ornament = (a, b) => draw((ctx) => {
        const gradient = ctx.createRadialGradient(38, 38, 6, 48, 52, 40);
        gradient.addColorStop(0, '#ffffff');
        gradient.addColorStop(0.25, a);
        gradient.addColorStop(1, b);
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.arc(48, 54, 36, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#ffd54f';
        ctx.fillRect(40, 8, 16, 12);
      });
      return [emoji('🎁'), emoji('🎄'), ornament('#ff5252', '#8e0000'), ornament('#40c4ff', '#01579b')];
    }
  };
})();
