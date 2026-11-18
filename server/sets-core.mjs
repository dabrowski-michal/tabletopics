import { createHash, timingSafeEqual } from 'node:crypto';

/* ============================================================
   Table Topics — question-set API (shared by the Netlify
   function and the local dev server).

   GET /api/sets  → { sets, activeSetId }
   PUT /api/sets  ← { sets, activeSetId }   (whole document)
   Every request must carry the site password in X-App-Password.
   ============================================================ */

const SET_SIZES = [10, 15, 20];
const MAX_SETS = 60;
const MAX_NAME = 60;
const MAX_QUESTION = 240;

/* Starter sets, served until the first save */
export const SEED_SETS = [
    {
        id: 'seed-detours',
        name: 'Detours & Curiosity',
        questions: [
            'What unexpected detour in life turned out to be a blessing?',
            'How do you maintain optimism when facing sudden change?',
            'What skill or habit are you curious to learn next?',
            'What major innovation do you think is just around the corner?',
            'Do you prefer a detailed plan or a surprising adventure?',
            'What is a "happy accident" that changed your path for the better?',
            'How do you keep a sense of wonder in everyday life?',
            'If you could see five years into your future, what would you look for?',
            'What advice helps you bounce back from a setback?',
            'Imagine turning a corner right now and finding a secret door. Where does it lead?',
            'What title would you give to the next chapter of your life?',
            'What was a time stepping out of your comfort zone paid off?',
            'How do you stay flexible when everything goes off script?',
            'What is one goal waiting for you just around the corner?',
            'Why is curiosity often more powerful than fear?'
        ]
    },
    {
        id: 'seed-unspoken',
        name: 'Unspoken Words',
        questions: [
            'What goes through people\'s minds when they type a long message but only send "ok"?',
            'How to set a clear boundary with someone without actually saying a word?',
            'Why do we often find it easier to confess our true feelings to a dog rather than a human?',
            'When to answer "How are you" honestly instead of just saying "fine"?',
            'How to decline a drink without feeling the need to explain yourself?',
            'Which missed opportunity to say something important stays in your memory the most?',
            'What exactly occupies your mind during a completely silent elevator ride with another human?',
            'What is the most unexpected reaction you ever received after finally speaking your mind?',
            'How to express deep gratitude when a simple "thank you" is not enough?',
            'When is staying silent actually a better choice than speaking up?',
            'How do you resist the urge to say "I told you so" when you know you were right?',
            'Where do you draw the line between being polite and suppressing your own needs?',
            'How to decide when to correct someone mispronouncing your name?',
            'If you could instantly send one unspoken truth to your past self, what would it say?',
            'What is the very first step you take when you finally decide to break your silence?'
        ]
    }
];

function seedDoc() {
    return {
        sets: SEED_SETS.map(s => ({
            id: s.id,
            name: s.name,
            questions: s.questions.map(text => ({ text })),
            updatedAt: 0
        })),
        activeSetId: SEED_SETS[0].id
    };
}

/* Returns a clean document, or null when the payload is not acceptable */
function sanitizeDoc(body) {
    if (!body || typeof body !== 'object' || !Array.isArray(body.sets)) return null;
    if (body.sets.length < 1 || body.sets.length > MAX_SETS) return null;

    const ids = new Set();
    const sets = [];
    for (const raw of body.sets) {
        if (!raw || typeof raw !== 'object' || !Array.isArray(raw.questions)) return null;
        const id = typeof raw.id === 'string' ? raw.id.trim().slice(0, 64) : '';
        const name = typeof raw.name === 'string' ? raw.name.trim() : '';
        if (!id || ids.has(id) || !name || name.length > MAX_NAME) return null;
        if (!SET_SIZES.includes(raw.questions.length)) return null;

        const questions = [];
        for (const q of raw.questions) {
            const text = q && typeof q.text === 'string' ? q.text.trim() : '';
            if (!text || text.length > MAX_QUESTION) return null;
            questions.push({ text });
        }
        ids.add(id);
        sets.push({ id, name, questions, updatedAt: Number(raw.updatedAt) || 0 });
    }

    const activeSetId = ids.has(body.activeSetId) ? body.activeSetId : sets[0].id;
    return { sets, activeSetId };
}

function passwordMatches(given, expected) {
    const a = createHash('sha256').update(String(given || '')).digest();
    const b = createHash('sha256').update(String(expected)).digest();
    return timingSafeEqual(a, b);
}

function json(status, data) {
    return new Response(JSON.stringify(data), {
        status,
        headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }
    });
}

/* storage: { password(): string, loadDoc(): Promise<doc|null>, saveDoc(doc): Promise<void> } */
export function createSetsHandler({ password, loadDoc, saveDoc }) {
    return async function handle(request) {
        // Fail closed: without a configured password nobody gets in
        if (!password()) {
            console.error('SITE_PASSWORD is not set');
            return json(503, { error: 'The site password is not configured.' });
        }

        if (!passwordMatches(request.headers.get('x-app-password'), password())) {
            await new Promise(resolve => setTimeout(resolve, 500));   // slows down guessing
            return json(401, { error: 'Wrong password.' });
        }

        try {
            if (request.method === 'GET') {
                const stored = sanitizeDoc(await loadDoc());
                return json(200, stored || seedDoc());
            }

            if (request.method === 'PUT') {
                let body = null;
                try { body = await request.json(); } catch (e) { /* rejected below */ }
                const doc = sanitizeDoc(body);
                if (!doc) return json(400, { error: 'Invalid sets payload.' });
                await saveDoc(doc);
                return json(200, doc);
            }

            return json(405, { error: 'Method not allowed.' });
        } catch (err) {
            console.error('sets api failed', err);
            return json(500, { error: 'Storage error.' });
        }
    };
}
