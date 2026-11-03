/**
 * Help tab: localized guide to every feature and integration.
 * Section bodies come from messages.json and use a tiny safe markup:
 * lines starting with "• " become list items, **bold** and `code` are inline.
 * Everything is built with DOM nodes (no innerHTML).
 */
import { t } from './localization.js';

const RELEASES_URL = 'https://github.com/MirrorAzure/Let-It-Snow/releases';

export const HELP_SECTIONS = [
  { id: 'start', icon: 'fa-play', subtab: 'snow' },
  { id: 'snow', icon: 'fa-snowflake', subtab: 'snow' },
  { id: 'symbols', icon: 'fa-palette', subtab: 'symbols' },
  { id: 'wind', icon: 'fa-wind', subtab: 'wind' },
  { id: 'mouse', icon: 'fa-arrow-pointer', subtab: 'snow' },
  { id: 'presets', icon: 'fa-bookmark', subtab: 'presets' },
  { id: 'effects', icon: 'fa-bolt', subtab: 'api' },
  { id: 'sync', icon: 'fa-clone', subtab: 'api' },
  { id: 'relay', icon: 'fa-network-wired', subtab: 'api' },
  { id: 'obs', icon: 'fa-video', subtab: 'api' },
  { id: 'http', icon: 'fa-terminal' },
  { id: 'pageApi', icon: 'fa-code', subtab: 'api' },
  { id: 'security', icon: 'fa-shield-halved' },
  { id: 'trouble', icon: 'fa-screwdriver-wrench' }
];

const capitalize = (value) => value.charAt(0).toUpperCase() + value.slice(1);

const appendInline = (parent, text) => {
  // Split into `code` and **bold** tokens while keeping plain text as text nodes.
  const pattern = /(`[^`]+`|\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > lastIndex) {
      parent.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const token = match[0];
    const el = document.createElement(token.startsWith('`') ? 'code' : 'strong');
    el.textContent = token.startsWith('`') ? token.slice(1, -1) : token.slice(2, -2);
    parent.appendChild(el);
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) {
    parent.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
};

export const renderHelpBody = (container, text) => {
  let list = null;
  String(text || '').split('\n').forEach((rawLine) => {
    const line = rawLine.trim();
    if (!line) return;
    if (line.startsWith('• ')) {
      if (!list) {
        list = document.createElement('ul');
        container.appendChild(list);
      }
      const item = document.createElement('li');
      appendInline(item, line.slice(2));
      list.appendChild(item);
      return;
    }
    list = null;
    const paragraph = document.createElement('p');
    appendInline(paragraph, line);
    container.appendChild(paragraph);
  });
};

const createIcon = (name) => {
  const icon = document.createElement('i');
  icon.className = `fas ${name}`;
  icon.setAttribute('aria-hidden', 'true');
  return icon;
};

const createDocLink = (href, iconName, label) => {
  const link = document.createElement('a');
  link.className = 'help-doc-link';
  link.href = href;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.appendChild(createIcon(iconName));
  const text = document.createElement('span');
  text.textContent = label;
  link.appendChild(text);
  link.appendChild(createIcon('fa-arrow-up-right-from-square'));
  return link;
};

/**
 * @param {{ onNavigate?: (subtab: string) => void }} options
 */
export function initHelpPanel({ onNavigate } = {}) {
  const list = document.getElementById('helpSections');
  const search = document.getElementById('helpSearch');
  const empty = document.getElementById('helpNoResults');
  const docs = document.getElementById('helpDocs');
  if (!list) return;

  list.replaceChildren();
  const sections = HELP_SECTIONS.map((section) => {
    const key = `help${capitalize(section.id)}`;
    const details = document.createElement('details');
    details.className = 'help-section';
    details.dataset.helpSection = section.id;

    const summary = document.createElement('summary');
    summary.appendChild(createIcon(section.icon));
    const title = document.createElement('span');
    title.className = 'help-section-title';
    title.textContent = t(`${key}Title`);
    summary.appendChild(title);
    summary.appendChild(createIcon('fa-chevron-down help-chevron'));
    details.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'help-section-body';
    renderHelpBody(body, t(`${key}Body`));
    if (section.subtab && typeof onNavigate === 'function') {
      const goto = document.createElement('button');
      goto.type = 'button';
      goto.className = 'secondary-btn help-goto';
      goto.dataset.helpGoto = section.subtab;
      goto.appendChild(createIcon('fa-sliders'));
      const label = document.createElement('span');
      label.textContent = t('helpOpenSettings');
      goto.appendChild(label);
      goto.addEventListener('click', () => onNavigate(section.subtab));
      body.appendChild(goto);
    }
    details.appendChild(body);
    list.appendChild(details);
    return { details, haystack: details.textContent.toLowerCase() };
  });

  if (docs) {
    docs.replaceChildren(
      createDocLink(t('helpDocsGuideUrl'), 'fa-book', t('helpDocsGuide')),
      createDocLink(t('helpDocsApiUrl'), 'fa-plug', t('helpDocsApi')),
      createDocLink(RELEASES_URL, 'fa-download', t('helpDocsReleases'))
    );
  }

  if (search) {
    search.placeholder = t('helpSearchPlaceholder');
    search.addEventListener('input', () => {
      const query = search.value.trim().toLowerCase();
      let visible = 0;
      sections.forEach(({ details, haystack }) => {
        const match = !query || haystack.includes(query);
        details.hidden = !match;
        if (match) visible += 1;
        // Expand matches while searching, collapse everything when the query is cleared.
        details.open = Boolean(query) && match;
      });
      if (empty) empty.hidden = visible > 0;
    });
  }
}
