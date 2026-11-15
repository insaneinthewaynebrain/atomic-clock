// Wake-up words: shown on the alarm screen and spoken aloud between bursts of music.
// Soft = calm, yoga-class affirmations; Medium = upbeat work-day pep talk; Harsh = drill sergeant.
// Built-in lines always work offline; quotes from the internet (DummyJSON's free quotes list,
// keyless and CORS-enabled) are sorted by tone and mixed in when available.
import * as store from './store.js';
import { fetchJSON } from './ui.js';
import { normTone } from './music.js';

const LINES = {
  soft: [
    'Good morning. Today is going to be a beautiful day.',
    'Take a slow, deep breath in… and gently let it go.',
    'You are rested, you are calm, and you are ready.',
    'Let the light in. There is no rush — just this moment.',
    'Be gentle with yourself today.',
    'Every sunrise is a fresh beginning.',
    'Notice your breath. Feel your body waking up, softly.',
    'You have everything you need within you.',
    'Today, choose peace over worry.',
    'Smile. The day is welcoming you.',
    'Stretch gently, like a cat in the morning sun.',
    'Wherever you are is exactly where you need to be.',
    'Let today unfold with ease and kindness.',
    'You deserve a calm and happy day.',
    'Breathe in energy. Breathe out anything you don’t need.',
    'Small, gentle steps still carry you forward.',
    'Gratitude turns what we have into enough.',
    'Open your eyes slowly. The world is ready for you.',
  ],
  medium: [
    'Rise and shine! You’ve got this today.',
    'You’re going to smash it at work today.',
    'Today you’re the one who keeps the boss happy.',
    'Coffee, shower, go. You’re unstoppable.',
    'Every meeting, every email — you’ll handle it like a pro.',
    'Whatever’s on the list today, you’re getting through it.',
    'Be the person everyone’s glad turned up today.',
    'Today’s a great day to be brilliant at your job.',
    'Show up, do your best, and enjoy the wins.',
    'You’re more prepared than you think.',
    'The commute won’t beat you. Nothing will.',
    'Today’s effort is tomorrow’s promotion.',
    'Big smile, good attitude. The day is yours.',
    'Get up, get going, get it done.',
    'You’ve handled hard days before. This one’s yours too.',
    'People are counting on you today — and you’ll deliver.',
    'Up and at ’em! Today is going to be a good one.',
  ],
  harsh: [
    'Get up, you lazy lump!',
    'Out of bed. Now. No excuses.',
    'The snooze button is not your friend!',
    'Move it! The day will not wait for you.',
    'Feet on the floor, soldier!',
    'Stop hiding under that duvet!',
    'Up! You can sleep when the work is done.',
    'Nobody ever achieved anything lying in bed!',
    'Rise and grind. Stop whining!',
    'Your pillow has had enough of you. Get up!',
    'Wake up! This alarm is louder than your excuses.',
    'Every minute you lie there, someone else is winning.',
    'Up, up, UP! Let’s go!',
    'Five more minutes? I don’t think so!',
    'Get out of that bed before I turn this up even louder!',
    'Lazy mornings make lazy days. Move!',
    'Quit stalling. The coffee is downstairs and so is your future.',
  ],
};

// Sorting internet quotes into the three moods by their words.
const MOOD = {
  soft: /\b(peace|peaceful|calm|breathe|breath|gentle|kind|kindness|love|joy|joyful|happiness|happy|grateful|gratitude|present moment|soul|beauty|beautiful|stillness|serenity|smile|nature|patience|patient|heal|rest)\b/i,
  medium: /\b(work|working|success|successful|succeed|effort|goals?|achieve|progress|team|job|career|opportunit\w*|persist\w*|believe|confidence|today|tomorrow|start|begin|dream|ambition|best)\b/i,
  harsh: /\b(discipline|excuses?|lazy|quit|quitting|sweat|hard work|hustle|weak|regret|comfort zone|action|wait|waste|wasting|sacrifice|grind|stop wishing|get up)\b/i,
};
const AVOID = /\b(death|die|dies|died|dead|kill|killing|war|hate|suicide|hell|sin|blood|grave|enemy|enemies)\b/i;
const WEEK = 7 * 24 * 3600 * 1000;

let refreshing = false;
/** Fetch and sort online quotes about once a week. Quietly does nothing offline. */
export async function refreshQuotes(force = false) {
  const d = store.get();
  const q = d.wakeQuotes;
  if (refreshing || (!force && q && Date.now() - q.at < WEEK)) return;
  refreshing = true;
  try {
    const j = await fetchJSON('https://dummyjson.com/quotes?limit=0', 12000);
    const out = { soft: [], medium: [], harsh: [] };
    for (const x of j.quotes || []) {
      const text = String(x.quote || '').trim();
      if (!text || text.length > 150 || AVOID.test(text)) continue;
      const by = String(x.author || '').trim();
      for (const k of ['harsh', 'soft', 'medium']) {   // harsh first: it's the most specific
        if (MOOD[k].test(text)) { if (out[k].length < 120) out[k].push({ text, by }); break; }
      }
    }
    d.wakeQuotes = { at: Date.now(), ...out };
    store.save();
  } catch (e) { /* offline or blocked: the built-in lines are enough */ }
  finally { refreshing = false; }
}

const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

/** A shuffled list of messages for this tone: an opening line, then built-in lines and quotes mixed. */
export function messagesFor(tone) {
  tone = normTone(tone);
  const own = shuffle(LINES[tone].map((text) => ({ text })));
  const quotes = shuffle([...(store.get().wakeQuotes?.[tone] || [])]).slice(0, 8);
  const out = [own.shift()];
  while (own.length || quotes.length) {
    if (own.length) out.push(own.shift());
    if (own.length) out.push(own.shift());
    if (quotes.length) out.push(quotes.shift());
  }
  return out;
}

/* ---------- Speaking ---------- */
const VOICE = { soft: { rate: 0.82, pitch: 1.0 }, medium: { rate: 1.05, pitch: 1.1 }, harsh: { rate: 1.12, pitch: 0.75 } };
const canSpeak = () => 'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window;

function voice() {
  const vs = speechSynthesis.getVoices();
  return vs.find((v) => v.lang === 'en-GB' && /daniel|serena|kate|arthur|martha/i.test(v.name))
    || vs.find((v) => v.lang === 'en-GB') || vs.find((v) => /^en/i.test(v.lang)) || null;
}

/** Call from a tap so the iPhone lets the app speak later on. */
export function primeSpeech() {
  if (!canSpeak()) return;
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; speechSynthesis.speak(u); } catch (e) { /* ignore */ }
}

/** Speak a message; resolves when finished (or after a time limit). */
export function speak(msg, tone) {
  return new Promise((resolve) => {
    if (!canSpeak()) { resolve(); return; }
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(msg.text + (msg.by ? `. ${msg.by}.` : ''));
      const v = voice(); if (v) u.voice = v;
      u.lang = v?.lang || 'en-GB';
      Object.assign(u, VOICE[normTone(tone)]);
      u.volume = 1;
      const done = () => { clearTimeout(t); resolve(); };
      const t = setTimeout(done, 12000);
      u.onend = done; u.onerror = done;
      speechSynthesis.speak(u);
    } catch (e) { resolve(); }
  });
}
export function stopSpeaking() { if (canSpeak()) try { speechSynthesis.cancel(); } catch (e) { /* ignore */ } }
