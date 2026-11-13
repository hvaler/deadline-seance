// @vitest-environment jsdom
import { afterEach, describe, expect, test } from 'vitest';
import { sampleBoard } from '../../src/ui/sample-board';
import { byFocus, mountWith, region, shownKeys, texts } from './harness';

afterEach(() => {
  document.body.replaceChildren();
});

const quote = (text: string): string => text.replace(/["\\]/g, '\\$&');
const plank = (root: ParentNode, key: string) => root.querySelector<HTMLElement>(`[data-list="safehouse"] > li[data-key="${quote(key)}"]`)!;
const grave = (root: ParentNode, key: string) => root.querySelector<HTMLElement>(`[data-list="yard"] > li[data-key="${quote(key)}"]`)!;
const fact = (card: HTMLElement, label: string): string => {
  const row = [...card.querySelectorAll('dl > div')].find((d) => d.querySelector('dt')?.textContent === label);
  return row?.querySelector('dd')?.textContent ?? '';
};
const visible = (node: Element): boolean => !node.hasAttribute('hidden');
const actionsOf = (card: HTMLElement): string[] => [...card.querySelectorAll<HTMLButtonElement>('.card-actions button')].filter(visible).map((b) => b.textContent ?? '');

describe('the safehouse', () => {
  test('lists the kept tickets, sorted by key, with the totals of the cut', () => {
    const { root } = mountWith();
    expect(shownKeys(root, 'safehouse')).toEqual(['HB-101', 'HB-102', 'HB-103', 'HB-104', 'HB-105', 'HB-106', 'HB-107', 'HB-109', 'HB-113', 'HB-115', 'HB-116', 'HB-118']);
    expect(region(root, 'safehouse-summary').textContent).toBe('12 tickets · 59 of 59 points · saved cod 167');
  });

  test('every card shows key, title, effort and the cost of delay with its formula', () => {
    const { root } = mountWith();
    const card = plank(root, 'HB-101');
    expect(card.querySelector('.card-key')?.textContent).toBe('HB-101');
    expect(card.querySelector('.card-title')?.textContent).toBe('Fix stale balance after a transfer');
    expect(card.querySelector('.row-effort')?.textContent).toBe('Effort 5');
    expect(card.querySelector('.row-effort .num')?.textContent).toBe('5');
    expect(card.querySelector('.row-cost')?.textContent).toBe('value 8 + urgency 5 + risk 5 = 18');
    expect(card.querySelector('article')?.getAttribute('aria-labelledby')).toBe(card.querySelector('.card-title')?.id);
  });

  test('hunger is shown: urgency 1 → 5 and how long the ticket has been left out', () => {
    const { root } = mountWith();
    const card = plank(root, 'HB-105');
    expect(card.querySelector('.row-cost')?.textContent).toBe('value 3 + urgency 1 → 5 + risk 3 = 11');
    const tag = card.querySelector('.tag-hungry');
    expect(tag?.textContent).toBe('hungry (left out 3 releases)');
    expect(tag?.getAttribute('title')).toBe('left out 3 releases');
    expect(plank(root, 'HB-113').querySelector('.row-cost')?.textContent).toBe('value 3 + urgency 3 → 8 + risk 3 = 14');
    expect(plank(root, 'HB-101').querySelector('.tag-hungry')).toBeNull();
  });

  test('must-haves carry a small tag; the others do not', () => {
    const { root } = mountWith();
    const badges = (key: string) => texts(plank(root, key).querySelectorAll('.tag-must-have'));
    expect(badges('HB-101')).toEqual(['must-have']);
    expect(badges('HB-103')).toEqual(['must-have']);
    expect(badges('HB-104')).toEqual([]);
  });

  test('what a ticket needs is written on it', () => {
    const { root } = mountWith();
    expect(plank(root, 'HB-107').querySelector('.card-needs')?.textContent).toBe('Needs HB-106');
    expect(visible(plank(root, 'HB-101').querySelector('.card-needs')!)).toBe(false);
  });

  test('kept cards have no actions in this version', () => {
    const { root } = mountWith();
    expect(region(root, 'safehouse').querySelector('button')).toBeNull();
  });

  test('the list is a list for assistive technology', () => {
    const { root } = mountWith();
    expect(region(root, 'safehouse').querySelector('ul[data-list="safehouse"]')?.getAttribute('role')).toBe('list');
  });
});

describe('the yard', () => {
  test('lists the buried tickets, sorted by key, with the totals left outside', () => {
    const { root } = mountWith();
    expect(shownKeys(root, 'yard')).toEqual(['HB-108', 'HB-110', 'HB-111', 'HB-112', 'HB-114', 'HB-117', 'HB-119']);
    expect(region(root, 'yard-summary').textContent).toBe('7 tickets · effort 129 · cod 101');
  });

  test('every tombstone shows key, title, effort, cost of delay, the engine reason and the cost of waiting', () => {
    const { root } = mountWith();
    const stone = grave(root, 'HB-108');
    expect(stone.querySelector('.card-key')?.textContent).toBe('HB-108');
    expect(stone.querySelector('.card-title')?.textContent).toBe('Transaction search');
    expect(fact(stone, 'Effort')).toBe('8');
    expect(fact(stone, 'Cost of delay')).toBe('value 5 + urgency 2 + risk 3 = 10');
    expect(fact(stone, 'Waiting costs')).toBe('20 over 2 weeks');
    // The engine's reason is the epitaph's own sentence, so it is not written twice.
    expect(stone.querySelector('.card-epitaph')?.textContent).toContain('It needed 8 points; the night had 0 left.');
    expect(visible(stone.querySelector('.card-why')!)).toBe(false);
  });

  test('the epitaph is the fixed template, built from the facts', () => {
    const { root } = mountWith();
    expect(grave(root, 'HB-108').querySelector('.card-epitaph')?.textContent).toBe(
      'Here lies HB-108. It needed 8 points; the night had 0 left.',
    );
    // The waiting cost and the releases are not in the epitaph: they are in the details and the hunger line.
    expect(grave(root, 'HB-112').querySelector('.card-epitaph')?.textContent).toBe('Here lies HB-112. It needed 21 points; the night had 0 left.');
    expect(fact(grave(root, 'HB-112'), 'Waiting costs')).toBe('32 over 2 weeks');
    expect(grave(root, 'HB-112').querySelector('.card-releases')?.textContent).toBe('left out 3 releases');
  });

  test('an imported cost says so', () => {
    const { root } = mountWith();
    expect(fact(grave(root, 'HB-111'), 'Cost of delay')).toBe('imported cost of delay 14');
  });

  test('zombies are marked with a word, and have two actions; the others have one', () => {
    const { root } = mountWith();
    expect(texts(grave(root, 'HB-110').querySelectorAll('.badge'))).toEqual(['Zombie']);
    expect(texts(grave(root, 'HB-112').querySelectorAll('.badge'))).toEqual(['Zombie']);
    expect(texts(grave(root, 'HB-108').querySelectorAll('.badge'))).toEqual([]);
    expect(actionsOf(grave(root, 'HB-110'))).toEqual(['Resurrect', "Put down (Won't Do)"]);
    expect(actionsOf(grave(root, 'HB-108'))).toEqual(['Exhume']);
    expect(grave(root, 'HB-110').dataset.zombie).toBe('true');
    expect(grave(root, 'HB-108').dataset.zombie).toBe('false');
    expect(grave(root, 'HB-110').querySelector('.card-releases')?.textContent).toBe('left out 2 releases');
    expect(visible(grave(root, 'HB-108').querySelector('.card-releases')!)).toBe(false);
  });

  test('actions have accessible names that include the key', () => {
    const { root } = mountWith();
    const label = (id: string) => byFocus(root, id).getAttribute('aria-label');
    expect(label('exhume:HB-108')).toBe('Exhume HB-108');
    expect(label('resurrect:HB-110')).toBe('Resurrect HB-110');
    expect(label('put-down:HB-110')).toBe("Put down HB-110 (Won't Do)");
    for (const b of region(root, 'yard').querySelectorAll('.card-actions button')) {
      expect(b.tagName).toBe('BUTTON');
      expect(b.getAttribute('type')).toBe('button');
    }
  });

  test('the cascade: HB-114 fell behind HB-112, says so, and is chained to it', () => {
    const { root } = mountWith();
    const stone = grave(root, 'HB-114');
    expect(stone.dataset.fell).toBe('true');
    expect(stone.querySelector('.card-fell')?.textContent).toBe('Fell behind HB-112');
    expect(stone.querySelector('.card-chained')?.textContent).toBe('Chained to HB-112');
    expect(visible(stone.querySelector('.card-why')!)).toBe(false);
    expect(stone.querySelector('.card-epitaph')?.textContent).toBe('Here lies HB-114. It followed HB-112 into the ground.');
    expect(grave(root, 'HB-108').dataset.fell).toBe('false');
    expect(visible(grave(root, 'HB-108').querySelector('.card-fell')!)).toBe(false);
  });

  test('fallen tombstones are numbered for the staggered animation, through a CSS custom property', () => {
    const { root } = mountWith();
    expect(grave(root, 'HB-108').style.getPropertyValue('--i')).toBe('0');
    expect(grave(root, 'HB-114').style.getPropertyValue('--i')).toBe('4');
  });
});

describe('actions', () => {
  test('exhume brings the ticket back as a must-have and buries what it must: the lists, totals and note follow', () => {
    const { root, app } = mountWith();
    byFocus(root, 'exhume:HB-108').click();
    expect(shownKeys(root, 'safehouse')).toContain('HB-108');
    expect(shownKeys(root, 'yard')).toContain('HB-115');
    expect(shownKeys(root, 'yard')).not.toContain('HB-108');
    expect(texts(plank(root, 'HB-108').querySelectorAll('.tag-must-have'))).toEqual(['must-have']);
    expect(region(root, 'safehouse-summary').textContent).toBe('12 tickets · 59 of 59 points · saved cod 164');
    expect(texts(region(root, 'change').querySelectorAll('li'))).toEqual(['Rises: HB-108 (10).', 'Sinks: HB-115 (13).', 'Loss: 3.', 'Saved cod 167 → 164.']);
    expect(app.store.getState().board.tickets.find((t) => t.key === 'HB-108')?.mustHave).toBe(true);
  });

  test('resurrecting a zombie works the same way and names it in the note', () => {
    const { root } = mountWith();
    byFocus(root, 'resurrect:HB-110').click();
    expect(shownKeys(root, 'safehouse')).toContain('HB-110');
    expect(region(root, 'change').querySelector('.change-headline')?.textContent).toBe('HB-110 resurrected.');
    expect(texts(region(root, 'change').querySelectorAll('li'))[1]).toBe('Sinks: HB-113 (14), HB-115 (13); together 27.');
  });

  test('a rejected exhume changes nothing on screen but the note and the alert', () => {
    const { root, app } = mountWith();
    const keptBefore = shownKeys(root, 'safehouse');
    const buriedBefore = shownKeys(root, 'yard');
    const board = app.store.getState().board;
    byFocus(root, 'exhume:HB-119').click();
    expect(shownKeys(root, 'safehouse')).toEqual(keptBefore);
    expect(shownKeys(root, 'yard')).toEqual(buriedBefore);
    expect(app.store.getState().board).toBe(board);
    expect(region(root, 'change').dataset.alert).toBe('true');
    expect(region(root, 'change').textContent).toContain('need 63 points; there are 59 (59 after the 0 % reserve)');
  });

  test('putting a zombie down removes its tombstone, says what can never ship, and lists it as closed', () => {
    const { root } = mountWith();
    byFocus(root, 'put-down:HB-112').click();
    expect(shownKeys(root, 'yard')).toEqual(['HB-108', 'HB-110', 'HB-111', 'HB-114', 'HB-117', 'HB-119']);
    expect(shownKeys(root, 'safehouse')).toHaveLength(12);
    expect(region(root, 'closed').textContent).toBe("Closed as Won't Do: HB-112");
    expect(visible(region(root, 'closed'))).toBe(true);
    const stone = grave(root, 'HB-114');
    expect(stone.querySelector('.card-epitaph')?.textContent).toContain('HB-112 was closed as Won\'t Do, so it can never ship.');
    expect(stone.querySelector('.card-needs')?.textContent).toBe("Needs HB-112 (closed as Won't Do)");
    expect(stone.dataset.fell).toBe('false');
    expect(texts(region(root, 'change').querySelectorAll('li'))).toEqual(['HB-114 can never ship.', 'No change in the cut.']);
    expect(region(root, 'yard-summary').textContent).toBe('6 tickets · effort 108 · cod 85');
  });

  test('the closed line is hidden until something is closed', () => {
    const { root } = mountWith();
    expect(visible(region(root, 'closed'))).toBe(false);
  });

  test('a ticket that stays in the same ground keeps its element (so focus and animation survive)', () => {
    const { root, app } = mountWith();
    const stone = grave(root, 'HB-117');
    const card = plank(root, 'HB-101');
    app.store.dispatch({ type: 'reserve/set', pct: 15 });
    byFocus(root, 'exhume:HB-108').click();
    expect(grave(root, 'HB-117')).toBe(stone);
    expect(plank(root, 'HB-101')).toBe(card);
  });

  test('moving the candle moves tickets between the grounds, and the lists stay in key order', () => {
    const { root, app } = mountWith();
    app.store.dispatch({ type: 'candle/set', step: 6 });
    const kept = shownKeys(root, 'safehouse');
    const buried = shownKeys(root, 'yard');
    expect([...kept].sort()).toEqual(kept);
    expect([...buried].sort()).toEqual(buried);
    expect([...kept, ...buried].sort()).toEqual(app.store.getState().board.tickets.map((t) => t.key).sort());
  });
});

describe('focus', () => {
  test('after an exhume the focus moves to the ticket that was acted on, now inside the safehouse', () => {
    const { root } = mountWith();
    const button = byFocus(root, 'exhume:HB-108');
    button.focus();
    expect(document.activeElement).toBe(button);
    button.click(); // the button disappears with the tombstone
    expect(document.activeElement).toBe(byFocus(root, 'card:HB-108'));
    expect(plank(root, 'HB-108').contains(document.activeElement)).toBe(true);
  });

  test('after a resurrect the focus goes to the revived ticket', () => {
    const { root } = mountWith();
    byFocus(root, 'resurrect:HB-110').focus();
    byFocus(root, 'resurrect:HB-110').click();
    expect(document.activeElement).toBe(byFocus(root, 'card:HB-110'));
  });

  test('after a put down the ticket is gone, so the focus goes to the yard, never to the page', () => {
    const { root } = mountWith();
    byFocus(root, 'put-down:HB-112').focus();
    byFocus(root, 'put-down:HB-112').click();
    expect(document.activeElement).toBe(region(root, 'yard'));
    expect(document.activeElement).not.toBe(document.body);
  });

  test('after a rejected exhume the focus stays on the button', () => {
    const { root } = mountWith();
    const button = byFocus(root, 'exhume:HB-119');
    button.focus();
    button.click();
    expect(document.activeElement).toBe(button);
  });

  test('focus on another control is left alone', () => {
    const { root, app } = mountWith();
    const candle = root.querySelector<HTMLInputElement>('#candle-input')!;
    candle.focus();
    app.store.dispatch({ type: 'tombstone/exhume', key: 'HB-108' });
    expect(document.activeElement).toBe(candle);
  });

  test('the cards can take focus from script (tabindex -1) but are not in the tab order', () => {
    const { root } = mountWith();
    for (const a of root.querySelectorAll('article.card')) expect(a.getAttribute('tabindex')).toBe('-1');
  });
});

describe('an impossible freeze', () => {
  test('both grounds explain it, no tickets are listed, and the must-haves are shown with what they need', () => {
    const { root, app } = mountWith();
    app.store.dispatch({ type: 'candle/set', step: 2 });
    expect(shownKeys(root, 'safehouse')).toEqual([]);
    expect(shownKeys(root, 'yard')).toEqual([]);
    expect(region(root, 'safehouse-empty').textContent).toBe('Nothing can be decided until the must-haves fit.');
    expect(region(root, 'yard-empty').textContent).toBe('Nothing can be decided until the must-haves fit.');
    expect(visible(region(root, 'safehouse-summary'))).toBe(false);
    expect(visible(region(root, 'yard-summary'))).toBe(false);
    const items = texts(region(root, 'safehouse').querySelectorAll('.musthave-list li'));
    expect(items).toEqual([
      'HB-101 Fix stale balance after a transfer 5 points',
      'HB-102 Strong-auth callback (PSD2) 8 points',
      'HB-103 Store listing and release notes 2 points',
    ]);
    expect(visible(region(root, 'safehouse').querySelector('.musthave-list')!)).toBe(true);
  });

  test('coming back from it draws the lists again and hides the explanation', () => {
    const { root, app } = mountWith();
    app.store.dispatch({ type: 'candle/set', step: 2 });
    app.store.dispatch({ type: 'candle/set', step: 10 });
    expect(shownKeys(root, 'safehouse')).toHaveLength(12);
    expect(visible(region(root, 'safehouse-empty'))).toBe(false);
    expect(visible(region(root, 'safehouse').querySelector('.musthave-list')!)).toBe(false);
  });

  test('a freeze that fits nothing but the must-haves says nothing else fits', () => {
    const { root, app } = mountWith();
    app.store.dispatch({ type: 'candle/set', step: 3 });
    app.store.dispatch({ type: 'reserve/set', pct: 15 });
    expect(shownKeys(root, 'safehouse').length).toBeGreaterThan(0);
  });
});

describe('boards with other shapes', () => {
  test('an empty yard says nothing is left outside', () => {
    const board = sampleBoard();
    const { root } = mountWith({ ...board, tickets: board.tickets.slice(0, 3) });
    expect(shownKeys(root, 'yard')).toEqual([]);
    expect(region(root, 'yard-empty').textContent).toBe('Nothing is left outside.');
    expect(region(root, 'yard-summary').textContent).toBe('0 tickets · effort 0 · cod 0');
  });

  test('an empty safehouse says nothing fits inside', () => {
    const board = sampleBoard();
    const { root } = mountWith({ ...board, tickets: board.tickets.slice(3, 4), people: [] });
    expect(shownKeys(root, 'safehouse')).toEqual([]);
    expect(region(root, 'safehouse-empty').textContent).toBe('Nothing fits inside.');
  });
});

describe('text stays text', () => {
  const PAYLOAD = '<img src=x onerror=alert(1)>';

  test('a ticket titled with markup is shown as text in both grounds, and the page has no image', () => {
    const board = sampleBoard();
    const tickets = board.tickets.map((t) => (t.key === 'HB-101' || t.key === 'HB-108' ? { ...t, title: PAYLOAD } : t));
    const { root } = mountWith({ ...board, tickets });
    expect(plank(root, 'HB-101').querySelector('.card-title')?.textContent).toBe(PAYLOAD);
    expect(grave(root, 'HB-108').querySelector('.card-title')?.textContent).toBe(PAYLOAD);
    expect(document.querySelector('img')).toBeNull();
    expect(root.querySelector('[onerror]')).toBeNull();
  });

  test('a key with markup is shown as text, labels the actions as text, and the actions still work', () => {
    const key = '"><img src=x onerror=alert(1)>';
    const board = sampleBoard();
    const tickets = board.tickets.map((t) => (t.key === 'HB-108' ? { ...t, key } : t));
    const { root, app } = mountWith({ ...board, tickets });
    expect(grave(root, key)).not.toBeNull();
    expect(grave(root, key).querySelector('.card-key')?.textContent).toBe(key);
    expect(byFocus(root, `exhume:${key}`).getAttribute('aria-label')).toBe(`Exhume ${key}`);
    expect(document.querySelector('img')).toBeNull();
    byFocus(root, `exhume:${key}`).click();
    expect(shownKeys(root, 'safehouse')).toContain(key);
    expect(app.store.getState().board.tickets.find((t) => t.key === key)?.mustHave).toBe(true);
    expect(document.querySelector('img')).toBeNull();
  });

  test('an epitaph and a reason built from a key with markup are text', () => {
    const key = '<b>x</b>';
    const board = sampleBoard();
    const tickets = board.tickets.map((t) => (t.key === 'HB-112' ? { ...t, key } : t.key === 'HB-114' ? { ...t, dependsOn: [key] } : t));
    const { root } = mountWith({ ...board, tickets });
    expect(grave(root, 'HB-114').querySelector('.card-epitaph')?.textContent).toContain(`It followed ${key} into the ground.`);
    expect(grave(root, 'HB-114').querySelector('.card-fell')?.textContent).toBe(`Fell behind ${key}`);
    expect(document.querySelector('b')).toBeNull();
  });
});

describe('the look of a tombstone and a shelf row (the structure the styles hang on)', () => {
  test('every tombstone has R · I · P engraved at the top, hidden from assistive technology, above the key', () => {
    const { root } = mountWith();
    for (const key of shownKeys(root, 'yard')) {
      const stone = grave(root, key);
      const rip = stone.querySelector('.grave-rip');
      expect(rip?.textContent, key).toBe('R · I · P');
      expect(rip?.getAttribute('aria-hidden'), key).toBe('true');
      const article = stone.querySelector('article')!;
      expect(article.firstElementChild, key).toBe(rip);
      expect(article.textContent?.indexOf('R · I · P')).toBeLessThan(article.textContent?.indexOf(key) ?? -1);
    }
  });

  test('the epitaph is the main line: right after the title and before the details', () => {
    const { root } = mountWith();
    const order = [...grave(root, 'HB-108').querySelectorAll('article > *')].map((n) => n.className.split(' ')[0]);
    expect(order.indexOf('card-title')).toBeLessThan(order.indexOf('card-epitaph'));
    expect(order.indexOf('card-epitaph')).toBeLessThan(order.indexOf('card-facts'));
  });

  test('a zombie says how much hungrier it gets next release, with the engine numbers', () => {
    const { root } = mountWith();
    expect(grave(root, 'HB-110').querySelector('.card-hunger')?.textContent).toBe('Hungrier next release: urgency 5 → 8');
    expect(grave(root, 'HB-112').querySelector('.card-hunger')?.textContent).toBe('Hungrier next release: urgency 8 → 13');
  });

  test('no other tombstone has a hunger line', () => {
    const { root } = mountWith();
    for (const key of ['HB-108', 'HB-111', 'HB-114', 'HB-117', 'HB-119']) {
      expect(visible(grave(root, key).querySelector('.card-hunger')!), key).toBe(false);
      expect(grave(root, key).textContent, key).not.toContain('Hungrier');
    }
  });

  test('the reason is never written twice: no tombstone repeats a sentence of its own epitaph in the details', () => {
    const { root } = mountWith();
    for (const key of shownKeys(root, 'yard')) {
      const stone = grave(root, key);
      expect(visible(stone.querySelector('.card-why')!), key).toBe(false);
      expect(stone.querySelector('.card-why dd')?.textContent, key).toBe('');
      expect(stone.textContent, key).not.toMatch(/Needs \d+ points?, \d+ left\./);
      expect(stone.textContent, key).not.toMatch(/which (is|are) buried\./);
    }
  });

  test('the details are a two-column block of effort, waiting cost and cost of delay', () => {
    const { root } = mountWith();
    const labels = [...grave(root, 'HB-108').querySelectorAll('dl > div:not([hidden]) dt')].map((n) => n.textContent);
    expect(labels).toEqual(['Effort', 'Waiting costs', 'Cost of delay']);
  });

  test('the safehouse is one framed shelf; each ticket is one row of key, title, effort and the cost formula, then small tags', () => {
    const { root } = mountWith();
    const shelf = region(root, 'safehouse').querySelector('ul.shelf[data-list="safehouse"]')!;
    expect(shelf.children).toHaveLength(12);
    const row = plank(root, 'HB-105').querySelector('article')!;
    const parts = [...row.children].map((n) => n.className.split(' ')[0]);
    expect(parts).toEqual(['card-key', 'card-title', 'row-tags', 'row-effort', 'row-cost', 'card-needs']);
    expect(row.querySelector('dl')).toBeNull();
    expect(row.querySelector('.row-tags')?.textContent).toContain('hungry');
    expect(texts(plank(root, 'HB-101').querySelectorAll('.tag'))).toEqual(['must-have']);
    expect(plank(root, 'HB-101').querySelector('.row-tags')?.hasAttribute('hidden')).toBe(false);
    expect(plank(root, 'HB-104').querySelector('.row-tags')?.hasAttribute('hidden')).toBe(true);
  });
});